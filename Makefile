.PHONY: install dev test lint types

# Stamp files make the install re-run only when a manifest or lockfile changes.
install: backend/.venv/.installed frontend/node_modules/.installed

backend/.venv/.installed: backend/pyproject.toml backend/uv.lock
	cd backend && uv sync
	@touch $@

frontend/node_modules/.installed: frontend/package.json frontend/package-lock.json
	cd frontend && npm install --no-fund --no-audit
	@touch $@

# Backend on :8000 and Vite on :5173. Ctrl-C (or either process exiting) stops both.
# The trap kills only the two children, never the process group make runs in.
dev: install
	@trap 'trap - INT TERM EXIT; kill $$be $$fe 2>/dev/null' INT TERM EXIT; \
	(cd backend && exec uv run uvicorn --factory app.main:create_app --reload --port 8000) & be=$$!; \
	(cd frontend && exec npm run dev) & fe=$$!; \
	while kill -0 $$be 2>/dev/null && kill -0 $$fe 2>/dev/null; do sleep 1; done; \
	exit 1

test:
	cd backend && uv run pytest
	cd frontend && npm test

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && npm run lint

# Pydantic is the source of truth: write shared/*.schema.json, then the TS types from them.
# --ignoreMinAndMaxItems keeps minItems arrays as plain T[]; tuples get exact types via `tsType` hints.
types: install
	cd backend && uv run python -m app.schema.export ../shared
	cd frontend && npx --no-install json2ts --ignoreMinAndMaxItems \
		--bannerComment "/* GENERATED — do not edit. Source: backend/app/schema; run make types. */" \
		-i ../shared/scene.schema.json -o src/types/scene.ts
	cd frontend && npx --no-install json2ts --ignoreMinAndMaxItems \
		--bannerComment "/* GENERATED — do not edit. Source: backend/app/schema; run make types. */" \
		-i ../shared/project.schema.json -o src/types/project.ts
	cd frontend && npx --no-install prettier --write --log-level warn src/types/scene.ts src/types/project.ts
