import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { getWorktreeList, findWorktreeByBranch } from "../git.js";
import { switchCwd, ensureMainRepo } from "../worktree.js";
import {
  getMainRepoPath,
  getCurrentBranch,
  setCurrentBranch,
  updateFooterStatus,
  getDefaultBranch,
} from "../state.js";

export async function handleWtSwitch(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  // 1. Validate args
  const target = args.trim();
  if (!target) {
    ctx.ui.notify("Usage: /wt-switch <branch-name>|main", "error");
    return;
  }

  // 2. Ensure main repo path is known
  if (!(await ensureMainRepo(pi, ctx))) return;

  // 3. Handle main/default branch target (accept "main", "default", and detected default)
  const defaultBranch = getDefaultBranch();
  if (target === "main" || target === "default" || target === defaultBranch) {
    const previousBranch = getCurrentBranch();
    setCurrentBranch(defaultBranch);
    try {
      await switchCwd(pi, ctx, getMainRepoPath());
    } catch (err: unknown) {
      setCurrentBranch(previousBranch);
      ctx.ui.notify("Failed to switch CWD: " + (err as Error).message, "error");
      return;
    }
    updateFooterStatus(ctx);
    ctx.ui.notify("Switched to " + defaultBranch + " worktree", "info");
    return;
  }

  // 4. Find worktree for branch
  const worktrees = await getWorktreeList(pi, getMainRepoPath());
  const wt = findWorktreeByBranch(worktrees, target);
  if (!wt) {
    ctx.ui.notify(
      "No worktree found for branch '" + target + "'. Use /wt-create " + target + " first.",
      "error",
    );
    return;
  }

  // 5. Switch
  const previousBranch = getCurrentBranch();
  setCurrentBranch(target);
  try {
    await switchCwd(pi, ctx, wt.path);
  } catch (err: unknown) {
    setCurrentBranch(previousBranch);
    ctx.ui.notify("Failed to switch CWD: " + (err as Error).message, "error");
    return;
  }
  updateFooterStatus(ctx);
  ctx.ui.notify("Switched to worktree '" + target + "' at " + wt.path, "info");
}
