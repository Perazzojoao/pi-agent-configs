# Logical commits workflow

Use this workflow when coordinating with Builder to commit completed implementation or bugfix steps.

Git master coordinates commits; Builder edits code. Git master does not edit source code directly.

Apply the central safety policy from `$SKILL_ROOT/SKILL.md`, especially secret handling, path-safe staging, commit-message guidance, and push approval gates.

## 1. Establish the logical plan

Before committing, coordinate with Builder or the user to identify complete logical steps, for example:

- One commit for scaffolding or setup.
- One commit for a complete feature slice.
- One commit for tests.
- One commit for documentation or configuration.

Do not create partial commits that leave the repository knowingly broken unless the user explicitly asks for checkpoint commits.

## 2. Run safety preflight

Run:

```bash
python3 "$SKILL_ROOT/scripts/repo_preflight.py" --path "$(pwd)"
python3 "$SKILL_ROOT/scripts/safety_check.py" --path "$(pwd)"
```

Resolve or explicitly acknowledge blockers before staging. Do not print diffs for sensitive-looking paths.

## 3. Inspect changes after Builder work

Use git inspection commands such as:

```bash
git status --short
git diff --stat
git diff --name-only
```

Use full `git diff -- <path>` only for non-sensitive files. If changes are mixed across multiple logical steps, separate them with selective staging.

## 4. Stage selectively

Use path-safe staging commands:

```bash
git add -- <paths>
git add -p -- <path>
```

Avoid staging unrelated files. If generated files, lockfiles, formatting-only changes, environment files, key material, credentials, or secret-looking files appear, verify whether they belong to the current logical commit.

Sensitive-looking files require explicit user confirmation before staging, and their diffs must not be printed.

## 5. Verify staged content

Before each commit, inspect exactly what is staged:

```bash
git diff --cached --stat
git diff --cached --name-only
git status --short
```

Use `git diff --cached -- <path>` only for non-sensitive files. Confirm the staged diff represents one complete logical step.

## 6. Commit with short English messages

Create the commit only after verifying staged content:

```bash
git commit -m "Add git master workflow skill"
```

Good examples:

```text
Add git master workflow skill
Fix worktree source handling
Update PR body template
feat: add draft PR workflow
fix: handle missing Herdr pane id
```

Repeat inspection, selective staging, verification, and commit for each complete logical step.

## 7. Push policy

Follow the central safety policy for pushes. In short: no `git push` without explicit user approval immediately before pushing, after showing the target remote/ref, commits, diff summary, and safety-check result. Never force-push without separate explicit user approval.

## 8. Report results

After each commit, report:

- Commit hash and message.
- What logical step it covers.
- Any remaining unstaged or uncommitted changes.
- Whether push approval is still needed.
