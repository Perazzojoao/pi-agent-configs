#!/usr/bin/env python3
"""Read-only git repository preflight that prints JSON."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


def run(cmd: list[str], cwd: Path) -> dict[str, Any]:
    try:
        proc = subprocess.run(cmd, cwd=str(cwd), text=True, capture_output=True, timeout=20)
        return {
            "cmd": cmd,
            "returncode": proc.returncode,
            "stdout": proc.stdout.strip(),
            "stderr": proc.stderr.strip(),
        }
    except Exception as exc:  # pragma: no cover - defensive CLI handling
        return {"cmd": cmd, "returncode": 1, "stdout": "", "stderr": str(exc)}


def git(args: list[str], cwd: Path) -> dict[str, Any]:
    return run(["git", *args], cwd)


def lines(result: dict[str, Any]) -> list[str]:
    out = result.get("stdout") or ""
    return [line for line in out.splitlines() if line]


def configured_remotes(remotes: list[str]) -> list[str]:
    return sorted({line.split()[0] for line in remotes if line.strip()})


def local_default_branch(root: Path, remote: str) -> dict[str, str] | None:
    ref_r = git(["symbolic-ref", f"refs/remotes/{remote}/HEAD"], root)
    if ref_r["returncode"] != 0 or not ref_r["stdout"]:
        return None
    prefix = f"refs/remotes/{remote}/"
    branch = ref_r["stdout"]
    if branch.startswith(prefix):
        branch = branch[len(prefix):]
    return {"remote": remote, "branch": branch, "source": "local-symbolic-ref"}


def network_default_branch(root: Path, remote: str) -> dict[str, str] | None:
    show_r = git(["remote", "show", remote], root)
    for line in lines(show_r):
        marker = "HEAD branch:"
        if marker in line:
            return {"remote": remote, "branch": line.split(marker, 1)[1].strip(), "source": "git-remote-show"}
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect read-only git repository preflight data as JSON.")
    parser.add_argument("--path", default=".", help="Path inside the repository (default: current directory)")
    parser.add_argument(
        "--remote-network",
        action="store_true",
        help="Allow network-capable remote queries such as 'git remote show' when local default-branch data is unavailable.",
    )
    args = parser.parse_args()

    cwd = Path(args.path).resolve()
    root_r = git(["rev-parse", "--show-toplevel"], cwd)
    if root_r["returncode"] != 0:
        print(json.dumps({"ok": False, "error": "not a git repository", "details": root_r}, indent=2))
        return 1

    root = Path(root_r["stdout"]).resolve()
    branch_r = git(["branch", "--show-current"], root)
    remotes_r = git(["remote", "-v"], root)
    status_r = git(["status", "--short", "--branch"], root)
    branch_vv_r = git(["branch", "-vv"], root)
    worktree_r = git(["worktree", "list", "--porcelain"], root)
    log_r = git(["log", "--oneline", "--decorate", "--max-count=10"], root)

    remote_names = configured_remotes(lines(remotes_r))
    default_branch = None
    for remote in remote_names:
        default_branch = local_default_branch(root, remote)
        if default_branch:
            break
    if not default_branch and args.remote_network:
        for remote in remote_names:
            default_branch = network_default_branch(root, remote)
            if default_branch:
                break

    data = {
        "ok": True,
        "path": str(cwd),
        "root": str(root),
        "branch": branch_r["stdout"],
        "remotes": lines(remotes_r),
        "status": lines(status_r),
        "branch_vv": lines(branch_vv_r),
        "worktrees_porcelain": lines(worktree_r),
        "recent_log": lines(log_r),
        "default_branch": default_branch,
        "remote_network_allowed": args.remote_network,
    }
    print(json.dumps(data, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
