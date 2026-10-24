## The project in one paragraph
RoomLoom (code name `roomloom`) turns a one-shot Miro sketch import into a locked building shell (rooms, walls, openings, floor levels).
On top of that shell, users add objects, materials, a roof and photo pins.
They do this in **builder** mode, mostly by chatting with an AI agent (Claude) that sees where the user stands and looks.
**Viewer** mode is read-only: walk, fly, orbit, a minimap, a roof-off interior view, and photo pins.
There can be several projects. Read `plan/architecture.md` before any task.

## Stack
- **Backend:** Python 3.12, `uv`, FastAPI, Pydantic v2, `anthropic` SDK, `google-genai`, `httpx`, `shapely`, `numpy`, `Pillow`, `pytest`, `ruff`.
- **Frontend:** TypeScript (strict), Vite, three.js, `postprocessing`, `n8ao`, `three-mesh-bvh`, `vitest`. **No React or other UI framework.** Use small vanilla TS modules and plain DOM for panels.
- **Storage:** files on disk (`projects/<slug>/…`). No database in v1.

## Repo layout (target)
```
backend/app/
  main.py               FastAPI app, routers (Python package name: roomloom)
  schema/               Pydantic scene models  <- SINGLE SOURCE OF TRUTH
  store/                projects, scene IO, history, assets
  ops/                  operations, selectors, macro ops
  importers/miro/       one-shot Miro importer (CLI)
  geometry/             roof generator, polygon helpers
  agent/                Claude tool loop, tools, capabilities, backlog
  images/               photo upload, texture pipeline (Gemini)
  costs.py              API cost tracking and budget guard
frontend/src/
  app/                  router, app state, i18n
  engine/               renderer, quality presets, build/{shell,roof,objects,materials,pins}, reconciler
  controls/             walk, orbit, collision
  ui/                   minimap, hud, side-panel/{chat,photos,history,backlog}, project-picker
  net/                  REST client, websocket
  types/scene.ts        GENERATED, do not edit (also types/project.ts)
shared/
  scene.schema.json     GENERATED, do not edit
  prefabs.json          GENERATED from backend registry
projects/<slug>/        user data (git-ignored except projects/example-*)
data/                   global data: feature_requests.jsonl, costs.jsonl (git-ignored)
plan/                   architecture, conventions, limitations, tasks
```

## Commands
- `make dev`: backend on :8000 and Vite on :5173 (proxying `/api` and the websocket).
- `make test`: pytest and vitest.
- Linting is automatic: a Claude Code PostToolUse hook (`.claude/hooks/lint-edited.sh`) runs ruff on edited backend `.py` files and prettier/eslint/tsc on edited frontend files, and reports problems back. Edit files with the Write/Edit tools so the hook runs; no manual lint step.
- `make types`: regenerate `shared/*.json` and `frontend/src/types/{scene,project}.ts` from Pydantic.

## Local setup and workflow
- **Never use git worktrees** (no `EnterWorktree`, no `git worktree add`). Work in the main checkout on a feature branch. `plan/` is git-ignored, so it exists only there. `.claude/settings.json` sets `"worktree": {"bgIsolation": "none"}` so background sessions don't force worktrees either.
- `.env` already holds `MIRO_TOKEN` and `MIRO_BOARD_ID` for the user's real Miro board. Use them for manual checks against the live board (e.g. the importer in T04). Tests stay offline and mock Miro. Never print, log or commit their values.

## Golden rules
1. **Schema first.** Change Pydantic models in `backend/app/schema/`, then run `make types`. Never hand-edit generated files.
2. **Generic, not school-specific.** No domain words ("classroom", "blackboard" as a concept) in code logic. Domain flavour lives in each project's `profile_prompt`, in tags, and in prefab names that are generic (e.g. `wall_board`, not `blackboard`).
3. **The shell is locked, except ceiling heights.** Room polygons, walls, openings and floor levels are only produced by the importer. Ops may change room metadata (name, tags, notes, surface materials) and **ceiling height** (via `set_ceiling_height`, validated against openings). Wall heights and the roof base are derived from ceilings, never stored.
4. **All scene changes go through ops** (`backend/app/ops`). Nothing else writes `scene.json`. One user intent equals one change set, which equals one history snapshot.
5. **Capability honesty.** When you add or remove a feature, update `plan/limitations.md` and the relevant registry (tools, prefabs, primitives, roof types). The in-app agent's self-knowledge is generated from these. A feature not listed there does not exist for the agent.
6. **Coordinates:** metres, Y up. Miro plan `(x, y)` maps to world `(x, 0, y)`. North is −Z, the top of the Miro board. Angles in the schema are in degrees, yaw 0 faces north (−Z), increasing clockwise when seen from above. Convert at render time.
7. **Secrets** live in `.env` only. Keep `.env.example` up to date.
8. **Tests:** pytest for every backend module, vitest for pure frontend geometry and math. Tests are offline: mock Anthropic, Gemini and Miro. Use `projects/example-l-house` as the shared fixture.
9. **Performance budget:** 60 fps on a MacBook Air M1 at the "medium" preset with the example project. Prefer merged static geometry and instancing.
10. **Stay in scope.** Implement only the current task. Out-of-scope findings go to `plan/tasks/STATUS.md` under "Discovered".
11. **Small modules**, type hints everywhere, docstrings on public functions, no dead code.
12. **Keep `README.md` current.** When a change affects how to install, run, test or use the app (commands, ports, env keys, prerequisites, what the user sees), update `README.md` in the same change.

## Planning documents

Code is produced task by task by coding agents (Claude Code); `plan/tasks/STATUS.md` records which tasks are done.
`plan/` is git-ignored: it lives only in the local checkout and is never committed.

| File | Purpose |
|---|---|
| `AGENTS.md` | Rules every coding agent must follow in this repo |
| `plan/architecture.md` | The full system design |
| `plan/miro-conventions.md` | How to draw the Miro sketch (for you and classmates) |
| `plan/limitations.md` | What the app can and cannot do; the in-app agent reads this |
| `plan/tasks/README.md` | Task index, dependencies, milestones, prompt template |
| `plan/tasks/T01…T18` | One self-contained brief per task |
| `plan/tasks/STATUS.md` | Progress tracker, updated after every task |
