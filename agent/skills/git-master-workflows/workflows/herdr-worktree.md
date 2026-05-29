# Worktree workflow

Use this workflow before starting any feature or bugfix in an active git repository.

Apply the central safety policy from `$SKILL_ROOT/SKILL.md`, especially approval requirements for destructive operations, pushes, dependency installation, and closing panes/sessions.

## 1. Inspect the current repository

Run the skill preflight scripts first:

```bash
python3 "$SKILL_ROOT/scripts/repo_preflight.py" --path "$(pwd)"
python3 "$SKILL_ROOT/scripts/safety_check.py" --path "$(pwd)"
```

Confirm:

- The current directory is inside a git repository.
- The task is a feature or bugfix that should not be done directly in the current checkout.
- There are no unexpected uncommitted changes that would be stranded or mixed into the new worktree.
- The intended base ref is known. If unspecified, derive/confirm the repo default branch instead of assuming `master`.

## 2. Derive the source checkout safely

Always derive `--source` from the active repository root:

```bash
SOURCE_CHECKOUT="$(git rev-parse --show-toplevel)"
```

Do not rely on hardcoded source defaults.

## 3. Choose the worktree integration path

Prefer the Herdr/Pi integration only when it is available and appropriate for the current session. If Herdr/Pi is unavailable, use the native git fallback in step 7.

Herdr extension location, relative to the Pi agent root when installed:

```text
agent/extensions/herdr-worktree/index.ts
```

Extension name: `pi-herdr-worktree`.

It registers:

- Tool: `herdr_start_worktree`
- Command: `/herdr-worktree-start`

Prefer `/herdr-worktree-start` because it accepts explicit `--source`.

Use `herdr_start_worktree` only when you can pass safe parameters and preserve the old pane (`closeOldPane: false`).

## 4. Verify Herdr preconditions and risks

Check or reason about:

- `HERDR_ENV=1` is present when running inside Herdr.
- `HERDR_PANE_ID` exists if any pane-close operation is considered.
- The active Pi session is persisted.
- `sourceCheckout` exists and is the `git rev-parse --show-toplevel` result.
- `herdr worktree create` can return JSON with `worktree.path` and `root_pane.pane_id`.

Important behavior and risks:

- On success, the extension continues the active Pi session in the new worktree pane.
- Closing/cleaning up the old pane/session can terminate the current context.
- On success it may call `ctx.shutdown` with terminate behavior.
- It does not remove the new worktree as a full rollback if a later step fails.
- Default safe behavior is to preserve the old pane/session with `--no-close-pane` or `closeOldPane: false`.
- Closing an old pane/session requires explicit user approval after showing the pane/session that would be closed.

If these preconditions are not met, do not use Herdr-specific commands; use native `git worktree` instead.

## 5. Preferred Herdr command form

Use explicit source and safe pane behavior by default:

```text
/herdr-worktree-start --branch <branch> --base <ref> --label <label> --source <git-root> --no-close-pane
```

Supported arguments:

```text
/herdr-worktree-start [branch] [label]
/herdr-worktree-start --branch <branch> --base <ref> --label <label> --source <path> --no-close-pane --no-copy-extension
```

The command calls `ctx.waitForIdle` before running.

Recommendations:

- `--branch`: use a clear branch such as `feature/<short-topic>` or `fix/<short-topic>`.
- `--base`: set explicitly to the intended base/default branch.
- `--label`: use a short Herdr label matching the task.
- `--source`: always set to `$(git rev-parse --show-toplevel)`.
- `--no-close-pane`: include by default. Omit it only after explicit user approval to close the old pane/session.
- `--no-copy-extension`: use only when copying the extension into the worktree is not desired.

## 6. Herdr tool form when command form is unavailable

`herdr_start_worktree` parameters:

- `branch?`
- `base?` default `master`
- `label?`
- `closeOldPane?` default `true`
- `copyExtension?` default `true`

Use it only when:

- The source behavior is confirmed safe for the current repository.
- You pass the intended `base`; do not rely on `master` unless verified.
- You set `closeOldPane: false` unless the user explicitly approved closing the old pane/session.

## 7. Native git worktree fallback

Use this path when Herdr/Pi integration is unavailable, not appropriate, or not requested.

Choose a sibling worktree path that is outside the current checkout but near the repository, for example:

```bash
SOURCE_CHECKOUT="$(git rev-parse --show-toplevel)"
REPO_PARENT="$(dirname "$SOURCE_CHECKOUT")"
WORKTREE_PATH="$REPO_PARENT/<repo-name>-<short-topic>"
```

Create the worktree from the intended base with an explicit branch:

```bash
git fetch --all --prune
git worktree add -b <branch> "$WORKTREE_PATH" <base-ref>
```

If the branch already exists locally and the user wants to reuse it, use:

```bash
git worktree add "$WORKTREE_PATH" <branch>
```

After creation:

```bash
git -C "$WORKTREE_PATH" status --short --branch
```

Do not delete, prune, move, or overwrite existing worktrees/branches without explicit user approval under the central safety policy.

## 8. Verify dependencies in the worktree before finalizing

After the worktree path is known, run dependency detection in the new worktree:

```bash
python3 "$SKILL_ROOT/scripts/dependency_check.py" --path <worktreePath>
```

The check is heuristic. If dependencies appear missing:

1. Report the detected ecosystem, exact install/fetch command, cwd, and the risk that dependency installs may execute package lifecycle hooks/build scripts.
2. Check that the command is appropriate and safe for this project.
3. Always ask for explicit user approval before any installation, even when exactly one ecosystem/command is unambiguous.
4. Only after approval, run:

```bash
python3 "$SKILL_ROOT/scripts/dependency_check.py" --path <worktreePath> --install --yes
```

5. If multiple ecosystems are detected, a command is ambiguous, or the install has unusual side effects, ask the user to choose/confirm the command before running anything.
6. Never use `sudo`.

## 9. Internal Herdr behavior to understand

The Herdr extension uses commands equivalent to:

```bash
herdr worktree create --cwd <sourceCheckout> --base <base> --focus --json [--branch] [--label]
herdr pane run <rootPaneId> "pi --session <newSessionFile> 'Moved to worktree <path>. Continue.'"
herdr workspace focus <workspaceId>
```

It copies the extension to:

```text
<worktreePath>/.pi/extensions/herdr-worktree/
```

excluding `node_modules`.
