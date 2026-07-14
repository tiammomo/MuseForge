# MuseForge

> A local-first AI image production workspace for e-commerce teams.

MuseForge connects product assets, product truth, curated references, structured prompts, batch generation, candidate review, and canvas refinement in one traceable workflow. It is designed for teams that need to generate many product images without losing control over visual identity, factual accuracy, or final asset selection.

MuseForge 是一个面向电商视觉、运营和审核团队的本地优先 AI 生图工作站。它将商品资料、事实约束、参考图、结构化 Prompt、本地批量生图、候选审核与画布精修组织为一条可追踪的生产链。

## Why MuseForge

Most image-generation tools stop at a prompt box. MuseForge treats generation as a production process:

- product facts and references are validated before generation;
- each product task is expanded into five e-commerce shot types;
- local generation runs are visible as real queue records and progress events;
- generated images remain temporary until a reviewer explicitly keeps them;
- rejected candidates can be removed without entering the formal asset library;
- selected results can continue into a task-aware editing canvas.

## Product workflow

```text
Source assets
  → Product truth and reference curation
  → Product × task × shot matrix
  → Local Skill preflight
  → Batch generation queue
  → Temporary candidates
  → Four-up review
  → Keep or delete
  → Canvas refinement and delivery
```

The built-in e-commerce matrix covers:

| Dimension | Values |
| --- | --- |
| Task | Standalone product or product + accessory combinations |
| Shot | Main, size, lifestyle scene, detail, comparison |
| Candidate count | 1–6 candidates per task × shot |
| Local concurrency | 1–10 workers |

## Current capabilities

### Batch image production

- Workspace scanning for products, accessories, prepared tasks, prompts, and outputs.
- Product/task/shot matrix with readiness checks and blocked-item prevention.
- Asynchronous generation runs backed by FastAPI and SQLite.
- Structured workflow events and browser polling for real progress visibility.
- Immutable per-run `run-spec.json` snapshots for canvas-authored creative direction.
- Run-level candidate staging under `workspace/.museforge/runs/`.
- Four-up candidate review, multi-select keep, and confirmed cleanup of rejected images.
- Atomic promotion of kept candidates into the formal `workspace/组合/` library.
- Stable formal-asset URLs when a selected result is sent to the canvas.

### Skill integration

- Bundled `generate-product-images` Skill for e-commerce product-image preparation.
- Product-truth, reference-boundary, shot-specific, diversity, and physical-interaction rules.
- Curated `参考图/` and `reference_manifest.json` gates before live generation.
- Multiple non-overwriting candidates per task and shot.
- Machine-readable `MUSEFORGE_EVENT` progress output.
- Live image calls disabled by default behind an explicit server-side switch.

### Editing canvas

- Image and text layers with drag, resize, rotate, duplicate, delete, naming, visibility, locking, and ordering.
- Marquee selection, Shift multi-select, grouped movement, artboard snapping, batch alignment, and equal distribution.
- Select and hand tools, pointer-centered zoom, fit-to-artboard, and keyboard nudging.
- A real retained-results shelf backed by promoted review candidates, plus stable workspace-backed local-image import.
- Locked scene background and protected background properties.
- Structured creative-brief editor whose environment, composition, visible text, and negative constraints are appended to the verified Skill prompt at run time.
- Independent documents for every `product + task + shot` combination.
- Shareable `/studio?product=…&task=…&shot=…` context that restores the exact canvas.
- SQLite autosave, session cache, offline recovery, serial save queues, and load-failure protection.
- Fixed 1024 × 1024 PNG export without guides, selection boxes, or transformers.

## Technology stack

| Layer | Technology |
| --- | --- |
| Web UI | React 19, TypeScript, Vite, Zustand |
| Canvas | Konva, React Konva |
| API | FastAPI, Pydantic |
| Persistence | SQLite and workspace files |
| Workflow | Python subprocess adapter + bundled Skill |
| Image providers | Image2-compatible API; optional ComfyUI/CanvasPilot evolution path |

## Quick start

### Requirements

- Node.js `>= 22.19`
- Python `>= 3.11`
- A modern Chromium-based browser

### Install and run

```bash
git clone git@github.com:tiammomo/MuseForge.git
cd MuseForge

npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt

npm run dev
```

Open the workspace at <http://127.0.0.1:33020>.

| Service | Address |
| --- | --- |
| UI | <http://127.0.0.1:33020> |
| API | <http://127.0.0.1:38120> |
| OpenAPI | <http://127.0.0.1:38120/docs> |
| Optional ComfyUI | `http://127.0.0.1:38188` |

If the API is unavailable, the browser enters a clearly labeled demonstration mode. Canvas interactions remain available, but no real workflow, file deletion, or image generation is performed.

## Workspace contract

