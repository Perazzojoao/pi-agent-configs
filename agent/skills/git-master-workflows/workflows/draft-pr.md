# Draft PR workflow

Use this workflow whenever a Pull Request is created with `gh`.

Apply the central safety policy from `$SKILL_ROOT/SKILL.md`. In particular, PRs are Draft by default, final user approval after preview is required, and user approval is sufficient; no separate approval from another agent is required.

Generic `gh-cli` examples are syntax references only; they do not override this local policy. When using `gh` for PR creation, apply `--draft` by default even if a generic example omits it.

## 1. Require explicit user approval gates

Do not create the Pull Request until all required user approvals are explicit and verifiable:

1. Final user approval after preview: immediately before PR creation, show the user the complete planned PR content (title and full body) and ask for approval to create that PR. Record the user's exact approval.
2. Ready/non-draft override, only if applicable: record the user's exact request for a non-draft/ready-for-review PR. Without this recorded override, the final PR creation command must include `--draft`.

If any required user approval is missing or ambiguous, stop and request it. The PR must not be created until the user has seen the final title/body and explicitly approved creation.

## 2. Run preflight checks

Run:

```bash
python3 "$SKILL_ROOT/scripts/repo_preflight.py" --path "$(pwd)"
python3 "$SKILL_ROOT/scripts/safety_check.py" --path "$(pwd)"
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

## 4. Push only after explicit user approval

If the branch is not pushed, follow the central safety policy for pushes: ask for explicit user approval immediately before pushing, after showing the target remote/ref, commits, diff summary, and safety-check result.

After approval, push safely:

```bash
git push -u <remote> <branch>
```

Do not force-push without separate explicit user approval.

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

Write the body to a temporary Markdown file and use `--body-file`. Avoid interpolating multiline Markdown directly into a shell command. The body file must contain exactly the body shown to the user in the final preview, except for any edits the user requests and then approves in a new final preview.

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

## 6. Preview and request final creation approval

Immediately before creating any PR, show the user the complete planned PR content and ask for final approval to create that exact PR. This preview is mandatory for Draft and ready/non-draft PRs.

Display:

- Repo, base branch, and head branch.
- Draft status (`Draft` by default, or `Ready for review` only when an explicit ready/non-draft override was recorded).
- The exact PR title.
- The complete PR body exactly as it will be written to `--body-file`.

Ask for final creation approval in the same message/request that displays the title and body. If the user asks for edits, update the title/body, show the complete revised title/body again, and request final approval again. Do not create the PR until the user has seen the final title/body and explicitly approved creation.

## 7. Create the Draft PR

Before running the final command, perform this safety checklist:

- Confirm final user approval after title/body preview is recorded.
- Confirm the body file contains the same body that the user approved in the final preview.
- Confirm the intended command is the final `gh pr create --draft` command, unless the user explicitly requested ready/non-draft.
- Confirm the command uses explicit `--repo`, `--base`, `--head`, `--title`, and `--body-file` flags.
- Confirm the command contains `--draft` by default.
- If the command does not contain `--draft`, stop. Only continue without `--draft` when the user's explicit ready/non-draft override was recorded in step 1; otherwise correct the command by adding `--draft`.

After final user approval, create the PR in Draft mode with explicit repo/base/head and body file:

```bash
gh pr create --repo "$REPO" --base "$BASE" --head "$HEAD" --draft --title "<short title>" --body-file "$PR_BODY_FILE"
```

Use local help when useful:

```bash
gh -h
gh help pr create
```

## 8. Report results

After creation, report:

- PR URL.
- Draft status.
- Repo, base branch, and head branch.
- The recorded final user approval after title/body preview.
- Any follow-up needed from the user.
