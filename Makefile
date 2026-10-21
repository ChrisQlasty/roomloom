.PHONY: install dev test lint types

install:
	cd backend && uv sync
	cd frontend && npm install --no-fund --no-audit

# Backend on :8000 and Vite on :5173. Ctrl-C (or either process exiting) stops both.
dev: install
	@trap 'kill 0' INT TERM EXIT; \
	(cd backend && uv run uvicorn app.main:app --reload --port 8000) & \
	(cd frontend && npm run dev) & \
	wait

test:
	cd backend && uv run pytest
	cd frontend && npm test

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && npm run lint

types:
	@echo "TODO: generate shared/*.json and frontend/src/types/scene.ts (T02)"
