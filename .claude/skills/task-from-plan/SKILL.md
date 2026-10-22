---
name: task-from-plan
description: Workflow for implementing a RoomLoom task (Txx) from plan/tasks. Use when asked to implement, start or continue a task such as T01, or when told to "work on the next task".
---

# Implement a RoomLoom task from the plan

1. Read `plan/architecture.md` and the task brief `plan/tasks/Txx-*.md` (the user names the task, e.g. "implement T01").
2. Implement only that task. Out-of-scope findings go to `plan/tasks/STATUS.md` under "Discovered".
3. Edit of source files with the Write/Edit triggers linters and reports problems back. Fix them as they appear; do not run lint commands by hand.
4. Run `make test`. All acceptance criteria in the brief must pass before reporting done.
5. Work on a branch (never commit on `main`). Commit in several small, sensibly grouped commits, not one big one: one commit per coherent unit (e.g. config/tooling, backend module + its tests, frontend module + its tests, docs). Each commit should leave the tree in a working state.
6. Summarize the commits for the user to review.
7. Append a short entry to `plan/tasks/STATUS.md`: what was done, deviations, follow-ups.

If the brief conflicts with `plan/architecture.md`, stop and ask.
