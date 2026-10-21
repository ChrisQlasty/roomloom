---
name: task-from-plan
description: Workflow for implementing a RoomLoom task (Txx) from plan/tasks. Use when asked to implement, start or continue a task such as T01, or when told to "work on the next task".
---

# Implement a RoomLoom task from the plan

1. Read `plan/architecture.md` and the task brief `plan/tasks/Txx-*.md` (the user names the task, e.g. "implement T01").
2. Implement only that task. Out-of-scope findings go to `plan/tasks/STATUS.md` under "Discovered".
3. Run `make test` and `make lint`. All acceptance criteria in the brief must pass before reporting done.
4. Summarize the diff for the user to review, try and commit.
5. Append a short entry to `plan/tasks/STATUS.md`: what was done, deviations, follow-ups.

If the brief conflicts with `plan/architecture.md`, stop and ask.
