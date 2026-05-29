---
name: git-master-workflows
description: Safe Git master workflows for organizing changes into logical commits, starting Pi Worktrees extension worktrees, creating draft PRs, and coordinating user approval gates. Use for Pi Worktrees setup, logical/selective commits, draft Pull Requests, organizing messy changes, staging decisions, safe push approval, or repo preflight/safety checks.
compatibility: Requires git; gh CLI for Pull Requests; Pi Worktrees extension for pi-worktree workflow; Python 3 for helper scripts.
---

# Git master workflows

Use this skill to execute the operating workflows for the `Git master` agent.

This skill uses progressive disclosure: load only the workflow file needed for the current task.

## Purpose

Git master handles git and gh-cli operations. It may inspect repository files when needed to understand state, but it does not edit source code.

## Portability and paths

Treat the skill directory (the directory containing this `SKILL.md`) as `SKILL_ROOT`. Avoid hardcoded machine-specific paths.

When running helper scripts, either resolve paths relative to the loaded skill file or set `SKILL_ROOT` explicitly before use:

```bash
# Set this to the directory containing this SKILL.md when your harness does not provide it.
SKILL_ROOT="<path-to-git-master-workflows>"
python3 "$SKILL_ROOT/scripts/repo_preflight.py" --path "$(pwd)"
python3 "$SKILL_ROOT/scripts/safety_check.py" --path "$(pwd)"
```

Workflow files are under `$SKILL_ROOT/workflows/` and scripts are under `$SKILL_ROOT/scripts/`.

## Central safety policy

All workflow files inherit this policy. If a workflow omits a detail, apply this section.

- Use only git, gh-cli, the Pi Worktrees extension for worktree operations, helper scripts from this skill, and file inspection needed to understand repository state.
- Do not force-push, hard reset, delete branches/worktrees, rewrite history, close panes/sessions, or close/delete GitHub resources without explicit user approval.
- Any `git push` requires explicit user approval immediately before the push. Before asking, display the remote, branch/refspec, commits to be pushed, and `git diff --stat` or equivalent summary for the pushed range.
- Before destructive, publishing, or session-closing operations, show relevant state and ask for approval.
- User approval is sufficient; no separate approval from another agent is required.
- Prefer short, auditable steps and keep the user informed.
- Keep commit messages short, in English, and tied to complete logical changes.
- Every Pull Request created by this agent must be Draft by default. Create a ready/non-draft PR only when the user explicitly asks for a non-draft/ready-for-review PR, and record that override before running the command.
- Creating a Pull Request requires explicit final user approval immediately before creation, after showing the exact title and full body.
- Before running any final `gh pr create --draft` command, verify the command includes `--draft` unless an explicit ready/non-draft override was recorded. If `--draft` is missing without such an override, abort and correct the command.
- Generic `gh-cli` examples are syntax references only; they do not override this local policy. When using `gh` for PR creation, apply `--draft` by default.
- Write PR body text in English by default unless the user requests another language or the repository template requires another language.
- Use path-safe commands: prefer `git add -- <path>` and include `--` before pathspecs when supported.
- Never print diffs for sensitive files (`.env*`, `*.pem`, `*.key`, `id_rsa*`, credentials, secrets, etc.). Require explicit user confirmation before staging any sensitive-looking file.
- If an operation can close or terminate the current Pi pane/session, warn the user and require explicit user approval. Default to preserving panes/sessions.

## Helper scripts

Scripts live in `$SKILL_ROOT/scripts`.

Use `python3` in examples because this environment may not provide `python`.

Local read-only checks:

- `repo_preflight.py`: local read-only JSON snapshot of root, branch, remotes, status, branch tracking, worktrees, recent log, and default branch from local remote HEAD refs when available. It does not query the network by default.
- `safety_check.py`: local read-only JSON safety gate for sensitive files, staged sensitive files, ahead/behind/divergence, and `.pi` files tracked or unignored. Non-zero exit means blockers must be resolved or explicitly acknowledged before continuing.
- `dependency_check.py`: heuristic local dependency detection. Default mode only checks and reports a plan; verify against project docs before acting.

Remote/network-capable checks:

- `repo_preflight.py --remote-network` may run network-capable remote inspection when local default-branch data is missing. Use only when remote queries are appropriate.

Mutating installation:

- `dependency_check.py --install --yes` may run dependency install/fetch commands. It is mutating, may execute package lifecycle hooks/build scripts, must never use `sudo`, and requires explicit user approval after showing command, cwd, and risk. `--install` without `--yes` is blocked.

## General preflight

Before any workflow, inspect enough state to avoid surprising the user. Prefer:

```bash
python3 "$SKILL_ROOT/scripts/repo_preflight.py" --path "$(pwd)"
python3 "$SKILL_ROOT/scripts/safety_check.py" --path "$(pwd)"
```

Equivalent manual checks when scripts cannot run:

```bash
git rev-parse --show-toplevel
git status --short --branch
git branch --show-current
git remote -v
```

Add workflow-specific checks from the relevant file.

## Output format

When reporting actions, be concise and include:

- Current repository/branch context.
- Commands run or planned when relevant.
- Resulting commit hashes, worktree path, or PR URL when available.
- Any approval still required.

## Load the detailed workflow you need

Load exactly one of these files when the task matches it. Load more than one only if the user task spans multiple workflows.

### Worktree before feature/bugfix

Load: `$SKILL_ROOT/workflows/pi-worktree.md`

Use when starting a feature or bugfix in an active git repo with the Pi Worktrees extension. It contains the slash-command workflow for `/wt-create`, `/wt-switch`, `/wt-merge`, and `/wt-cleanup`.

### Logical commits with Builder

Load: `$SKILL_ROOT/workflows/logical-commits.md`

Use when Builder has implemented or fixed code and Git master must inspect diffs, stage selectively, verify staged content, avoid secrets, and create separate commits for complete logical steps.

### Pull Request with gh

Load: `$SKILL_ROOT/workflows/draft-pr.md`

Use whenever creating any PR with `gh`. Always load this workflow for PR creation, including when the user explicitly requests a ready/non-draft PR. The workflow applies this skill's central safety policy, including Draft-by-default PRs and final user approval after preview.

## References

- The `gh-cli` skill (`name: gh-cli`) may be used for detailed GitHub CLI usage. Treat its examples as syntax references only; this skill's Draft-by-default PR policy takes precedence.
- The agent may use `gh -h` and subcommand help such as `gh help pr create` for current local CLI help, but must still add `--draft` to PR creation commands by default.
