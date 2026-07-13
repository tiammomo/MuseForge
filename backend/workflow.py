from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import queue
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from .config import Settings
from .database import Repository


ALLOWED_ACTIONS = {"prepare", "preview", "generate"}
ALLOWED_SHOTS = {"main", "size", "lifestyle-scene", "detail", "comparison"}
GENERATION_EVENT_PREFIX = "MUSEFORGE_EVENT "
GENERATION_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}


class WorkflowValidationError(ValueError):
    pass


class WorkflowConfigurationError(RuntimeError):
    pass


def validate_folder_name(value: str, *, field: str) -> str:
    """Accept exactly one ordinary path segment and reject traversal/control input."""
    if not isinstance(value, str):
        raise WorkflowValidationError(f"{field} must be a string")
    if value != value.strip() or not value:
        raise WorkflowValidationError(f"{field} cannot be empty or padded with whitespace")
    if len(value) > 120:
        raise WorkflowValidationError(f"{field} is too long")
    if value in {".", ".."} or value.startswith("."):
        raise WorkflowValidationError(f"{field} cannot be a hidden or traversal segment")
    if "/" in value or "\\" in value or "\x00" in value:
        raise WorkflowValidationError(f"{field} must be one folder name, not a path")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise WorkflowValidationError(f"{field} contains control characters")
    if Path(value).is_absolute() or Path(value).name != value:
        raise WorkflowValidationError(f"{field} must be one relative folder name")
    return value


def validate_shot(value: str) -> str:
    if value not in ALLOWED_SHOTS:
        choices = ", ".join(sorted(ALLOWED_SHOTS))
        raise WorkflowValidationError(f"shot must be one of: {choices}")
    return value


