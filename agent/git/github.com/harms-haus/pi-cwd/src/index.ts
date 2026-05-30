/**
 * pi-cwd Extension
 *
 * Provides a `/cwd <path>` command that changes the effective working directory
 * for all tool execution (bash, read, write, edit, grep, find, ls) without
 * restarting the pi-agent process.
 *
 * Usage:
 * /cwd — show current working directory
 * /cwd /tmp — change to absolute path
 * /cwd .. — change to relative path
 * /cwd ~/Documents — change with tilde expansion
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { isAbsolute, resolve } from "node:path";
import { realpathSync, statSync } from "node:fs";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { bashSingleQuote, expandTilde } from "./helpers.js";
import { getDirectoryCompletions } from "./completions.js";
import {
  getEffectiveCwd,
  setEffectiveCwd,
  getOriginalCwd,
  getLocalBashOps,
  resetBashOps,
  FILE_TOOLS_REQUIRED_PATH,
  FILE_TOOLS_OPTIONAL_PATH,
  restoreCwdFromBranch,
  updateFooterStatus,
  CWD_CHANGE_TYPE,
  isExistingDirectory,
} from "./state.js";

// Regex to find the cwd line in the system prompt
const CWD_PROMPT_REGEX = /Current working directory: .+/;

type CwdChangeResult = { ok: true; cwd: string } | { ok: false; error: string };

type CwdChangePayload = {
  path?: unknown;
  ctx?: ExtensionContext;
  resolve?: (result: CwdChangeResult) => void;
};

function parseCwdInput(text: string): string | null {
  const match = text.trim().match(/^\/cwd(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

function resolveCwdTarget(rawInput: string): CwdChangeResult {
  const expanded = expandTilde(rawInput);
  const baseCwd = isExistingDirectory(getEffectiveCwd()) ? getEffectiveCwd() : getOriginalCwd();
  const newCwd = resolve(baseCwd, expanded);
  try {
    const stat = statSync(newCwd);
    if (!stat.isDirectory()) {
      return { ok: false, error: `Not a directory: ${newCwd}` };
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, error: `Directory does not exist: ${newCwd}` };
    }
    if (code === "EACCES") {
      return { ok: false, error: `Permission denied: ${newCwd}` };
    }
    return { ok: false, error: `Cannot access directory: ${newCwd}` };
  }
  return { ok: true, cwd: realpathSync(newCwd) };
}

function changeCwd(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  rawInput: string,
  notify: boolean,
): CwdChangeResult {
  resetInvalidEffectiveCwd(pi, ctx);
  const result = resolveCwdTarget(rawInput);
  if (!result.ok) {
    if (notify) ctx.ui.notify(result.error, "error");
    return result;
  }

  setEffectiveCwd(result.cwd);
  pi.appendEntry(CWD_CHANGE_TYPE, { cwd: getEffectiveCwd() });
  updateFooterStatus(ctx, getEffectiveCwd(), getOriginalCwd());
  if (notify) ctx.ui.notify(`Changed working directory to ${getEffectiveCwd()}`, "info");
  return { ok: true, cwd: getEffectiveCwd() };
}

function resetInvalidEffectiveCwd(pi: ExtensionAPI, ctx: ExtensionContext): boolean {
  const cwd = getEffectiveCwd();
  if (cwd === getOriginalCwd() || isExistingDirectory(cwd)) return false;

  setEffectiveCwd(getOriginalCwd());
  pi.appendEntry(CWD_CHANGE_TYPE, { cwd: getEffectiveCwd() });
  updateFooterStatus(ctx, getEffectiveCwd(), getOriginalCwd());
  return true;
}

function getValidEffectiveCwd(pi: ExtensionAPI, ctx: ExtensionContext): string {
  resetInvalidEffectiveCwd(pi, ctx);
  return getEffectiveCwd();
}

function handleCwdCommand(pi: ExtensionAPI, ctx: ExtensionContext, rawInput: string): void {
  if (!rawInput) {
    resetInvalidEffectiveCwd(pi, ctx);
    ctx.ui.notify(`Current working directory: ${getEffectiveCwd()}`, "info");
    return;
  }
  changeCwd(pi, ctx, rawInput, true);
}

// ============================================================================
// Extension Entry Point
// ============================================================================
export default function (pi: ExtensionAPI): void {
  // ── /cwd command ──────────────────────────────────────────────────
  pi.registerCommand("cwd", {
    description:
      "Change working directory for tool execution (/cwd <path> or /cwd to show current)",
    // eslint-disable-next-line @typescript-eslint/require-await
    handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      handleCwdCommand(pi, ctx, args.trim());
    },
    getArgumentCompletions: (argumentPrefix: string): AutocompleteItem[] | null => {
      const cwd = isExistingDirectory(getEffectiveCwd()) ? getEffectiveCwd() : getOriginalCwd();
      return getDirectoryCompletions(argumentPrefix, cwd);
    },
  });

  // ── Intercept /cwd messages that reach the input pipeline ───────
  pi.on("input", (event, ctx) => {
    const rawInput = parseCwdInput(event.text);
    if (rawInput === null) return undefined;
    handleCwdCommand(pi, ctx, rawInput);
    return { action: "handled" as const };
  });

  // ── Programmatic CWD changes from other extensions ───────────────
  pi.events.on("pi-cwd:change", (data: unknown) => {
    if (!data || typeof data !== "object") return;
    const payload = data as CwdChangePayload;
    const respond = payload.resolve;
    if (typeof respond !== "function") return;

    if (typeof payload.path !== "string" || !payload.path.trim()) {
      respond({ ok: false, error: "Missing path" });
      return;
    }
    if (!payload.ctx) {
      respond({ ok: false, error: "Missing command context" });
      return;
    }

    respond(changeCwd(pi, payload.ctx, payload.path.trim(), false));
  });

  // ── Tool call interception ────────────────────────────────────────
  pi.on("tool_call", (event, ctx) => {
    const cwd = getValidEffectiveCwd(pi, ctx);
    if (cwd === getOriginalCwd()) return undefined;

    if (event.toolName === "bash") {
      // Bash tool input — only `command` is relevant for cwd prefixing
      const input = event.input as { command: string };
      input.command = `cd ${bashSingleQuote(cwd)} && ${input.command}`;
    } else if (FILE_TOOLS_REQUIRED_PATH.has(event.toolName)) {
      const input = event.input as { path: string };
      if (!isAbsolute(input.path)) {
        input.path = resolve(cwd, input.path);
      }
    } else if (FILE_TOOLS_OPTIONAL_PATH.has(event.toolName)) {
      const input = event.input as { path?: string };
      if (input.path === undefined || input.path === "") {
        input.path = cwd;
      } else if (!isAbsolute(input.path)) {
        input.path = resolve(cwd, input.path);
      }
    }

    return undefined;
  });

  // ── System prompt modification ────────────────────────────────────
  pi.on("before_agent_start", (event, ctx) => {
    const cwd = getValidEffectiveCwd(pi, ctx);
    if (cwd === getOriginalCwd()) return undefined;
    const modified = event.systemPrompt.replace(
      CWD_PROMPT_REGEX,
      `Current working directory: ${cwd}`,
    );
    return { systemPrompt: modified };
  });

  // ── User ! bash command support ───────────────────────────────────
  pi.on("user_bash", (_event, ctx) => {
    const cwd = getValidEffectiveCwd(pi, ctx);
    if (cwd === getOriginalCwd()) return undefined;
    const escapedCwd = bashSingleQuote(cwd);
    const originalOps = getLocalBashOps();
    return {
      operations: {
        exec: (
          command: string,
          cwd: string,
          options: {
            onData: (data: Buffer) => void;
            signal?: AbortSignal;
            timeout?: number;
            env?: NodeJS.ProcessEnv;
          },
        ) => {
          return originalOps.exec(`cd ${escapedCwd} && ${command}`, cwd, options);
        },
      },
    };
  });

  // ── State restoration ─────────────────────────────────────────────
  pi.on("session_start", (_event, ctx) => {
    setEffectiveCwd(restoreCwdFromBranch(ctx, getOriginalCwd()));
    resetBashOps();
    updateFooterStatus(ctx, getEffectiveCwd(), getOriginalCwd());
  });

  pi.on("session_tree", (_event, ctx) => {
    setEffectiveCwd(restoreCwdFromBranch(ctx, getOriginalCwd()));
    updateFooterStatus(ctx, getEffectiveCwd(), getOriginalCwd());
  });
}
