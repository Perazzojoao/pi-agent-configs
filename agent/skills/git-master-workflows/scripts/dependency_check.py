#!/usr/bin/env python3
"""Heuristically detect dependency ecosystems, check installation, and optionally install."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def run(cmd: list[str], cwd: Path, execute: bool) -> dict[str, Any]:
    if not execute:
        return {"cmd": cmd, "skipped": True, "returncode": None, "stdout": "", "stderr": ""}
    try:
        proc = subprocess.run(cmd, cwd=str(cwd), text=True, capture_output=True, timeout=600)
        return {"cmd": cmd, "skipped": False, "returncode": proc.returncode, "stdout": proc.stdout.strip(), "stderr": proc.stderr.strip()}
    except Exception as exc:  # pragma: no cover
        return {"cmd": cmd, "skipped": False, "returncode": 1, "stdout": "", "stderr": str(exc)}


def exists(path: Path, name: str) -> bool:
    return (path / name).exists()


def local_or_active_venv(path: Path) -> bool:
    return bool(os.environ.get("VIRTUAL_ENV")) or exists(path, ".venv") or exists(path, "venv")


def node_plan(path: Path) -> dict[str, Any] | None:
    if not exists(path, "package.json"):
        return None
    managers = []
    if exists(path, "pnpm-lock.yaml"):
        managers.append(("pnpm", ["pnpm", "install", "--frozen-lockfile"], exists(path, "node_modules"), []))
    if exists(path, "yarn.lock"):
        managers.append(("yarn", ["yarn", "install", "--frozen-lockfile"], exists(path, "node_modules"), []))
    if exists(path, "bun.lockb") or exists(path, "bun.lock"):
        managers.append(("bun", ["bun", "install", "--frozen-lockfile"], exists(path, "node_modules"), []))
    if exists(path, "package-lock.json"):
        managers.append(("npm", ["npm", "ci"], exists(path, "node_modules"), []))
    elif not managers:
        managers.append(("npm", ["npm", "install"], exists(path, "node_modules"), ["no npm lockfile found; install may update dependency resolution"]))
    return make_plan("node", path, managers)


def python_plan(path: Path) -> dict[str, Any] | None:
    has_pyproject = exists(path, "pyproject.toml")
    has_requirements = exists(path, "requirements.txt")
    if not (has_pyproject or has_requirements):
        return None
    managers = []
    has_venv = local_or_active_venv(path)
    pip_warnings = [] if has_venv else ["no active/local virtualenv detected; pip may install globally or into user/site environment"]
    if exists(path, "uv.lock"):
        managers.append(("uv", ["uv", "sync", "--frozen"], exists(path, ".venv"), []))
    if has_pyproject:
        text = (path / "pyproject.toml").read_text(errors="ignore")
        if "[tool.poetry" in text or "poetry-core" in text:
            managers.append(("poetry", ["poetry", "install"], exists(path, ".venv"), []))
    if has_requirements:
        managers.append(("pip-requirements", [sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], has_venv, pip_warnings))
    elif has_pyproject:
        managers.append(("pip-editable", [sys.executable, "-m", "pip", "install", "-e", "."], has_venv, pip_warnings))
    return make_plan("python", path, managers)


def make_plan(ecosystem: str, path: Path, managers: list[tuple[str, list[str], bool, list[str]]]) -> dict[str, Any]:
    available = []
    for manager, command, installed, warnings in managers:
        exe = command[0]
        available.append({
            "manager": manager,
            "command": command,
            "cwd": str(path),
            "tool_available": bool(shutil.which(exe)) if exe != sys.executable else True,
            "appears_installed": installed,
            "warnings": warnings,
            "risk": "dependency installs may execute package lifecycle hooks or build scripts; review before running",
        })
    ambiguous = len(available) > 1
    selected = available[0] if available and not ambiguous else None
    return {"ecosystem": ecosystem, "path": str(path), "options": available, "ambiguous": ambiguous, "selected": selected}


def simple_plans(path: Path) -> list[dict[str, Any]]:
    specs = [
        ("ruby", "Gemfile", ["bundle", "install"], "vendor/bundle", []),
        ("go", "go.mod", ["go", "mod", "download"], "go.sum", []),
        ("rust", "Cargo.toml", ["cargo", "fetch"], "Cargo.lock", []),
        ("php", "composer.json", ["composer", "install"], "vendor", []),
    ]
    plans = []
    for ecosystem, marker, command, installed_marker, warnings in specs:
        if exists(path, marker):
            option = {
                "manager": command[0],
                "command": command,
                "cwd": str(path),
                "tool_available": bool(shutil.which(command[0])),
                "appears_installed": exists(path, installed_marker),
                "warnings": warnings,
                "risk": "dependency installs may execute package lifecycle hooks or build scripts; review before running",
            }
            if ecosystem == "php" and not exists(path, "composer.lock"):
                option["warnings"] = ["composer.lock not found; install may update dependency resolution"]
            plans.append({
                "ecosystem": ecosystem,
                "path": str(path),
                "options": [option],
                "ambiguous": False,
                "selected": option,
            })
    return plans


def discover(path: Path) -> list[dict[str, Any]]:
    plans: list[dict[str, Any]] = []
    for maybe in (node_plan(path), python_plan(path)):
        if maybe:
            plans.append(maybe)
    plans.extend(simple_plans(path))
    return plans


def main() -> int:
    parser = argparse.ArgumentParser(description="Heuristically check/install dependencies for common project ecosystems. No sudo is used.")
    parser.add_argument("--path", default=".", help="Project path (default: current directory)")
    parser.add_argument("--install", action="store_true", help="Execute the selected install/fetch commands when unambiguous")
    parser.add_argument("--yes", action="store_true", help="Required with --install to confirm external approval for running mutating install commands")
    args = parser.parse_args()

    path = Path(args.path).resolve()
    plans = discover(path)
    blockers: list[str] = []
    warnings: list[str] = ["dependency detection is heuristic; verify the plan against project documentation before installing"]
    results: list[dict[str, Any]] = []

    if len(plans) > 1:
        blockers.append("multiple dependency ecosystems detected; ask for confirmation before installing")
    if args.install and not args.yes:
        blockers.append("--install requires --yes after explicit user approval; no installation was run")

    for plan in plans:
        if plan["ambiguous"]:
            blockers.append(f"ambiguous dependency command for {plan['ecosystem']}; ask for confirmation")
            continue
        selected = plan.get("selected")
        if not selected:
            continue
        warnings.extend(selected.get("warnings", []))
        if not selected["tool_available"]:
            blockers.append(f"required tool not found for {plan['ecosystem']}: {selected['manager']}")
            continue
        if args.install and args.yes and not blockers and not selected["appears_installed"]:
            results.append({"ecosystem": plan["ecosystem"], "result": run(selected["command"], path, True)})

    missing = [
        {"ecosystem": p["ecosystem"], "command": p["selected"]["command"], "cwd": p["selected"]["cwd"], "risk": p["selected"]["risk"]}
        for p in plans
        if p.get("selected") and not p["selected"]["appears_installed"]
    ]

    data = {
        "ok": not blockers,
        "path": str(path),
        "install_requested": args.install,
        "yes": args.yes,
        "heuristic": True,
        "plans": plans,
        "missing_dependencies": missing,
        "warnings": sorted(set(warnings)),
        "blockers": blockers,
        "results": results,
    }
    print(json.dumps(data, indent=2))
    if blockers:
        return 2
    if args.install and any(r["result"].get("returncode") not in (0, None) for r in results):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
