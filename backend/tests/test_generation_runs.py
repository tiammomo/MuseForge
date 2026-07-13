from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from backend.config import Settings
from backend.database import Repository
from backend.main import create_app


def _workspace(tmp_path: Path, *, script_body: str = "# placeholder\n") -> tuple[Path, Path]:
    root = tmp_path / "MuseForge"
    product = root / "原始商品图" / "SKU-1"
    task = root / "组合" / "SKU-1" / "单品"
    reference = task / "参考图"
    product.mkdir(parents=True)
    reference.mkdir(parents=True)
    (root / "配件超市").mkdir()
    (product / "source.png").write_bytes(b"source")
    (task / "prompts.json").write_text("[]", encoding="utf-8")
    (reference / "主商品-01.png").write_bytes(b"reference")
    (task / "reference_manifest.json").write_text(
        json.dumps({"references": [{"filename": "主商品-01.png"}]}),
        encoding="utf-8",
    )
    script = (
        root
        / ".agents"
        / "skills"
        / "generate-product-images"
        / "scripts"
        / "product_image_workflow.py"
    )
    script.parent.mkdir(parents=True)
    script.write_text(script_body, encoding="utf-8")
    return root, script


def _settings(tmp_path: Path, root: Path, script: Path, *, enabled: bool) -> Settings:
    return Settings(
        workspace_root=root,
        database_path=tmp_path / "data" / "test.sqlite3",
        workflow_script=script,
        live_generation_enabled=enabled,
        workflow_timeout_seconds=10,
    )


FAKE_GENERATOR = r'''
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

prefix = "MUSEFORGE_EVENT "
root = Path.cwd().resolve()
run_id = os.environ["MUSEFORGE_RUN_ID"]
run_dir = Path(os.environ["MUSEFORGE_RUN_DIR"]).resolve()
variants = int(os.environ["MUSEFORGE_VARIANTS"])

def values(flag: str) -> list[str]:
    result = []
    for index, value in enumerate(sys.argv):
        if value == flag and index + 1 < len(sys.argv):
            result.append(sys.argv[index + 1])
    return result

product = values("--product")[0]
tasks = values("--task")
shots = values("--shot")
print(prefix + json.dumps({"type": "plan", "run_id": run_id, "total_items": len(tasks) * len(shots) * variants}), flush=True)
time.sleep(0.35)
for task in tasks:
    for shot in shots:
        for candidate_index in range(1, variants + 1):
            target = run_dir / product / task / shot / f"candidate-{candidate_index:02d}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(f"image-{candidate_index}".encode())
            event = {
                "type": "item.saved",
                "run_id": run_id,
                "product": product,
                "task": task,
                "shot": shot,
                "candidate_index": candidate_index,
                "relative_path": target.relative_to(root).as_posix(),
                "filename": target.name,
                "prompt_filename": f"{product}-{shot}",
                "model": "test-image-model",
                "quality": "test",
                "estimated_cost": 0.01,
                "elapsed_seconds": 0.02,
            }
            print(prefix + json.dumps(event, ensure_ascii=False), flush=True)
'''


def _wait_for_run(client: TestClient, run_id: str) -> dict:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = client.get(f"/api/generation-runs/{run_id}")
        assert response.status_code == 200
        run = response.json()
        if run["status"] in {"completed", "failed"}:
            return run
        time.sleep(0.02)
    raise AssertionError("generation run did not finish")