```text
MuseForge/
├── .agents/skills/generate-product-images/
├── workspace/                       # runtime product data, separate from source
│   ├── 原始商品图/<product>/
│   ├── 配件超市/<accessory>/
│   ├── 组合/<product>/<task>/
│   └── .museforge/runs/             # temporary generation candidates
├── backend/data/museforge.sqlite3   # runtime metadata, ignored by Git
└── .env                             # local secrets, ignored by Git
```

The repository includes `MF-DEMO-001` as a small example workspace.

## Prepare a product workflow

The API safely wraps the bundled Skill, and the same preparation commands can be run directly:

```bash
.venv/bin/python \
  .agents/skills/generate-product-images/scripts/product_image_workflow.py \
  prepare --product "MF-DEMO-001" --refresh-prompts

.venv/bin/python \
  .agents/skills/generate-product-images/scripts/product_image_workflow.py \
  preview --product "MF-DEMO-001" --task "单品" --shot lifestyle-scene
```

`prepare` creates or refreshes task and prompt baselines. It does not silently curate visual references. Before live generation, each task must publish an approved `参考图/` set and matching `reference_manifest.json`.

## Enable live generation

Live image calls are intentionally disabled by default.

```bash
cp .env.example .env
```

Configure the provider in `.env`:

```dotenv
MUSEFORGE_ENABLE_LIVE_GENERATION=true
IMAGE_API_BASE_URL=https://your-image-provider.example/v1
IMAGE_API_ENDPOINT=/images/edits
IMAGE_API_KEY=replace-me
IMAGE_MODEL=gpt-image-2
```

Restart the API after changing `.env`. Existing shell environment variables take precedence over file values.

Never place API keys in frontend source, canvas documents, prompt files, or committed Git history.

## Candidate storage semantics

Candidates are not formal assets when generated:

```text
workspace/.museforge/runs/<run-id>/<product>/<task>/<shot>/candidate-XX.png
```

Each run also contains `run-spec.json`. The backend writes this file from the validated request before launching the Skill. Canvas creative direction is additive: it cannot replace verified product facts, curated reference boundaries, physical constraints, or compliance policy in the task prompt.

- `pending`: temporary local candidate, visible through its database ID.
- `selected/promoted`: atomically moved into `workspace/组合/<product>/<task>/<中文图型>/`.
- deleted: candidate file and candidate row are removed; the minimal run audit event remains.

This boundary lets the website visualize the production process while only retained images enter the long-lived asset workspace.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service and live-generation readiness |
| `GET` | `/api/workspace` | Scan products, tasks, prompts, and outputs |
| `POST` | `/api/workspace/assets/import` | Persist a canvas import under the selected product and return a stable URL |
| `GET/PUT` | `/api/canvases/{id}` | Load or save a canvas document |
| `POST` | `/api/generation-runs` | Create an asynchronous local batch run |
| `GET` | `/api/generation-runs` | List real generation runs |
| `GET` | `/api/generation-runs/{id}` | Read run progress and events |
| `GET` | `/api/candidates` | List staged or selected candidates |
| `PATCH` | `/api/candidates/{id}` | Keep and promote a candidate |
| `DELETE` | `/api/candidates/{id}` | Delete a candidate and its file |
| `POST` | `/api/workflow/prepare` | Prepare prompts and task directories |
| `POST` | `/api/workflow/preview` | Validate the requested workflow scope |

See the running OpenAPI page for request and response schemas.

## Verification

```bash
npm run typecheck
npm run build
npm run test:backend

# Complete project verification
npm run verify

# Skill staging tests
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest \
  .agents/skills/generate-product-images/scripts/test_staged_generation.py \
  -q -p no:cacheprovider
```

The current suite covers API persistence, path security, stable canvas imports, run creative snapshots, database migration, asynchronous runs, structured events, staging, promotion, deletion, and multi-candidate output behavior.

## Security model

- The API binds to `127.0.0.1` by default.
- Browser requests cannot choose executable or script paths.
- Workflow commands use argument arrays with `shell=False`.
- Product, task, shot, candidate, canvas, and asset paths are validated at trust boundaries.
- `.museforge` staging files cannot be read through the generic workspace asset route.
- Live generation requires both an explicit server switch and an explicit product/task/shot request.
- Existing source assets, curated references, prompts, and formal outputs are outside rejected-candidate cleanup scope.

## Documentation

- [Product specification](docs/product-spec.md)
- [Canvas product and engineering roadmap](docs/canvas-roadmap.md)
- [Visual system and interaction direction](docs/design-system.md)
- [Technical architecture and security boundaries](docs/architecture.md)
- [Local Skill batch-generation lifecycle](docs/local-batch-generation.md)
- [Development and operations guide](docs/development.md)
- [Bundled generate-product-images Skill](.agents/skills/generate-product-images/SKILL.md)

## Project status

MuseForge is currently a local-first workstation. The documented cloud evolution uses a local companion to synchronize events and user decisions while uploading only retained assets to permanent storage. Multi-user permissions, remote workers, object storage, and cross-device review are future deployment layers rather than implicit behavior in the current local build.
