#!/usr/bin/env python3
"""Read-only repository safety checks for git workflows."""

from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

SENSITIVE_PATTERNS = [
    ".env", ".env.*", "*.env", "*.pem", "*.key", "*.p12", "*.pfx", "*.crt", "*.cer",
    "id_rsa", "id_rsa*", "id_dsa", "id_dsa*", "id_ed25519", "id_ed25519*", "*.kubeconfig",
    "*/.aws/credentials", "*/.config/gcloud/*", "credentials.json", "*secret*", "*secrets*",
]


def run(cmd: list[str], cwd: Path) -> dict[str, Any]:
    try:
        proc = subprocess.run(cmd, cwd=str(cwd), text=True, capture_output=True, timeout=20)
        return {"cmd": cmd, "returncode": proc.returncode, "stdout": proc.stdout.strip(), "stderr": proc.stderr.strip()}
    except Exception as exc:  # pragma: no cover
        return {"cmd": cmd, "returncode": 1, "stdout": "", "stderr": str(exc)}


def run_bytes(cmd: list[str], cwd: Path) -> dict[str, Any]:
    try:
        proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, timeout=20)
        return {"cmd": cmd, "returncode": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr.decode(errors="replace").strip()}
    except Exception as exc:  # pragma: no cover
        return {"cmd": cmd, "returncode": 1, "stdout": b"", "stderr": str(exc)}


def git(args: list[str], cwd: Path) -> dict[str, Any]:
    return run(["git", *args], cwd)


def git_bytes(args: list[str], cwd: Path) -> dict[str, Any]:
    return run_bytes(["git", *args], cwd)


def out_lines(result: dict[str, Any]) -> list[str]:
    return [line for line in (result.get("stdout") or "").splitlines() if line]


def is_sensitive(path: str) -> bool:
    normalized = path.replace("\\", "/")
    base = normalized.rsplit("/", 1)[-1]
    for pattern in SENSITIVE_PATTERNS:
        if fnmatch.fnmatch(normalized, pattern) or fnmatch.fnmatch(base, pattern):
            return True
    return False


def decode_path(raw: bytes) -> str:
    return raw.decode(errors="surrogateescape")


def status_paths(root: Path, pathspec: str | None = None) -> list[dict[str, str]]:
    args = ["status", "--porcelain=v1", "-z", "--untracked-files=all"]
    if pathspec is not None:
        args.extend(["--", pathspec])
    result = git_bytes(args, root)
    entries = [entry for entry in (result.get("stdout") or b"").split(b"\0") if entry]
    paths: list[dict[str, str]] = []
    i = 0
    while i < len(entries):
        entry = entries[i]
        if len(entry) < 3:
            i += 1
            continue
        status = decode_path(entry[:2])
        path = decode_path(entry[3:])
        record = {"status": status, "path": path}
        if status[0] in ("R", "C") or status[1] in ("R", "C"):
            # In porcelain v1 -z, rename/copy is: XY newpath\0oldpath\0.
            if i + 1 < len(entries):
                record["old_path"] = decode_path(entries[i + 1])
                i += 1
        paths.append(record)
        i += 1
    return paths


def tracked_pi(root: Path) -> list[str]:
    return out_lines(git(["ls-files", "--", ".pi"], root))


def unignored_pi(root: Path) -> list[str]:
    pi = root / ".pi"
    if not pi.exists():
        return []
    return [entry["path"] for entry in status_paths(root, ".pi") if entry["status"] == "??"]


def ahead_behind(root: Path) -> dict[str, Any]:
    branch = git(["branch", "--show-current"], root)["stdout"]
    upstream_r = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], root)
    if upstream_r["returncode"] != 0:
        return {"branch": branch, "upstream": None, "ahead": None, "behind": None, "diverged": False}
    upstream = upstream_r["stdout"]
    counts_r = git(["rev-list", "--left-right", "--count", f"{upstream}...HEAD"], root)
    ahead = behind = None
    if counts_r["returncode"] == 0 and counts_r["stdout"]:
        left, right = counts_r["stdout"].split()[:2]
        behind, ahead = int(left), int(right)
    return {"branch": branch, "upstream": upstream, "ahead": ahead, "behind": behind, "diverged": bool(ahead and behind)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect blockers before staging, committing, pushing, or PR creation.")
    parser.add_argument("--path", default=".", help="Path inside the repository (default: current directory)")
    args = parser.parse_args()

    cwd = Path(args.path).resolve()
    root_r = git(["rev-parse", "--show-toplevel"], cwd)
    if root_r["returncode"] != 0:
        print(json.dumps({"ok": False, "blockers": ["not a git repository"], "details": root_r}, indent=2))
        return 2
    root = Path(root_r["stdout"]).resolve()

    statuses = status_paths(root)
    sensitive = [entry for entry in statuses if is_sensitive(entry["path"]) or is_sensitive(entry.get("old_path", ""))]
    sensitive_staged = [entry for entry in sensitive if entry["status"][0] not in (" ", "?")]
    tracked_pi_files = tracked_pi(root)
    unignored_pi_files = unignored_pi(root)
    sync = ahead_behind(root)

    blockers: list[str] = []
    warnings: list[str] = []
    if sensitive:
        blockers.append("sensitive files present in git status; do not print their diffs and require explicit confirmation before staging")
    if sensitive_staged:
        blockers.append("sensitive files are staged")
    if tracked_pi_files:
        blockers.append(".pi files are tracked")
    if unignored_pi_files:
        blockers.append(".pi files are untracked and not ignored")
    if sync.get("diverged"):
        blockers.append("branch has diverged from upstream")
    elif sync.get("behind"):
        warnings.append("branch is behind upstream")

    data = {
        "ok": not blockers,
        "root": str(root),
        "blockers": blockers,
        "warnings": warnings,
        "sensitive_paths": sensitive,
        "sensitive_staged": sensitive_staged,
        "branch_sync": sync,
        "tracked_pi_files": tracked_pi_files,
        "unignored_pi_files": unignored_pi_files,
    }
    print(json.dumps(data, indent=2))
    return 1 if blockers else 0


if __name__ == "__main__":
    sys.exit(main())
