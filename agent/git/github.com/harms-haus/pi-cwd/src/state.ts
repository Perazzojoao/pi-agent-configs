import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import { statSync } from "node:fs";

// ============================================================================
// Module State
// ============================================================================
/** Original working directory at extension load — never changes. */
const originalCwd: string = process.cwd();

/** Effective working directory — changes via /cwd command. */
let effectiveCwd: string = originalCwd;

/** Cached local bash operations for user_bash handler. */
let localBashOps = createLocalBashOperations();

/** File tools that require a path argument. */
export const FILE_TOOLS_REQUIRED_PATH = new Set(["read", "write", "edit"]);

/** File tools that can optionally use a path argument. */
export const FILE_TOOLS_OPTIONAL_PATH = new Set(["grep", "find", "ls"]);

/** Custom entry type for cwd-change entries in the session branch. */
export const CWD_CHANGE_TYPE = "cwd-change" as const;

/** Footer status key for the cwd indicator. */
export const STATUS_KEY = "cwd" as const;

// ============================================================================
// State Access Functions
// ============================================================================
export function getOriginalCwd(): string {
  return originalCwd;
}

export function getEffectiveCwd(): string {
  return effectiveCwd;
}

export function setEffectiveCwd(cwd: string): void {
  effectiveCwd = cwd;
}

export function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function getLocalBashOps() {
  return localBashOps;
}

export function resetBashOps(): void {
  localBashOps = createLocalBashOperations();
}

// ============================================================================
// State-Related Functions
// ============================================================================
/** Update the footer status indicator to the current effective cwd. */
export function updateFooterStatus(ctx: ExtensionContext, cwd: string, _original: string): void {
  if (!ctx.hasUI) return;
  const home = process.env.HOME || "";
  const displayPath =
    home && (cwd === home || cwd.startsWith(`${home}/`))
      ? `~${cwd.slice(home.length)}`
      : cwd;
  ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `📂 ${displayPath}`));
}

/**
 * Scan the current session branch for "cwd-change" entries.
 * Returns the last recorded cwd, or the original if none found.
 */
export function restoreCwdFromBranch(ctx: ExtensionContext, original: string): string {
  try {
    const branch = ctx.sessionManager.getBranch();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (!entry) continue;
      if (
        entry.type === "custom" &&
        entry.customType === "cwd-change" &&
        entry.data &&
        typeof (entry.data as Record<string, unknown>).cwd === "string"
      ) {
        const cwd = (entry.data as { cwd: string }).cwd;
        // Validate that the cwd exists and is a directory
        if (isExistingDirectory(cwd)) return cwd; // short-circuit on first valid from end
      }
    }
    return original;
  } catch {
    return original;
  }
}
