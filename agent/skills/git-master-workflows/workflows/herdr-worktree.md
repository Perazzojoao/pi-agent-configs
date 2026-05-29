# Herdr worktree workflow

Use this workflow before starting any feature or bugfix in an active git repository.

## 1. Inspect the current repository

Run the skill preflight scripts first:

```bash
python3 /home/perazzojoao/.pi/agent/skills/git-master-workflows/scripts/repo_preflight.py --path "$(pwd)"
python3 /home/perazzojoao/.pi/agent/skills/git-master-workflows/scripts/safety_check.py --path "$(pwd)"
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

## 3. Choose the Herdr integration path

Extension:

```text
/home/perazzojoao/.pi/agent/extensions/herdr-worktree/index.ts
```

Extension name: `pi-herdr-worktree`.

It registers:

- Tool: `herdr_start_worktree`
- Command: `/herdr-worktree-start`

Prefer `/herdr-worktree-start` because it accepts explicit `--source`.

Use `herdr_start_worktree` only when you can pass safe parameters and preserve the old pane (`closeOldPane: false`).

## 4. Verify preconditions and risks

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

## 5. Preferred command form

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

## 6. Tool form when command form is unavailable

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

## 7. Verify dependencies in the worktree before finalizing

After the worktree path is known, run dependency detection in the new worktree:

```bash
python3 /home/perazzojoao/.pi/agent/skills/git-master-workflows/scripts/dependency_check.py --path <worktreePath>
```

The check is heuristic. If dependencies appear missing:

1. Report the detected ecosystem, exact install/fetch command, cwd, and the risk that dependency installs may execute package lifecycle hooks/build scripts.
2. Check that the command is appropriate and safe for this project.
3. Always ask for explicit user approval before any installation, even when exactly one ecosystem/command is unambiguous.
4. Only after approval, run:

```bash
python3 /home/perazzojoao/.pi/agent/skills/git-master-workflows/scripts/dependency_check.py --path <worktreePath> --install --yes
```

5. If multiple ecosystems are detected, a command is ambiguous, or the install has unusual side effects, ask the user to choose/confirm the command before running anything.
6. Never use `sudo`.

## 8. Internal behavior to understand

The extension uses commands equivalent to:

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
