---
name: raise-pr
description: Open a GitHub pull request for the current branch with the gh CLI. Only run when the user explicitly invokes it (/raise-pr).
disable-model-invocation: true
---

# Raise a pull request

1. Check `git status`, the current branch and `git log main..HEAD`. Never open a PR from `main`: create a branch first. Commit nothing the user has not asked to be included.
2. Push the branch (`git push -u origin HEAD`).
3. Open the PR with `gh pr create --base main --title "<short imperative title>" --body-file <file>`. Write the body to a file in the scratchpad directory.
4. Report the PR URL.

## PR body

Use exactly these sections, in this order. Be concise and concrete.

```markdown
## Goal
What this PR achieves (one or two sentences; name the task, e.g. T05, if any).

## Why
The motivation or problem it solves.

## Features
- User-visible or agent-visible capabilities added or changed.

## What was changed
- Modules and files touched, grouped by area (backend / frontend / schema / plan).

## How to test
1. Exact commands (`make test`, `make lint`, `make dev`) and manual steps.
2. Expected result.
```
