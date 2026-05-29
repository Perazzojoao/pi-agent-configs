---
name: git-master-workflows
description: Safe Git master workflows for organizing changes into logical commits, starting Herdr git worktrees, creating draft PRs, and coordinating Builder/Reviewer gates. Use for git worktree setup, logical/selective commits, draft Pull Requests, organizing messy changes, staging decisions, safe push approval, or repo preflight/safety checks.
compatibility: Requires git; gh CLI for Pull Requests; Herdr/Pi environment for herdr-worktree integration; Python 3 for helper scripts.
---

# Git master workflows

Use this skill to execute the operating workflows for the `Git master` agent defined at `/home/perazzojoao/.pi/agent/agents/git-master.md`.

This skill uses progressive disclosure: load only the workflow file needed for the current task.

## Purpose

Git master handles git and gh-cli operations. It may inspect repository files when needed to understand state, but it does not edit source code.

## Common rules

- Use only git, gh-cli, Herdr/Pi worktree integration, helper scripts from this skill, and file inspection needed to understand repository state.
- Do not force-push, hard reset, delete branches/worktrees, rewrite history, close panes/sessions, or close/delete GitHub resources without explicit user approval.
- Any `git push` requires explicit approval immediately before the push. Before asking, display the remote, branch/refspec, commits to be pushed, and `git diff --stat` or equivalent summary for the pushed range.
- Before destructive, publishing, or session-closing operations, show relevant state and ask for approval.
- Prefer short, auditable steps and keep the user informed.
- Keep commit messages short, in English, and tied to complete logical changes.
- Every Pull Request created by this agent must be Draft by default. Create a ready/non-draft PR only when the user explicitly asks for a non-draft/ready-for-review PR, and record that override before running the command.
- Before running any final `gh pr create --draft` command, verify the command includes `--draft` unless an explicit ready/non-draft override was recorded. If `--draft` is missing without such an override, abort and correct the command.
- Generic `gh-cli` examples are syntax references only; they do not override this local policy. When using `gh` for PR creation, apply `--draft` by default.
- Write PR body text in English by default unless the user requests another language or the repository template requires another language.
- Use path-safe commands: prefer `git add -- <path>` and include `--` before pathspecs when supported.
- Never print diffs for sensitive files (`.env*`, `*.pem`, `*.key`, `id_rsa*`, credentials, secrets, etc.). Require explicit confirmation before staging any sensitive-looking file.

## Helper scripts

Scripts live in:

`/home/perazzojoao/.pi/agent/skills/git-master-workflows/scripts`

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
python3 /home/perazzojoao/.pi/agent/skills/git-master-workflows/scripts/repo_preflight.py --path "$(pwd)"
python3 /home/perazzojoao/.pi/agent/skills/git-master-workflows/scripts/safety_check.py --path "$(pwd)"
```

Equivalent manual checks when scripts cannot run:

```bash
git rev-parse --show-toplevel
git status --short --branch
git branch --show-current
git remote -v
```

Add workflow-specific checks from the relevant file.

## Safety policy

Ask for explicit user approval before:

- Any `git push`, including first push of a branch. Show remote, branch/refspec, commits and diff stat first.
- `git push --force` or any force-with-lease equivalent.
- `git reset --hard`.
- Deleting branches, tags, remotes, worktrees, panes, sessions, PRs, issues, or releases.
- Rewriting published history.
- Creating a Pull Request.
- Staging sensitive-looking files.

If the operation can close or terminate the current Herdr/Pi pane/session, warn the user and require explicit approval. Default to preserving panes/sessions.

## Output format

When reporting actions, be concise and include:

- Current repository/branch context.
- Commands run or planned when relevant.
- Resulting commit hashes, worktree path, or PR URL when available.
- Any approval still required.

## Load the detailed workflow you need

Load exactly one of these files when the task matches it. Load more than one only if the user task spans multiple workflows.

### Herdr worktree before feature/bugfix

Load:

`/home/perazzojoao/.pi/agent/skills/git-master-workflows/workflows/herdr-worktree.md`

Use when starting a feature or bugfix in an active git repo. It contains the full Herdr worktree procedure, including `@agent/extensions/herdr-worktree/index.ts`, `herdr_start_worktree`, `/herdr-worktree-start`, flags, preconditions, risks, branch/label/source guidance, dependency verification, and extension behavior.

### Logical commits with Builder

Load:

`/home/perazzojoao/.pi/agent/skills/git-master-workflows/workflows/logical-commits.md`

Use when Builder has implemented or fixed code and Git master must inspect diffs, stage selectively, verify staged content, avoid secrets, and create separate commits for complete logical steps.

### Pull Request with gh

Load:

`/home/perazzojoao/.pi/agent/skills/git-master-workflows/workflows/draft-pr.md`

Use whenever creating any PR with `gh`. Always load this workflow for PR creation, including when the user explicitly requests a ready/non-draft PR. The workflow manages the Draft-by-default policy and records any explicit ready/non-draft override. It contains explicit Reviewer + user approval gates, branch/remote/push preflight, repo/base/head resolution, English PR body defaults, the required pre-command `--draft` safety checklist, and safe `gh pr create --draft` command form.

## References

- `/home/perazzojoao/.agents/skills/gh-cli/SKILL.md` (`name: gh-cli`) for detailed GitHub CLI usage. Treat its examples as syntax references only; this skill's Draft-by-default PR policy takes precedence.
- The agent may use `gh -h` and subcommand help such as `gh help pr create` for current local CLI help, but must still add `--draft` to PR creation commands by default.
