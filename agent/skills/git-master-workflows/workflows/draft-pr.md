# Draft PR workflow

Use this workflow whenever a Pull Request is created with `gh`. Every PR created by this agent must be Draft by default. Create a ready/non-draft PR only if the user explicitly asks for a non-draft/ready-for-review PR, and record that override before running the command.

Generic `gh-cli` examples are syntax references only; they do not override this local policy. When using `gh` for PR creation, apply `--draft` by default even if a generic example omits it.

## 1. Require explicit approval gates

Do not create the Pull Request until both approvals are explicit and verifiable:

1. Reviewer approval: record who/what approved and the exact approval signal (for example, a Reviewer message saying `approved for draft PR`).
2. User approval: record the user's exact approval to create the Draft PR.
3. Ready/non-draft override, only if applicable: record the user's exact request for a non-draft/ready-for-review PR. Without this recorded override, the final PR creation command must include `--draft`.

If either approval is missing or ambiguous, stop and request it.

## 2. Run preflight checks

Run:

```bash
python3 /home/perazzojoao/.pi/agent/skills/git-master-workflows/scripts/repo_preflight.py --path "$(pwd)"
python3 /home/perazzojoao/.pi/agent/skills/git-master-workflows/scripts/safety_check.py --path "$(pwd)"
gh auth status
```

Confirm:

- The current branch is the intended PR head branch.
- The branch has all intended commits.
- The working tree is clean, unless the user explicitly wants otherwise.
- The correct remote exists.
- `gh` is installed and authenticated.
- There are no unresolved safety blockers.

## 3. Resolve repo, base, and head

Resolve and display these values before any push or PR creation:

```bash
REPO="<owner/name from gh repo view --json nameWithOwner or explicit remote>"
BASE="<intended base branch>"
HEAD="<owner-or-user>:<branch or branch>"
```

Use explicit `gh pr create --draft` flags: `--repo`, `--base`, `--head`, and `--draft` by default. Do not rely on implicit repo/base/head selection. Do not omit `--draft` unless an explicit ready/non-draft override was recorded.

## 4. Push only after explicit approval

If the branch is not pushed, ask for explicit push approval first. Before asking, display:

- Remote and branch/refspec.
- Commits to be pushed, for example `git log --oneline <upstream-or-base>..HEAD`.
- Diff summary, for example `git diff --stat <upstream-or-base>...HEAD`.
- Safety-check JSON or summary.

After approval, push safely:

```bash
git push -u <remote> <branch>
```

Do not force-push without separate explicit approval.

## 5. Prepare the PR title and body

Use a concise PR title summarizing the change.

The PR body must be in English by default unless the user requests another language or the repository template requires another language.

Use this Markdown format by default:

```markdown
# Title

Description (Optional)

## Changes
1. Change 1 (short title)
  - Description of the modification
2. Change 2
  - Description of the modification
```

Fill the template with the actual title, optional description, and summarized changes. Preserve the structure.

Write the body to a temporary Markdown file and use `--body-file`. Avoid interpolating multiline Markdown directly into a shell command.

Example:

```bash
PR_BODY_FILE="$(mktemp -t draft-pr-body.XXXXXX.md)"
cat > "$PR_BODY_FILE" <<'EOF'
# <title>

<description>

## Changes
1. <change>
  - <details>
EOF
```

## 6. Create the Draft PR

Before running the final command, perform this safety checklist:

- Confirm Reviewer approval and user approval are recorded.
- Confirm the intended command is the final `gh pr create --draft` command.
- Confirm the command contains `--draft`.
- If the command does not contain `--draft`, stop. Only continue without `--draft` when the user's explicit ready/non-draft override was recorded in step 1; otherwise correct the command by adding `--draft`.

After Reviewer and user approval, create the PR in Draft mode with explicit repo/base/head and body file:

```bash
gh pr create --repo "$REPO" --base "$BASE" --head "$HEAD" --draft --title "<short title>" --body-file "$PR_BODY_FILE"
```

Use local help when useful:

```bash
gh -h
gh help pr create
```

## 7. Report results

After creation, report:

- PR URL.
- Draft status.
- Repo, base branch, and head branch.
- The recorded Reviewer approval and user approval.
- Any follow-up needed from Reviewer or user.
