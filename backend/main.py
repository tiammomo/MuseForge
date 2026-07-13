from __future__ import annotations

import base64
import binascii
import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path as FileSystemPath
from typing import Any
from typing import Literal

from fastapi import BackgroundTasks, Body, FastAPI, HTTPException, Path, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .config import Settings
from .database import Repository
from .workflow import (
    WorkflowConfigurationError,
    WorkflowRunner,
    WorkflowValidationError,
    validate_folder_name,
)
from .workspace import (
    IMAGE_SUFFIXES,
    SHOT_FOLDERS,
    resolve_workspace_asset,
    scan_workspace,
    workspace_asset_summary,
)


CANVAS_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024
WORKSPACE_IMPORT_MAX_BYTES = 12 * 1024 * 1024
JOB_STATUSES = {"queued", "running", "completed", "failed"}
REVIEW_STATUSES = {"pending", "selected"}


class WorkflowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product: str | None = Field(default=None, max_length=120)
    tasks: list[str] = Field(default_factory=list, max_length=100)
    shots: list[str] = Field(default_factory=list, max_length=5)
    combinations_only: bool = False
    variants_only: bool = False
    refresh_prompts: bool = False
    overwrite: bool = False
    concurrency: int | None = Field(default=None, ge=1, le=10)
    variants: int = Field(default=1, ge=1, le=6)

    @model_validator(mode="before")
    @classmethod
    def normalize_singular_fields(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        camel_case_fields = {
            "combinationsOnly": "combinations_only",
            "variantsOnly": "variants_only",
            "refreshPrompts": "refresh_prompts",
        }
        for source, target in camel_case_fields.items():
            if source in normalized and target not in normalized:
                normalized[target] = normalized.pop(source)
        if "task" in normalized and "tasks" not in normalized:
            normalized["tasks"] = normalized.pop("task")
        if "shot" in normalized and "shots" not in normalized:
            normalized["shots"] = normalized.pop("shot")
        if isinstance(normalized.get("tasks"), str):
            normalized["tasks"] = [normalized["tasks"]]
        if isinstance(normalized.get("shots"), str):
            normalized["shots"] = [normalized["shots"]]
        return normalized

    @field_validator("product")
    @classmethod
    def validate_product_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            return validate_folder_name(value, field="product")
        except WorkflowValidationError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("tasks")
    @classmethod
    def validate_task_names(cls, values: list[str]) -> list[str]:
        try:
            return [
                validate_folder_name(value, field=f"tasks[{index}]")
                for index, value in enumerate(values)
            ]
        except WorkflowValidationError as exc:
            raise ValueError(str(exc)) from exc


class GenerationCreativeBrief(BaseModel):
    """Canvas-authored additions layered on top of the verified task prompt."""

    model_config = ConfigDict(extra="forbid")

    subject: str = Field(default="", max_length=2000)
    environment: str = Field(default="", max_length=4000)
    composition: str = Field(default="", max_length=4000)
    negatives: str = Field(default="", max_length=4000)
    visible_text: str = Field(default="", max_length=1000)

    @model_validator(mode="before")
    @classmethod
    def normalize_visible_text(cls, value: Any) -> Any:
        if isinstance(value, dict) and "visibleText" in value and "visible_text" not in value:
            normalized = dict(value)
            normalized["visible_text"] = normalized.pop("visibleText")
            return normalized
        return value


class GenerationRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product: str = Field(min_length=1, max_length=120)
    tasks: list[str] = Field(min_length=1, max_length=100)
    shots: list[str] = Field(min_length=1, max_length=5)
    variants: int = Field(default=4, ge=1, le=6)
    concurrency: int = Field(default=4, ge=1, le=10)
    creative_brief: GenerationCreativeBrief | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_creative_brief(cls, value: Any) -> Any:
        if isinstance(value, dict) and "creativeBrief" in value and "creative_brief" not in value:
            normalized = dict(value)
            normalized["creative_brief"] = normalized.pop("creativeBrief")
            return normalized
        return value

    @field_validator("product")
    @classmethod
    def validate_product(cls, value: str) -> str:
        try:
            return validate_folder_name(value, field="product")
        except WorkflowValidationError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("tasks")
    @classmethod
    def validate_tasks(cls, values: list[str]) -> list[str]:
        try:
            validated = [
                validate_folder_name(value, field=f"tasks[{index}]")
                for index, value in enumerate(values)
            ]
        except WorkflowValidationError as exc:
            raise ValueError(str(exc)) from exc
        if len(set(validated)) != len(validated):
            raise ValueError("tasks cannot contain duplicates")
        return validated

    @field_validator("shots")
    @classmethod
    def validate_shots(cls, values: list[str]) -> list[str]:
        if len(set(values)) != len(values):
            raise ValueError("shots cannot contain duplicates")
        return values


class CandidateDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["selected"]


class WorkspaceAssetImport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product: str = Field(min_length=1, max_length=120)
    filename: str = Field(min_length=1, max_length=180)
    data_url: str = Field(min_length=1, max_length=17 * 1024 * 1024)

    @model_validator(mode="before")
    @classmethod
    def normalize_data_url(cls, value: Any) -> Any:
        if isinstance(value, dict) and "dataUrl" in value and "data_url" not in value:
            normalized = dict(value)
            normalized["data_url"] = normalized.pop("dataUrl")
            return normalized
        return value

    @field_validator("product")
    @classmethod
    def validate_product(cls, value: str) -> str:
        try:
            return validate_folder_name(value, field="product")
        except WorkflowValidationError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        if value != value.strip() or FileSystemPath(value).name != value:
            raise ValueError("filename must be one ordinary file name")
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("filename contains control characters")
        if FileSystemPath(value).suffix.casefold() not in IMAGE_SUFFIXES:
            raise ValueError("filename must use a supported image extension")
        return value


def _cors_origins() -> list[str]:
    raw = os.getenv(
        "MUSEFORGE_CORS_ORIGINS",
        (
            "http://localhost:33020,http://127.0.0.1:33020,"
            "http://localhost:5173,http://127.0.0.1:5173"
        ),
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _normalize_canvas_document(canvas_id: str, value: dict[str, Any]) -> dict[str, Any]:
    try:
        validate_folder_name(canvas_id, field="canvas id")
    except WorkflowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # The browser client sends {"document": {...}} while direct API callers may
    # send the document itself. Persist the same canonical shape for both forms.
    if set(value) == {"document"} and isinstance(value.get("document"), dict):
        document = dict(value["document"])
    else:
        document = dict(value)
    for server_field in ("id", "version", "created_at", "updated_at"):
        document.pop(server_field, None)
    name = document.get("name")
    if name is not None and (not isinstance(name, str) or len(name.strip()) > 160):
        raise HTTPException(status_code=422, detail="Canvas name must be a short string")
    for list_field in ("nodes", "edges"):
        if list_field in document and not isinstance(document[list_field], list):
            raise HTTPException(status_code=422, detail=f"Canvas {list_field} must be a list")
    if "viewport" in document and not isinstance(document["viewport"], dict):
        raise HTTPException(status_code=422, detail="Canvas viewport must be an object")
    document.setdefault("name", canvas_id)
    document.setdefault("nodes", [])
    document.setdefault("edges", [])
    document.setdefault("viewport", {"x": 0, "y": 0, "zoom": 1})
    serialized_size = len(json.dumps(document, ensure_ascii=False).encode("utf-8"))
    if serialized_size > CANVAS_DOCUMENT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Canvas document exceeds 2 MiB")
    return document


def _candidate_path(
    settings: Settings,
    candidate: dict[str, Any],
    *,
    require_file: bool,
) -> FileSystemPath:
    relative_path = candidate.get("relative_path")
    if not isinstance(relative_path, str) or not relative_path or "\x00" in relative_path:
        raise HTTPException(status_code=404, detail="Candidate image is unavailable")
    relative = FileSystemPath(relative_path)
    if relative.is_absolute():
        raise HTTPException(status_code=403, detail="Candidate path must be relative")
    workspace_root = settings.workspace_root.resolve()
    unresolved_path = workspace_root / relative
    if unresolved_path.is_symlink():
        raise HTTPException(status_code=403, detail="Candidate symlinks are not allowed")
    path = unresolved_path.resolve()
    if candidate.get("storage_status") == "staged":
        storage_anchor = (
            workspace_root / ".museforge" / "runs" / str(candidate["job_id"])
        ).resolve()
        allowed_root = (
            storage_anchor
            / str(candidate["product"])
            / str(candidate["task"])
            / str(candidate["shot"])
        ).resolve()
    elif candidate.get("storage_status") == "promoted":
        folder = SHOT_FOLDERS.get(str(candidate.get("shot")))
        if folder is None:
            raise HTTPException(status_code=403, detail="Candidate has an invalid shot")
        storage_anchor = (workspace_root / "组合").resolve()
        allowed_root = (
            storage_anchor
            / str(candidate["product"])
            / str(candidate["task"])
            / folder
        ).resolve()
    else:
        raise HTTPException(status_code=403, detail="Candidate storage state is invalid")
    try:
        storage_anchor.relative_to(workspace_root)
        allowed_root.relative_to(storage_anchor)
        path.relative_to(allowed_root)
    except ValueError as exc:
        raise HTTPException(
            status_code=403, detail="Candidate path escapes its storage directory"
        ) from exc
    if path.suffix.casefold() not in IMAGE_SUFFIXES:
        raise HTTPException(status_code=403, detail="Candidate is not an allowed image")
    if candidate.get("storage_status") == "staged" and path.stem != (
        f"candidate-{int(candidate['candidate_index']):02d}"
    ):
        raise HTTPException(status_code=403, detail="Candidate filename is invalid")
    if require_file and not path.is_file():
        raise HTTPException(status_code=404, detail="Candidate image is unavailable")
    return path


def _candidate_destination(settings: Settings, candidate: dict[str, Any]) -> FileSystemPath:
    folder = SHOT_FOLDERS.get(str(candidate.get("shot")))
    if folder is None:
        raise HTTPException(status_code=422, detail="Candidate has an invalid shot")
    try:
        product = validate_folder_name(str(candidate["product"]), field="product")
        task = validate_folder_name(str(candidate["task"]), field="task")
    except WorkflowValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    suffix = FileSystemPath(str(candidate.get("name") or "candidate.png")).suffix.casefold()
    if suffix not in IMAGE_SUFFIXES:
        raise HTTPException(status_code=422, detail="Candidate has an invalid image suffix")
    output_root = (settings.workspace_root / "组合").resolve()
    destination = (
        output_root / product / task / folder / f"{candidate['id']}{suffix}"
    ).resolve()
    try:
        destination.relative_to(output_root)
    except ValueError as exc:  # pragma: no cover - validated folder segments guard this
        raise HTTPException(status_code=403, detail="Promotion path escaped output root") from exc
    return destination


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        repository = Repository(resolved_settings.database_path)
        repository.initialize()
        generation_executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="museforge-generation"
        )
        app.state.settings = resolved_settings
        app.state.repository = repository
        app.state.workflow_runner = WorkflowRunner(resolved_settings)
        app.state.generation_executor = generation_executor
        try:
            yield
        finally:
            generation_executor.shutdown(wait=False, cancel_futures=False)

    application = FastAPI(
        title="MuseForge API",
        version="0.1.0",
        description="Local-first product image workstation API",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @application.get("/api/health")
    def health(request: Request) -> dict[str, Any]:
        current: Settings = request.app.state.settings
        return {
            "status": "ok",
            "service": "museforge-api",
            "version": application.version,
            "workspace_ready": current.workspace_root.is_dir(),
            "workflow_ready": current.workflow_script.is_file(),
            "live_generation_enabled": current.live_generation_enabled,
        }

    @application.get("/api/workspace")
    def workspace(request: Request) -> dict[str, Any]:
        current: Settings = request.app.state.settings
        repository: Repository = request.app.state.repository
        summary = scan_workspace(current.workspace_root)
        summary["stats"]["pendingReview"] = repository.list_candidates(
            limit=1, review_status="pending"
        )["total"]
        summary["live_generation_enabled"] = current.live_generation_enabled
        summary["liveGenerationEnabled"] = current.live_generation_enabled
        return summary

    @application.post("/api/workspace/assets/import", status_code=201)
    def import_workspace_asset(
        payload: WorkspaceAssetImport,
        request: Request,
    ) -> dict[str, Any]:
        current: Settings = request.app.state.settings
        product_root = (current.workspace_root / "原始商品图" / payload.product).resolve()
        source_root = (current.workspace_root / "原始商品图").resolve()
        try:
            product_root.relative_to(source_root)
        except ValueError as exc:  # pragma: no cover - product validation guards this
            raise HTTPException(status_code=403, detail="Import target escaped source assets") from exc
        if not product_root.is_dir():
            raise HTTPException(status_code=404, detail="Product workspace not found")

        header, separator, encoded = payload.data_url.partition(",")
        if separator != "," or not header.startswith("data:image/") or ";base64" not in header:
            raise HTTPException(status_code=422, detail="Asset must be a base64 image data URL")
        mime_type = header[5:].split(";", 1)[0].casefold()
        if mime_type not in {
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/avif",
        }:
            raise HTTPException(status_code=422, detail="Asset image type is not supported")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(status_code=422, detail="Asset image data is invalid") from exc
        if not content:
            raise HTTPException(status_code=422, detail="Asset image is empty")
        if len(content) > WORKSPACE_IMPORT_MAX_BYTES:
            raise HTTPException(status_code=413, detail="Asset image exceeds 12 MiB")

        import_dir = product_root / "画布导入"
        import_dir.mkdir(parents=True, exist_ok=True)
        destination = import_dir / f"{uuid.uuid4().hex[:12]}-{payload.filename}"
        temporary = destination.with_suffix(destination.suffix + ".part")
        try:
            temporary.write_bytes(content)
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                temporary.unlink()
        result = workspace_asset_summary(destination, current.workspace_root)
        result["original_name"] = payload.filename
        return result

    @application.get("/api/workspace/assets/{asset_path:path}")
    def workspace_asset(request: Request, asset_path: str) -> FileResponse:
        current: Settings = request.app.state.settings
        try:
            path = resolve_workspace_asset(current.workspace_root, asset_path)
        except ValueError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Workspace image not found") from exc
        return FileResponse(path)

    @application.get("/api/canvases/{canvas_id}")
    def get_canvas(
        request: Request,
        canvas_id: str = Path(min_length=1, max_length=120),
    ) -> dict[str, Any]:
        try:
            validate_folder_name(canvas_id, field="canvas id")
        except WorkflowValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        repository: Repository = request.app.state.repository
        canvas = repository.get_canvas(canvas_id)
        if canvas is None:
            raise HTTPException(status_code=404, detail="Canvas not found")
        return canvas

    @application.put("/api/canvases/{canvas_id}")
    def put_canvas(
        request: Request,
        canvas_id: str = Path(min_length=1, max_length=120),
        document: dict[str, Any] = Body(...),
    ) -> dict[str, Any]:
        normalized = _normalize_canvas_document(canvas_id, document)
        repository: Repository = request.app.state.repository
        saved = repository.upsert_canvas(canvas_id, normalized)
        saved["ok"] = True
        return saved

    @application.get("/api/jobs")
    def list_jobs(
        request: Request,
        limit: int = Query(default=50, ge=1, le=200),
        status: str | None = Query(default=None),
    ) -> dict[str, Any]:
        if status is not None and status not in JOB_STATUSES:
            raise HTTPException(status_code=422, detail="Unknown job status")
        repository: Repository = request.app.state.repository
        return repository.list_jobs(limit=limit, status=status)

    @application.post("/api/jobs/demo")
    def demo_job(request: Request) -> dict[str, Any]:
        repository: Repository = request.app.state.repository
        return repository.ensure_demo_job()

    def require_live_generation(request: Request) -> Settings:
        current: Settings = request.app.state.settings
        if not current.live_generation_enabled:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "live_generation_disabled",
                    "message": (
                        "实时生图默认关闭；仅在明确设置 "
                        "MUSEFORGE_ENABLE_LIVE_GENERATION=true 后开放"
                    ),
                },
            )
        return current

    @application.post("/api/generation-runs", status_code=202)
    def create_generation_run(
        payload: GenerationRunRequest,
        background_tasks: BackgroundTasks,
        request: Request,
    ) -> dict[str, Any]:
        require_live_generation(request)
        runner: WorkflowRunner = request.app.state.workflow_runner
        repository: Repository = request.app.state.repository
        normalized = payload.model_dump()
        try:
            command = runner.build_command("generate", normalized)
        except WorkflowValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except WorkflowConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        run = repository.create_generation_run(request=normalized, command=command)
        executor: ThreadPoolExecutor = request.app.state.generation_executor

        def submit() -> None:
            try:
                executor.submit(
                    runner.execute_generation_run,
                    job_id=run["id"],
                    request=normalized,
                    command=command,
                    repository=repository,
                )
            except RuntimeError as exc:
                repository.fail_unfinished_items(run["id"], str(exc))
                repository.finish_job(
                    run["id"],
                    status="failed",
                    message=f"无法调度候选生成：{exc}",
                    stderr=str(exc),
                )

        background_tasks.add_task(submit)
        return run

    @application.get("/api/generation-runs")
    def list_generation_runs(
        request: Request,
        limit: int = Query(default=50, ge=1, le=200),
        status: str | None = Query(default=None),
    ) -> dict[str, Any]:
        if status is not None and status not in JOB_STATUSES:
            raise HTTPException(status_code=422, detail="Unknown generation run status")
        repository: Repository = request.app.state.repository
        return repository.list_generation_runs(limit=limit, status=status)

    @application.get("/api/generation-runs/{job_id}")
    def get_generation_run(
        request: Request,
        job_id: str = Path(min_length=1, max_length=120),
        events_after: int = Query(default=0, ge=0),
        event_limit: int = Query(default=500, ge=1, le=2000),
    ) -> dict[str, Any]:
        repository: Repository = request.app.state.repository
        run = repository.get_generation_run(job_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Generation run not found")
        run["events"] = repository.list_events(
            job_id, after=events_after, limit=event_limit
        )
        return run

    @application.get("/api/candidates")
    def list_candidates(
        request: Request,
        job_id: str | None = Query(default=None, max_length=120),
        review_status: str | None = Query(default=None),
        limit: int = Query(default=200, ge=1, le=500),
    ) -> dict[str, Any]:
        if review_status is not None and review_status not in REVIEW_STATUSES:
            raise HTTPException(status_code=422, detail="Unknown candidate review status")
        repository: Repository = request.app.state.repository
        if job_id is not None and repository.get_generation_run(job_id) is None:
            raise HTTPException(status_code=404, detail="Generation run not found")
        return repository.list_candidates(
            limit=limit,
            job_id=job_id,
            review_status=review_status,
        )

    @application.get("/api/candidates/{candidate_id}/image")
    def candidate_image(
        request: Request,
        candidate_id: str = Path(min_length=1, max_length=120),
    ) -> FileResponse:
        repository: Repository = request.app.state.repository
        candidate = repository.get_candidate(candidate_id)
        if candidate is None:
            raise HTTPException(status_code=404, detail="Candidate not found")
        current: Settings = request.app.state.settings
        path = _candidate_path(current, candidate, require_file=True)
        return FileResponse(
            path,
            media_type=candidate.get("mime_type") or None,
            headers={"Cache-Control": "private, no-store"},
        )

    @application.patch("/api/candidates/{candidate_id}")
    def review_candidate(
        payload: CandidateDecision,
        request: Request,
        candidate_id: str = Path(min_length=1, max_length=120),
    ) -> dict[str, Any]:
        repository: Repository = request.app.state.repository
        candidate = repository.get_candidate(candidate_id)
        if candidate is None:
            raise HTTPException(status_code=404, detail="Candidate not found")
        if payload.decision != "selected":  # pragma: no cover - Pydantic enforces this
            raise HTTPException(status_code=422, detail="Unsupported candidate decision")
        if candidate["review_status"] == "selected":
            _candidate_path(request.app.state.settings, candidate, require_file=True)
            return candidate

        current: Settings = request.app.state.settings
        source = _candidate_path(current, candidate, require_file=False)
        destination = _candidate_destination(current, candidate)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_file():
            if source.is_symlink():
                raise HTTPException(status_code=403, detail="Candidate symlinks are not allowed")
            if destination.exists():
                raise HTTPException(status_code=409, detail="Candidate destination already exists")
            try:
                os.replace(source, destination)
            except OSError as exc:
                raise HTTPException(
                    status_code=500, detail=f"Could not atomically promote candidate: {exc}"
                ) from exc
        elif not destination.is_file():
            raise HTTPException(status_code=404, detail="Candidate image is unavailable")
        relative_path = destination.relative_to(current.workspace_root.resolve()).as_posix()
        selected = repository.select_candidate(candidate_id, relative_path)
        if selected is None:  # pragma: no cover - row was read directly above
            raise HTTPException(status_code=404, detail="Candidate not found")
        repository.add_event(
            candidate["job_id"],
            "candidate.selected",
            {"candidate_id": candidate_id, "relative_path": relative_path},
            item_id=candidate_id,
        )
        return selected

    @application.delete("/api/candidates/{candidate_id}", status_code=204)
    def delete_candidate(
        request: Request,
        candidate_id: str = Path(min_length=1, max_length=120),
    ) -> Response:
        repository: Repository = request.app.state.repository
        candidate = repository.get_candidate(candidate_id)
        if candidate is None:
            raise HTTPException(status_code=404, detail="Candidate not found")
        path = _candidate_path(request.app.state.settings, candidate, require_file=False)
        if path.exists():
            if not path.is_file() or path.is_symlink():
                raise HTTPException(status_code=403, detail="Candidate is not a regular file")
            path.unlink()
        repository.add_event(
            candidate["job_id"],
            "candidate.deleted",
            {"candidate_id": candidate_id},
            item_id=candidate_id,
        )
        if not repository.delete_candidate(candidate_id):
            raise HTTPException(status_code=404, detail="Candidate not found")
        return Response(status_code=204)

    def run_workflow(
        action: str,
        payload: WorkflowRequest,
        request: Request,
    ) -> dict[str, Any]:
        runner: WorkflowRunner = request.app.state.workflow_runner
        repository: Repository = request.app.state.repository
        try:
            result = runner.execute(
                action=action,
                request=payload.model_dump(),
                repository=repository,
            )
        except WorkflowValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except WorkflowConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if result["status"] == "failed":
            detail = result["message"]
            if result.get("stderr"):
                detail = f"{detail}：{result['stderr'].strip().splitlines()[-1]}"
            raise HTTPException(status_code=502, detail=detail)
        return result

    @application.post("/api/workflow/prepare")
    def prepare_workflow(
        payload: WorkflowRequest,
        request: Request,
    ) -> dict[str, Any]:
        return run_workflow("prepare", payload, request)

    @application.post("/api/workflow/preview")
    def preview_workflow(
        payload: WorkflowRequest,
        request: Request,
    ) -> dict[str, Any]:
        return run_workflow("preview", payload, request)

    @application.post("/api/workflow/generate")
    def generate_workflow(
        payload: WorkflowRequest,
        request: Request,
    ) -> dict[str, Any]:
        require_live_generation(request)
        return run_workflow("generate", payload, request)

    return application


app = create_app()
