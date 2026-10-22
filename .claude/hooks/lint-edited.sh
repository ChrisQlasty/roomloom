#!/bin/bash
# PostToolUse hook (Write|Edit): format and lint the file Claude just changed.
# Backend .py -> ruff format + ruff check --fix.
# Frontend ts/js -> prettier + eslint --fix + tsc (errors in the edited file only); css/json/html -> prettier.
# Remaining problems go to stderr with exit 2, so Claude sees them and fixes them.

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -n "$file" ] && [ -f "$file" ] || exit 0

# Resolve symlinks (/tmp vs /private/tmp) and take the root from the file's own checkout,
# so files in a git worktree are linted too. Files outside any roomloom checkout are skipped.
file=$(realpath "$file")
root=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$root/.claude/hooks/lint-edited.sh" ] || exit 0
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
    # tsc checks the whole project (incrementally); report only the edited file's errors,
    # so a multi-file refactor isn't blocked by callers not yet updated. `make lint` checks everything.
    out=$(npx --no-install tsc --noEmit --pretty false --incremental \
      --tsBuildInfoFile node_modules/.cache/lint-hook.tsbuildinfo 2>&1 | grep -F "$target(")
    [ -z "$out" ] || fail "$out"
    ;;
  frontend/*.css | frontend/*.json | frontend/*.html)
    cd "$root/frontend" || exit 0
    target="${rel#frontend/}"
    [ "$target" = "package-lock.json" ] && exit 0
    out=$(npx --no-install prettier --write --log-level warn "$target" 2>&1) || fail "$out"
    ;;
esac
exit 0
