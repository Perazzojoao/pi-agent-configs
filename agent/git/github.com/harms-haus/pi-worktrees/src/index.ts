import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handleWtCreate } from "./commands/wt-create.js";
import { handleWtSwitch } from "./commands/wt-switch.js";
import { handleWtMerge } from "./commands/wt-merge.js";
import { handleWtCleanup } from "./commands/wt-cleanup.js";
import { getBranchCompletions } from "./completions.js";
import {
  setMainRepoPath,
  setDefaultBranch,
  resetState,
  updateFooterStatus,
  restoreWorktreeFromBranch,
} from "./state.js";
import { detectMainRepo, detectDefaultBranch, syncWorktreeStateFromCwd } from "./worktree.js";

type CwdGetResult = { cwd: string };
type CwdChangedPayload = { cwd?: unknown; source?: unknown; ctx?: unknown };

const CWD_GET_TIMEOUT_MS = 500;

async function getEffectiveCwdFromPiCwd(pi: ExtensionAPI): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    let settled = false;
    const settle = (cwd: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(cwd);
    };

    const timeout = setTimeout(() => {
      settle(null);
    }, CWD_GET_TIMEOUT_MS);
    pi.events.emit("pi-cwd:get", {
      resolve: (result: CwdGetResult) => {
        settle(result.cwd);
      },
    });
  });
}

async function restoreAndSyncFromEffectiveCwd(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  persist: boolean,
  shouldApply: () => boolean,
): Promise<void> {
  if (!shouldApply()) return;
  restoreWorktreeFromBranch(ctx);
  if (!shouldApply()) return;
  const cwd = await getEffectiveCwdFromPiCwd(pi);
  if (!shouldApply()) return;
  if (cwd) {
    await syncWorktreeStateFromCwd(pi, ctx, cwd, persist, shouldApply);
  } else {
    updateFooterStatus(ctx);
  }
}

export default function (pi: ExtensionAPI): void {
  let syncToken = 0;
  const nextSyncToken = (): number => ++syncToken;
  const isCurrentSync = (token: number): boolean => token === syncToken;

  // ── /wt-create ──────────────────────────────────────────────────────
  pi.registerCommand("wt-create", {
    description: "Create a new git worktree and switch to it",
    getArgumentCompletions: (prefix: string) => {
      return getBranchCompletions(prefix, pi);
    },
    handler: async (args, ctx) => {
      await handleWtCreate(args, ctx, pi);
    },
  });

  // ── /wt-switch ──────────────────────────────────────────────────────
  pi.registerCommand("wt-switch", {
    description: "Switch to a worktree by branch name, or 'main'",
    getArgumentCompletions: (prefix: string) => {
      return getBranchCompletions(prefix, pi);
    },
    handler: async (args, ctx) => {
      await handleWtSwitch(args, ctx, pi);
    },
  });

  // ── /wt-merge ──────────────────────────────────────────────────────
  pi.registerCommand("wt-merge", {
    description: "Merge a worktree's branch into main and remove the worktree",
    getArgumentCompletions: (prefix: string) => {
      return getBranchCompletions(prefix, pi);
    },
    handler: async (args, ctx) => {
      await handleWtMerge(args, ctx, pi);
    },
  });

  // ── /wt-cleanup ────────────────────────────────────────────────────
  pi.registerCommand("wt-cleanup", {
    description: "Remove a worktree and optionally delete its branch",
    getArgumentCompletions: (prefix: string) => {
      return getBranchCompletions(prefix, pi);
    },
    handler: async (args, ctx) => {
      await handleWtCleanup(args, ctx, pi);
    },
  });

  // ── State restoration ──────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const token = nextSyncToken();
    const mainRepo = await detectMainRepo(pi, ctx.cwd);
    const defaultBranch = mainRepo ? await detectDefaultBranch(pi, ctx.cwd) : null;
    if (isCurrentSync(token) && mainRepo && defaultBranch) {
      setMainRepoPath(mainRepo);
      setDefaultBranch(defaultBranch);
    }
    await restoreAndSyncFromEffectiveCwd(pi, ctx, false, () => isCurrentSync(token));
  });

  pi.on("session_tree", async (_event, ctx) => {
    const token = nextSyncToken();
    await restoreAndSyncFromEffectiveCwd(pi, ctx, false, () => isCurrentSync(token));
  });

  pi.events.on("pi-cwd:changed", (data: unknown) => {
    if (!data || typeof data !== "object") return;
    const payload = data as CwdChangedPayload;
    if (payload.source === "pi-worktrees") return;
    if (typeof payload.cwd !== "string" || !payload.cwd) return;
    if (!payload.ctx || typeof payload.ctx !== "object") return;
    const token = nextSyncToken();
    const persist = payload.source !== "restore";
    void syncWorktreeStateFromCwd(pi, payload.ctx as ExtensionContext, payload.cwd, persist, () =>
      isCurrentSync(token),
    );
  });

  pi.on("session_shutdown", () => {
    resetState();
  });
}