def test_generation_run_requires_gate_and_narrow_scope(tmp_path: Path) -> None:
    root, script = _workspace(tmp_path)
    disabled = _settings(tmp_path, root, script, enabled=False)
    with TestClient(create_app(disabled)) as client:
        response = client.post(
            "/api/generation-runs",
            json={"product": "SKU-1", "tasks": ["单品"], "shots": ["main"]},
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "live_generation_disabled"

    enabled = replace(disabled, live_generation_enabled=True)
    with TestClient(create_app(enabled)) as client:
        preflight = client.options(
            "/api/candidates/candidate-id",
            headers={
                "Origin": "http://localhost:33020",
                "Access-Control-Request-Method": "DELETE",
            },
        )
        assert preflight.status_code == 200
        assert "DELETE" in preflight.headers["access-control-allow-methods"]
        assert client.get("/api/generation-runs/missing").status_code == 404
        assert client.get("/api/candidates/missing/image").status_code == 404
        assert client.post("/api/generation-runs", json={}).status_code == 422
        assert client.post(
            "/api/generation-runs",
            json={"product": "SKU-1", "tasks": [], "shots": ["main"]},
        ).status_code == 422
        assert client.post(
            "/api/generation-runs",
            json={"product": "SKU-1", "tasks": ["单品"], "shots": []},
        ).status_code == 422
        assert client.post(
            "/api/generation-runs",
            json={
                "product": "SKU-1",
                "tasks": ["单品"],
                "shots": ["main"],
                "variants": 7,
            },
        ).status_code == 422
        assert client.post(
            "/api/generation-runs",
            json={"product": "../escape", "tasks": ["单品"], "shots": ["main"]},
        ).status_code == 422
        assert client.post(
            "/api/generation-runs",
            json={"product": "SKU-1", "tasks": ["missing"], "shots": ["main"]},
        ).status_code == 422


def test_background_run_candidate_review_and_delete_round_trip(tmp_path: Path) -> None:
    root, script = _workspace(tmp_path, script_body=FAKE_GENERATOR)
    settings = _settings(tmp_path, root, script, enabled=True)
    with TestClient(create_app(settings)) as client:
        started = time.monotonic()
        response = client.post(
            "/api/generation-runs",
            json={
                "product": "SKU-1",
                "tasks": ["单品"],
                "shots": ["main"],
                "variants": 2,
                "concurrency": 2,
                "creativeBrief": {
                    "subject": "Keep the verified product complete.",
                    "environment": "Bright neutral tabletop.",
                    "composition": "Centered with generous safe margins.",
                    "negatives": "No unrelated props.",
                    "visibleText": "READY TO SHIP",
                },
            },
        )
        elapsed = time.monotonic() - started
        assert response.status_code == 202
        assert elapsed < 0.3
        queued = response.json()
        assert queued["status"] == "queued"
        assert queued["expected_candidate_count"] == 2
        assert queued["candidate_count"] == 0

        run = _wait_for_run(client, queued["id"])
        assert run["status"] == "completed"
        assert run["progress"] == 100
        assert run["candidate_count"] == 2
        assert run["pending_review_count"] == 2
        assert any(event["type"] == "item.saved" for event in run["events"])

        listing = client.get(
            "/api/generation-runs", params={"status": "completed"}
        ).json()
        assert listing["total"] == 1
        assert listing["items"][0]["request"]["variants"] == 2
        assert listing["items"][0]["request"]["creative_brief"]["visible_text"] == "READY TO SHIP"
        run_spec = json.loads(
            (root / ".museforge" / "runs" / queued["id"] / "run-spec.json").read_text(
                encoding="utf-8"
            )
        )
        assert run_spec["run_id"] == queued["id"]
        assert run_spec["creative_brief"]["environment"] == "Bright neutral tabletop."
        assert any(
            event["type"] == "run.started"
            and event["payload"]["creative_brief_applied"] is True
            for event in run["events"]
        )

        candidates = client.get(
            "/api/candidates",
            params={"job_id": queued["id"], "review_status": "pending"},
        ).json()
        assert candidates["total"] == 2
        first, second = candidates["items"]
        assert first["url"] == f"/api/candidates/{first['id']}/image"
        assert first["storage_status"] == "staged"
        image = client.get(first["url"])
        assert image.status_code == 200
        assert image.content in {b"image-1", b"image-2"}
        assert client.get(
            f"/api/workspace/assets/{first['relative_path']}"
        ).status_code == 403
        assert client.patch(
            f"/api/candidates/{first['id']}", json={"decision": "rejected"}
        ).status_code == 422

        selected_response = client.patch(
            f"/api/candidates/{first['id']}", json={"decision": "selected"}
        )
        assert selected_response.status_code == 200
        selected = selected_response.json()
        assert selected["review_status"] == "selected"
        assert selected["storage_status"] == "promoted"
        assert selected["relative_path"].startswith("组合/SKU-1/单品/主图/")
        promoted = root / selected["relative_path"]
        assert promoted.is_file()
        assert client.get(selected["url"]).status_code == 200

        # Selection is idempotent and never overwrites a second destination.
        repeated = client.patch(
            f"/api/candidates/{first['id']}", json={"decision": "selected"}
        )
        assert repeated.status_code == 200
        assert repeated.json()["relative_path"] == selected["relative_path"]

        second_path = root / second["relative_path"]
        assert second_path.is_file()
        assert client.delete(f"/api/candidates/{second['id']}").status_code == 204
        assert not second_path.exists()
        assert client.get(second["url"]).status_code == 404

        assert client.delete(f"/api/candidates/{first['id']}").status_code == 204
        assert not promoted.exists()
        assert client.get(first["url"]).status_code == 404
        assert client.get(
            "/api/candidates", params={"job_id": queued["id"]}
        ).json()["total"] == 0


def test_candidate_id_lookup_never_serves_tampered_paths(tmp_path: Path) -> None:
    root, script = _workspace(tmp_path)
    settings = _settings(tmp_path, root, script, enabled=True)
    repository = Repository(settings.database_path)
    repository.initialize()
    request = {
        "product": "SKU-1",
        "tasks": ["单品"],
        "shots": ["main"],
        "variants": 1,
        "concurrency": 1,
    }
    run = repository.create_generation_run(
        request=request,
        command=["python", str(script), "generate"],
    )
    secret = root / ".env"
    secret.write_text("SECRET=never-return-this", encoding="utf-8")
    item = repository.update_generation_item(
        run["id"],
        product="SKU-1",
        task="单品",
        shot="main",
        candidate_index=1,
        status="generated",
        relative_path=".env",
        filename="candidate.png",
    )
    assert item is not None

    with TestClient(create_app(settings)) as client:
        image = client.get(f"/api/candidates/{item['id']}/image")
        assert image.status_code == 403
        deleted = client.delete(f"/api/candidates/{item['id']}")
        assert deleted.status_code == 403
        assert secret.read_text(encoding="utf-8") == "SECRET=never-return-this"


def test_legacy_database_is_migrated_without_losing_jobs(tmp_path: Path) -> None:
    database = tmp_path / "legacy.sqlite3"
    timestamp = "2026-01-01T00:00:00+00:00"
    with sqlite3.connect(database) as connection:
        connection.executescript(
            """
            CREATE TABLE canvases (
                id TEXT PRIMARY KEY, document_json TEXT NOT NULL, version INTEGER NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE generation_jobs (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, action TEXT NOT NULL,
                status TEXT NOT NULL, request_json TEXT NOT NULL, command_json TEXT,
                message TEXT NOT NULL DEFAULT '', stdout TEXT NOT NULL DEFAULT '',
                stderr TEXT NOT NULL DEFAULT '', return_code INTEGER, created_at TEXT NOT NULL,
                started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL
            );
            """
        )
        connection.execute(
            """
            INSERT INTO generation_jobs(
                id, kind, action, status, request_json, created_at, updated_at
            ) VALUES ('legacy-job', 'workflow', 'preview', 'completed', '{}', ?, ?)
            """,
            (timestamp, timestamp),
        )

    repository = Repository(database)
    repository.initialize()
    assert repository.get_job("legacy-job") is not None
    with sqlite3.connect(database) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        assert {"generation_items", "generation_events"} <= tables
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 2