class WorkflowRunner:
    """Safe adapter around the deterministic product image workflow script."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def _validate_product_exists(self, product: str | None) -> None:
        if product is None:
            return
        product_root = (self.settings.workspace_root / "原始商品图").resolve()
        candidate = (product_root / product).resolve()
        try:
            candidate.relative_to(product_root)
        except ValueError as exc:  # pragma: no cover - validate_folder_name already blocks this
            raise WorkflowValidationError("product escapes 原始商品图") from exc
        if not candidate.is_dir():
            raise WorkflowValidationError(f"product does not exist: {product}")

    def _validate_generation_tasks(self, product: str, tasks: list[str]) -> None:
        accessory_root = (self.settings.workspace_root / "配件超市").resolve()
        product_output = (self.settings.workspace_root / "组合" / product).resolve()
        for task in tasks:
            if task == "单品":
                continue
            accessory = (accessory_root / task).resolve()
            prepared_variant = (product_output / task).resolve()
            try:
                accessory.relative_to(accessory_root)
                prepared_variant.relative_to(product_output)
            except ValueError as exc:  # pragma: no cover - folder validation guards this
                raise WorkflowValidationError("task escapes its workspace directory") from exc
            if accessory.is_dir():
                continue
            if task.startswith("单品-") and (
                prepared_variant.is_dir()
                and (prepared_variant / "prompts.json").is_file()
            ):
                continue
            raise WorkflowValidationError(f"generation task does not exist: {task}")

    def build_command(self, action: str, request: dict[str, Any]) -> list[str]:
        if action not in ALLOWED_ACTIONS:
            raise WorkflowValidationError(f"Unsupported workflow action: {action}")
        if not self.settings.workflow_script.is_file():
            raise WorkflowConfigurationError(
                f"Workflow script not found: {self.settings.workflow_script}"
            )

        product = request.get("product")
        if product is not None:
            product = validate_folder_name(product, field="product")
        tasks = request.get("tasks") or []
        shots = request.get("shots") or []
        if not isinstance(tasks, list) or not isinstance(shots, list):
            raise WorkflowValidationError("tasks and shots must be lists")
        validated_tasks = [
            validate_folder_name(task, field=f"tasks[{index}]")
            for index, task in enumerate(tasks)
        ]
        validated_shots = [validate_shot(shot) for shot in shots]
        if len(set(validated_tasks)) != len(validated_tasks):
            raise WorkflowValidationError("tasks cannot contain duplicates")
        if len(set(validated_shots)) != len(validated_shots):
            raise WorkflowValidationError("shots cannot contain duplicates")
        self._validate_product_exists(product)

        combinations_only = bool(request.get("combinations_only"))
        variants_only = bool(request.get("variants_only"))
        if combinations_only and variants_only:
            raise WorkflowValidationError(
                "combinations_only and variants_only are mutually exclusive"
            )
        if combinations_only and "单品" in validated_tasks:
            raise WorkflowValidationError(
                "combinations_only cannot be combined with task 单品"
            )
        if action == "generate":
            if product is None:
                raise WorkflowValidationError(
                    "live generation requires one explicit product"
                )
            if not validated_tasks:
                raise WorkflowValidationError(
                    "live generation requires at least one explicit task"
                )
            if not validated_shots:
                raise WorkflowValidationError(
                    "live generation requires at least one explicit shot"
                )
            self._validate_generation_tasks(product, validated_tasks)

        # The only executable is the reviewed workflow script. In particular, this
        # adapter never invokes image2_combo_batch.py or accepts a user-supplied path.
        command = [sys.executable, str(self.settings.workflow_script), action]
        if product:
            command.extend(["--product", product])
        for task in validated_tasks:
            command.extend(["--task", task])
        if action in {"preview", "generate"}:
            for shot in validated_shots:
                command.extend(["--shot", shot])
        if combinations_only:
            command.append("--combinations-only")
        if variants_only:
            command.append("--variants-only")
        if request.get("refresh_prompts"):
            command.append("--refresh-prompts")
        if action == "generate" and request.get("overwrite"):
            command.append("--overwrite")
        concurrency = request.get("concurrency")
        if action == "generate":
            concurrency = 1 if concurrency is None else concurrency
            try:
                numeric_concurrency = int(concurrency)
            except (TypeError, ValueError) as exc:
                raise WorkflowValidationError("concurrency must be an integer") from exc
            if not 1 <= numeric_concurrency <= 10:
                raise WorkflowValidationError("concurrency must be between 1 and 10")
            command.extend(["--concurrency", str(numeric_concurrency)])
        return command

    def execute(
        self,
        *,
        action: str,
        request: dict[str, Any],
        repository: Repository,
    ) -> dict[str, Any]:
        command = self.build_command(action, request)
        job = repository.create_job(action=action, request=request, command=command)
        repository.mark_job_running(job["id"])
        try:
            process_env = os.environ.copy()
            process_env["MUSEFORGE_WORKSPACE_ROOT"] = str(
                self.settings.workspace_root.resolve()
            )
            completed = subprocess.run(
                command,
                cwd=self.settings.workspace_root,
                env=process_env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.settings.workflow_timeout_seconds,
                check=False,
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout if isinstance(exc.stdout, str) else ""
            stderr = exc.stderr if isinstance(exc.stderr, str) else ""
            return repository.finish_job(
                job["id"],
                status="failed",
                message=f"工作流超过 {self.settings.workflow_timeout_seconds} 秒，已停止等待",
                stdout=stdout,
                stderr=stderr,
            )
        except OSError as exc:
            return repository.finish_job(
                job["id"],
                status="failed",
                message=f"无法启动工作流：{exc}",
                stderr=str(exc),
            )

        if completed.returncode == 0:
            messages = {
                "prepare": "提示词与任务目录准备完成",
                "preview": "缺失图片预览完成，未调用生图服务",
                "generate": "实时生图工作流执行完成",
            }
            status = "completed"
            message = messages[action]
        else:
            status = "failed"
            message = f"工作流执行失败（退出码 {completed.returncode}）"
        return repository.finish_job(
            job["id"],
            status=status,
            message=message,
            stdout=completed.stdout,
            stderr=completed.stderr,
            return_code=completed.returncode,
        )

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _parse_generation_event(line: str) -> dict[str, Any] | None:
        if not line.startswith(GENERATION_EVENT_PREFIX):
            return None
        raw = line[len(GENERATION_EVENT_PREFIX) :].strip()
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            return {"type": "event.invalid", "error": "invalid JSON", "raw": raw[:1000]}
        if not isinstance(event, dict):
            return {"type": "event.invalid", "error": "event must be an object"}
        return event

    def _validate_event_scope(
        self,
        event: dict[str, Any],
        request: dict[str, Any],
    ) -> tuple[str, str, str, int]:
        product = validate_folder_name(str(event.get("product") or ""), field="event.product")
        task = validate_folder_name(str(event.get("task") or ""), field="event.task")
        shot = validate_shot(str(event.get("shot") or ""))
        try:
            candidate_index = int(event.get("candidate_index"))
        except (TypeError, ValueError) as exc:
            raise WorkflowValidationError("event.candidate_index must be an integer") from exc
        variants = int(request.get("variants") or 1)
        if product != request.get("product"):
            raise WorkflowValidationError("event product is outside the generation run")
        if task not in (request.get("tasks") or []):
            raise WorkflowValidationError("event task is outside the generation run")
        if shot not in (request.get("shots") or []):
            raise WorkflowValidationError("event shot is outside the generation run")
        if not 1 <= candidate_index <= variants:
            raise WorkflowValidationError("event candidate index is outside the generation run")
        return product, task, shot, candidate_index

    def _apply_generation_event(
        self,
        *,
        job_id: str,
        event: dict[str, Any],
        request: dict[str, Any],
        run_dir: Path,
        repository: Repository,
    ) -> None:
        event_type = str(event.get("type") or "event.unknown")
        reported_run_id = event.get("run_id")
        if reported_run_id is not None and reported_run_id != job_id:
            raise WorkflowValidationError("event run_id does not match the active run")
        if event_type in {"plan", "run.started", "run.finished"}:
            repository.add_event(job_id, event_type, event)
            return
        if event_type == "event.invalid":
            repository.add_event(job_id, event_type, event)
            return
        if event_type not in {"item.started", "item.saved", "item.failed"}:
            repository.add_event(job_id, "event.unknown", event)
            return

        product, task, shot, candidate_index = self._validate_event_scope(event, request)
        common = {
            "job_id": job_id,
            "product": product,
            "task": task,
            "shot": shot,
            "candidate_index": candidate_index,
        }
        if event_type == "item.started":
            item = repository.update_generation_item(
                **common,
                status="running",
                metadata=event,
            )
        elif event_type == "item.failed":
            item = repository.update_generation_item(
                **common,
                status="failed",
                error=str(event.get("error") or "Image generation failed")[:4000],
                metadata=event,
            )
        else:
            relative_path = event.get("relative_path")
            if not isinstance(relative_path, str) or not relative_path:
                raise WorkflowValidationError("saved event is missing relative_path")
            if Path(relative_path).is_absolute() or "\x00" in relative_path:
                raise WorkflowValidationError("saved event path must be workspace-relative")
            candidate_path = (self.settings.workspace_root / relative_path).resolve()
            try:
                candidate_path.relative_to(run_dir.resolve())
            except ValueError as exc:
                raise WorkflowValidationError("saved candidate is outside its run directory") from exc
            expected_parent = (run_dir / product / task / shot).resolve()
            expected_name = f"candidate-{candidate_index:02d}"
            if candidate_path.parent != expected_parent or candidate_path.stem != expected_name:
                raise WorkflowValidationError("saved candidate path does not match its planned item")
            if (
                not candidate_path.is_file()
                or candidate_path.suffix.casefold() not in GENERATION_IMAGE_SUFFIXES
            ):
                raise WorkflowValidationError("saved candidate is not an allowed image file")
            canonical_relative = candidate_path.relative_to(
                self.settings.workspace_root.resolve()
            ).as_posix()
            stat = candidate_path.stat()
            item = repository.update_generation_item(
                **common,
                status="generated",
                relative_path=canonical_relative,
                filename=candidate_path.name,
                prompt_filename=str(event.get("prompt_filename") or event.get("filename") or ""),
                mime_type=mimetypes.guess_type(candidate_path.name)[0]
                or "application/octet-stream",
                size_bytes=stat.st_size,
                sha256=self._sha256(candidate_path),
                model=str(event["model"]) if event.get("model") else None,
                quality=str(event["quality"]) if event.get("quality") else None,
                estimated_cost=float(
                    event.get("estimated_cost", event.get("cost"))
                )
                if event.get("estimated_cost", event.get("cost")) is not None
                else None,
                elapsed_seconds=float(
                    event.get("elapsed_seconds", event.get("elapsed"))
                )
                if event.get("elapsed_seconds", event.get("elapsed")) is not None
                else None,
                metadata=event,
            )
        if item is None:
            raise WorkflowValidationError("event does not match a planned generation item")
        repository.add_event(job_id, event_type, event, item_id=item["id"])

    def execute_generation_run(
        self,
        *,
        job_id: str,
        request: dict[str, Any],
        command: list[str],
        repository: Repository,
    ) -> dict[str, Any]:
        """Execute one persisted run while streaming trusted machine events."""

        workspace_root = self.settings.workspace_root.resolve()
        runs_root = (workspace_root / ".museforge" / "runs").resolve()
        try:
            runs_root.relative_to(workspace_root)
        except ValueError as exc:
            raise RuntimeError("Generation runs root escaped the workspace") from exc
        run_dir = (runs_root / job_id).resolve()
        try:
            run_dir.relative_to(runs_root)
        except ValueError as exc:  # pragma: no cover - job ids are server generated
            raise RuntimeError("Generation run directory escaped its root") from exc
        run_dir.mkdir(parents=True, exist_ok=True)
        run_spec_path = run_dir / "run-spec.json"
        run_spec = {
            "version": 1,
            "run_id": job_id,
            "product": request.get("product"),
            "tasks": list(request.get("tasks") or []),
            "shots": list(request.get("shots") or []),
            "variants": int(request.get("variants") or 1),
            "concurrency": int(request.get("concurrency") or 1),
            "creative_brief": dict(request.get("creative_brief") or {}),
        }
        run_spec_path.write_text(
            json.dumps(run_spec, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        repository.mark_job_running(job_id)
        repository.add_event(
            job_id,
            "run.started",
            {
                "run_id": job_id,
                "spec": run_spec_path.relative_to(workspace_root).as_posix(),
                "creative_brief_applied": any(run_spec["creative_brief"].values()),
            },
        )

        env = os.environ.copy()
        env.update(
            {
                "PYTHONUNBUFFERED": "1",
                "MUSEFORGE_WORKSPACE_ROOT": str(workspace_root),
                "MUSEFORGE_RUN_ID": job_id,
                "MUSEFORGE_RUN_DIR": str(run_dir),
                "MUSEFORGE_RUN_SPEC_PATH": str(run_spec_path),
                "MUSEFORGE_VARIANTS": str(int(request.get("variants") or 1)),
            }
        )
        output_lines: deque[str] = deque(maxlen=4000)
        process: subprocess.Popen[str] | None = None
        try:
            process = subprocess.Popen(
                command,
                cwd=self.settings.workspace_root,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                shell=False,
            )
            if process.stdout is None:  # pragma: no cover - PIPE guarantees a stream
                raise RuntimeError("Generation workflow did not expose stdout")

            stream: queue.Queue[str | None] = queue.Queue()

            def read_stdout() -> None:
                try:
                    for line in process.stdout:
                        stream.put(line)
                finally:
                    stream.put(None)

            reader = threading.Thread(
                target=read_stdout,
                name=f"museforge-output-{job_id}",
                daemon=True,
            )
            reader.start()
            deadline = time.monotonic() + self.settings.workflow_timeout_seconds
            stream_finished = False
            while not stream_finished:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(command, self.settings.workflow_timeout_seconds)
                try:
                    line = stream.get(timeout=min(0.25, remaining))
                except queue.Empty:
                    if process.poll() is not None and not reader.is_alive():
                        break
                    continue
                if line is None:
                    stream_finished = True
                    continue
                output_lines.append(line)
                event = self._parse_generation_event(line.rstrip("\r\n"))
                if event is None:
                    continue
                try:
                    self._apply_generation_event(
                        job_id=job_id,
                        event=event,
                        request=request,
                        run_dir=run_dir,
                        repository=repository,
                    )
                except (WorkflowValidationError, OSError, ValueError) as exc:
                    repository.add_event(
                        job_id,
                        "event.rejected",
                        {"error": str(exc), "event": event},
                    )
            return_code = process.wait(
                timeout=max(0.1, deadline - time.monotonic())
            )
            missing = repository.fail_unfinished_items(
                job_id, "工作流结束但未收到该候选的结果"
            )
            run = repository.get_generation_run(job_id)
            failed_count = int(run["failed_count"] if run else missing)
            succeeded = return_code == 0 and failed_count == 0
            result = repository.finish_job(
                job_id,
                status="completed" if succeeded else "failed",
                message=(
                    "候选图已生成，等待审核"
                    if succeeded
                    else f"候选生成结束，{failed_count} 张失败"
                ),
                stdout="".join(output_lines),
                return_code=return_code,
            )
            repository.add_event(
                job_id,
                "run.finished",
                {
                    "status": result["status"],
                    "return_code": return_code,
                    "failed_count": failed_count,
                },
            )
            return repository.get_generation_run(job_id) or result
        except subprocess.TimeoutExpired:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
            repository.fail_unfinished_items(job_id, "工作流执行超时")
            result = repository.finish_job(
                job_id,
                status="failed",
                message=f"工作流超过 {self.settings.workflow_timeout_seconds} 秒，已停止",
                stdout="".join(output_lines),
            )
            repository.add_event(job_id, "run.failed", {"reason": "timeout"})
            return repository.get_generation_run(job_id) or result
        except Exception as exc:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
            repository.fail_unfinished_items(job_id, str(exc)[:4000])
            result = repository.finish_job(
                job_id,
                status="failed",
                message=f"无法完成候选生成：{exc}",
                stdout="".join(output_lines),
                stderr=str(exc),
            )
            repository.add_event(job_id, "run.failed", {"reason": str(exc)})
            return repository.get_generation_run(job_id) or result
