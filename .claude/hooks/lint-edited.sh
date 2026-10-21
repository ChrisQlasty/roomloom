#!/bin/bash
# PostToolUse hook (Write|Edit): format and lint the file Claude just changed.
# Backend .py -> ruff format + ruff check --fix.
# Frontend ts/js -> prettier + eslint --fix + tsc; css/json/html -> prettier.
# Remaining problems go to stderr with exit 2, so Claude sees them and fixes them.

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -n "$file" ] && [ -f "$file" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
rel="${file#"$root"/}"

fail() {
  echo "Lint failed for $rel:" >&2
  echo "$1" >&2
  exit 2
}

case "$rel" in
  backend/*.py)
    cd "$root/backend" || exit 0
    target="${rel#backend/}"
    uv run --quiet ruff format "$target" >/dev/null 2>&1
    out=$(uv run --quiet ruff check --fix "$target" 2>&1) || fail "$out"
    ;;
  frontend/node_modules/* | frontend/dist/*) ;;
  frontend/*.ts | frontend/*.js)
    cd "$root/frontend" || exit 0
    target="${rel#frontend/}"
    npx --no-install prettier --write --log-level warn "$target" >/dev/null 2>&1
    out=$(npx --no-install eslint --fix "$target" 2>&1) || fail "$out"
    out=$(npx --no-install tsc --noEmit 2>&1) || fail "$out"
    ;;
  frontend/*.css | frontend/*.json | frontend/*.html)
    cd "$root/frontend" || exit 0
    target="${rel#frontend/}"
    [ "$target" = "package-lock.json" ] && exit 0
    out=$(npx --no-install prettier --write --log-level warn "$target" 2>&1) || fail "$out"
    ;;
esac
exit 0
