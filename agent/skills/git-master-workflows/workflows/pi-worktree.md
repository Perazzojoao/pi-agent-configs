# Pi Worktrees workflow

Use this workflow before starting, switching, merging, or cleaning up feature/bugfix work isolated from the main checkout.

Apply the central safety policy from `$SKILL_ROOT/SKILL.md`, especially approval requirements for destructive operations, pushes, dependency installation, and closing panes/sessions.

This workflow uses **only** the Pi extension at `agent/git/github.com/harms-haus/pi-worktrees` for worktree operations. Operational worktree actions must be performed exclusively with its slash commands: `/wt-create`, `/wt-switch`, `/wt-merge`, and `/wt-cleanup`.

Do **not** use direct git commands or custom scripts for worktree operations in this workflow. Do not use native worktree, branch-switching, branch-management, checkout, directory-changing, or cleanup commands as operational substitutes for the `/wt-*` commands.

## 1. Operational analysis of the Pi Worktrees extension

The extension provides four slash commands and relies on `pi-cwd` to switch the active CWD in Pi. It detects the repository and default branch automatically, persists worktree state in the Pi session branch, and updates the footer with a `🌳 <branch>` indicator when a non-default worktree is active.

### `/wt-create <branch-name>`

Creates a worktree for `<branch-name>` and switches Pi's CWD to that worktree.

Relevant behavior:

- Required parameter: `<branch-name>`.
- If the branch already exists, the extension creates a worktree for that existing branch.
- If the branch does not exist, the extension creates the branch and its worktree.
- The worktree path is derived from the extension configuration, normally under the configured `worktrees.baseDir`.
- The command switches CWD automatically through `pi-cwd`, updates extension state, persists a session entry, and updates the footer status.
- Branch names are validated. Invalid examples include empty names, names starting with `-`, `HEAD`, names containing whitespace or special invalid sequences, and names ending in `.lock`.
- Untracked files from the current CWD may be copied automatically into the new worktree on a best-effort basis. Ignored files are excluded; directories, symlinks, and already-existing destination files are skipped.

Important limitation:

- There is **no explicit base-ref parameter**. `/wt-create` uses the extension's detected/current repository context. If the task requires a specific base ref, stop and ask the user how to prepare the repository context before using this workflow; do not replace `/wt-create` with direct git commands.

### `/wt-switch <branch-name|default-branch>`

Switches Pi's CWD to an existing worktree branch, or back to the detected default branch.

Relevant behavior:

- Required parameter: branch name or the detected default branch name.
- When the target is the default branch, the extension switches back to the main repository path.
- When the target is another branch, a worktree for that branch must already exist.
- The command updates extension state, persists the CWD/worktree state, and updates the footer.

Important limitation:

- There is no `/wt-list` or `/wt-status`. Use the command result, footer indicator, session context, and known branch names from the task plan. If the target worktree is unknown, ask the user rather than using direct git worktree inspection commands.

### `/wt-merge [<branch-name>]`

Merges a worktree branch into the detected default branch, verifies the merge, and optionally removes the worktree.

Relevant behavior:

- Optional parameter: `<branch-name>`.
- If omitted while currently in a non-default worktree, the current worktree branch is used.
- It refuses to merge the default branch into itself.
- It asks for confirmation before merging.
- If tracked uncommitted changes exist in the worktree, it can prompt for an auto-commit method: let the agent summarize and commit, provide a commit message, or cancel. In non-interactive operation, it may auto-commit tracked changes with an AI-generated or fallback message.
- It detects untracked files in the worktree and may ask whether to copy them back to the main worktree after a successful merge.
- If the main worktree has tracked dirty changes, it may stash them before merging and restore the stash afterward.
- If conflicts occur, the extension halts the merge and preserves the worktree; if merge verification fails after a merge attempt, the extension preserves the worktree and rolls back the main branch to the pre-merge HEAD when applicable.
- After a verified merge, it asks whether to delete the worktree. If confirmed, the extension removes the worktree; otherwise it keeps it.
- On completion, it switches extension state/CWD back to the detected default branch.

Important limitations and effects:

- `/wt-merge` may auto-commit tracked changes in the feature worktree if the user chooses that option or if running non-interactively.
- `/wt-merge` may temporarily stash tracked dirty changes from the main worktree and later restore them.
- `/wt-merge` may copy untracked files back to main if the user confirms.
- `/wt-merge` may remove the worktree after successful merge if the user confirms cleanup.

### `/wt-cleanup [<branch-name>]`

Removes an existing worktree without merging.

Relevant behavior:

- Optional parameter: `<branch-name>`.
- If omitted while currently in a non-default worktree, the current worktree branch is used.
- It refuses to remove the default branch worktree.
- It refuses to remove a worktree that has uncommitted changes.
- It requires confirmation before cleanup.
- It attempts to remove the worktree and then delete the branch only when safe according to the extension's internal checks.
- If the removed worktree was current, it switches extension state/CWD back to the detected default branch.

Important limitation:

- Cleanup is destructive. Ask for explicit user approval before invoking it, even though the extension also prompts.

## 2. Prerequisites

Before running this workflow, confirm:

- The Pi Worktrees extension exists at `agent/git/github.com/harms-haus/pi-worktrees` and is available in the current Pi session.
- The `pi-cwd` extension is installed and active, because Pi Worktrees depends on it for CWD switching.
- The current Pi CWD is inside the intended repository.
- The task is a feature/bugfix or isolated experiment that should not be performed directly in the default checkout.
- The user understands that `/wt-create` does not accept an explicit base ref.
- Any required branch name has been chosen and reviewed for safety.
- Any unexpected uncommitted/untracked state has been discussed with the user, especially because untracked files can be copied automatically on create and optionally copied back on merge.

If these points are unclear, stop and ask the user before creating, switching, merging, or cleaning up worktrees.

## 3. Create an isolated worktree

1. Choose a branch name that describes the task, for example `feature/<short-topic>` or `fix/<short-topic>`.
2. Explain to the user that the extension will create or attach a worktree for that branch, switch CWD automatically, and may copy untracked files from the current CWD.
3. Create and switch with:

```text
/wt-create <branch-name>
```

4. Read the command result and footer state. Record the branch name and the worktree path reported by the extension.
5. Continue task work only after the command confirms success and Pi has switched to the worktree CWD.

If `/wt-create` reports that the directory already exists, the branch name is invalid, the session is not in a repository, or creation failed, do not improvise with direct git commands. Report the error and ask the user how to proceed.

## 4. Switch between the worktree and default branch

Use Pi Worktrees switching only:

```text
/wt-switch <branch-name>
```

To return to the default branch, use the detected default branch name:

```text
/wt-switch <default-branch>
```

Rules:

- Do not switch directories or branches using shell commands.
- Do not assume a worktree exists if `/wt-switch` reports that none was found.
- Because there is no `/wt-list` or `/wt-status`, preserve branch names in your task notes and use extension feedback/footer status as the source of operational state.
- If the default branch name is uncertain, ask the user or rely on the extension messages from prior commands; do not inspect or manipulate branches with direct git commands as part of this workflow.

## 5. Merge completed work

Before invoking merge, summarize what will happen and ask for user confirmation because `/wt-merge` can commit tracked changes, copy untracked files, stash main tracked changes, and remove the worktree if confirmed.

From the active worktree, merge the current worktree branch with:

```text
/wt-merge
```

Or explicitly merge a known worktree branch with:

```text
/wt-merge <branch-name>
```

During prompts:

- If tracked changes are detected, choose the commit method only after confirming the intended behavior with the user.
- If untracked files are offered for copy-back, confirm whether they should be copied to the main worktree.
- If the extension asks whether to delete the worktree after a successful merge, treat this as destructive cleanup and confirm with the user.
- If the merge reports conflicts, verification failure, stash restoration issues, or preserved worktree state, stop and report the exact extension message. Do not resolve by running direct git worktree/branch/checkout commands under this workflow.

After successful merge, the extension should restore CWD/state to the detected default branch. Verify by reading the command result/footer status rather than using direct git commands.

## 6. Cleanup abandoned or already-finished worktrees

Use cleanup only when the user explicitly wants to remove a worktree without merging, or when a previously merged worktree was kept and should now be removed.

Ask for explicit approval, then run one of:

```text
/wt-cleanup <branch-name>
```

or, if currently in the target worktree:

```text
/wt-cleanup
```

Rules:

- Do not cleanup the default branch.
- If the extension refuses cleanup due to uncommitted changes, stop and ask whether the user wants to merge, preserve, or manually review the worktree. Do not force removal with external commands.
- If branch deletion is refused because the branch is not fully merged, report that the extension kept the branch. Do not force-delete it from this workflow.
- If cleanup removes the current worktree, rely on the extension to switch state/CWD back to the default branch.

## 7. Restore state and CWD

Pi Worktrees persists state through session entries and restores it on session start/session tree events. Operationally:

- To intentionally return to the main/default checkout, run `/wt-switch <default-branch>`.
- To intentionally return to a feature worktree, run `/wt-switch <branch-name>`.
- After `/wt-merge` or `/wt-cleanup`, read the extension result and footer to confirm whether the CWD is on the default branch or the worktree was kept.
- If session restoration points to a missing worktree, the extension falls back to the main repository path/default branch.

Do not use direct shell directory changes or branch checkout commands to restore CWD/state in this workflow.

## 8. Handoff checklist for git-master agents

When reporting setup or transitions to the user, include:

- The slash command executed.
- The branch name.
- The worktree path if the extension reported one.
- Whether untracked files may have been copied on create or copy-back was chosen on merge.
- Whether `/wt-merge` auto-committed tracked changes, stashed/restored main changes, kept the worktree, or removed it.
- The final extension-reported CWD/state: default branch or named worktree.

Keep all worktree lifecycle operations inside the Pi Worktrees slash-command flow. For any unclear or unsupported situation, pause and ask the user instead of falling back to direct git worktree, branch, checkout, cleanup, or CWD commands.
