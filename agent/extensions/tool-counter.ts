/**
 * Tool Counter — Rich two-line custom footer
 *
 * Line 1: model + context meter on left, tokens in/out + cost on right
 * Line 2: cwd (branch) on left, tool call tally on right
 *
 * Demonstrates: setFooter, footerData.getGitBranch(), onBranchChange(),
 * session branch traversal for token/cost accumulation.
 *
 * Usage: pi -e extensions/tool-counter.ts
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { basename } from "node:path";

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

export default function (pi: ExtensionAPI) {
	const counts: Record<string, number> = {};

	pi.on("tool_execution_end", async (event) => {
		counts[event.toolName] = (counts[event.toolName] || 0) + 1;
	});

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			let disposed = false;
			let effectiveCwd = ctx.cwd;
			let effectiveBranch: string | null = footerData.getGitBranch();
			let effectiveIsWorktree: boolean | null = null;
			let branchRefreshSeq = 0;
			let worktreeRefreshSeq = 0;

			const requestRender = () => {
				if (!disposed) tui.requestRender();
			};

			const refreshEffectiveBranch = async (cwd: string) => {
				if (disposed) return;
				const seq = ++branchRefreshSeq;
				let branch: string | null = null;

				try {
					const result = await pi.exec("git", ["-C", cwd, "branch", "--show-current"], { timeout: 2000 });
					if (result.code === 0) {
						branch = result.stdout.trim() || null;
					}
				} catch {
					branch = null;
				}

				if (disposed || seq !== branchRefreshSeq || effectiveCwd !== cwd) return;
				effectiveBranch = branch;
				requestRender();
			};

			const refreshEffectiveWorktree = async (cwd: string) => {
				if (disposed) return;
				const seq = ++worktreeRefreshSeq;
				let isWorktree: boolean | null = null;

				try {
					const result = await pi.exec("git", [
						"-C",
						cwd,
						"rev-parse",
						"--path-format=absolute",
						"--git-dir",
						"--git-common-dir",
					], { timeout: 2000 });
					if (result.code === 0) {
						const lines = result.stdout.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
						if (lines.length >= 2) {
							const [gitDir, gitCommonDir] = lines;
							isWorktree = gitDir !== gitCommonDir;
						}
					}
				} catch {
					isWorktree = null;
				}

				if (disposed || seq !== worktreeRefreshSeq || effectiveCwd !== cwd) return;
				effectiveIsWorktree = isWorktree;
				requestRender();
			};

			const unsubBranch = footerData.onBranchChange(() => {
				if (disposed) return;
				if (effectiveCwd === ctx.cwd) {
					branchRefreshSeq++;
					effectiveBranch = footerData.getGitBranch();
					void refreshEffectiveWorktree(effectiveCwd);
					requestRender();
					return;
				}

				void refreshEffectiveBranch(effectiveCwd);
				void refreshEffectiveWorktree(effectiveCwd);
				requestRender();
			});

			const unsubCwd = pi.events.on("pi-cwd:changed", (payload: unknown) => {
				if (disposed || !payload || typeof payload !== "object") return;
				const cwd = (payload as { cwd?: unknown }).cwd;
				if (typeof cwd !== "string") return;

				effectiveCwd = cwd;
				void refreshEffectiveBranch(cwd);
				void refreshEffectiveWorktree(cwd);
				requestRender();
			});

			pi.events.emit("pi-cwd:get", {
				resolve: (data: unknown) => {
					if (disposed || !data || typeof data !== "object") return;
					const cwd = (data as { cwd?: unknown }).cwd;
					if (typeof cwd !== "string") return;

					effectiveCwd = cwd;
					void refreshEffectiveBranch(cwd);
					void refreshEffectiveWorktree(cwd);
					requestRender();
				},
			});
			void refreshEffectiveBranch(effectiveCwd);
			void refreshEffectiveWorktree(effectiveCwd);

			return {
				dispose() {
					disposed = true;
					branchRefreshSeq++;
					worktreeRefreshSeq++;
					unsubBranch();
					unsubCwd();
				},
				invalidate() {},
				render(width: number): string[] {
					// --- Line 1: cwd + branch (left), tokens + cost (right) ---
					let tokIn = 0;
					let tokOut = 0;
					let cost = 0;
					for (const entry of ctx.sessionManager.getBranch()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const m = entry.message as AssistantMessage;
							tokIn += m.usage.input;
							tokOut += m.usage.output;
							cost += m.usage.cost.total;
						}
					}

					const fmt = (n: number) => n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
					const dir = basename(effectiveCwd);
					const branch = effectiveBranch;

					// --- Line 1: model + context meter (left), tokens + cost (right) ---
					const usage = ctx.getContextUsage();
					const rawPct = usage?.percent ?? 0;
					const pct = Number.isFinite(rawPct) ? Math.min(100, Math.max(0, rawPct)) : 0;
					const filled = Math.min(10, Math.max(0, Math.round(pct / 10)));
					const model = ctx.model?.id || "no-model";

					const l1Left =
						theme.fg("dim", ` ${model} `) +
						theme.fg("warning", "[") +
						theme.fg("success", "#".repeat(filled)) +
						theme.fg("dim", "-".repeat(10 - filled)) +
						theme.fg("warning", "]") +
						theme.fg("dim", " ") +
						theme.fg("accent", `${Math.round(pct)}%`);

					const l1Right =
						theme.fg("success", `${fmt(tokIn)}`) +
						theme.fg("dim", " in ") +
						theme.fg("accent", `${fmt(tokOut)}`) +
						theme.fg("dim", " out ") +
						theme.fg("warning", `$${cost.toFixed(4)}`) +
						theme.fg("dim", " ");

					const pad1 = " ".repeat(Math.max(1, width - visibleWidth(l1Left) - visibleWidth(l1Right)));
					const line1 = truncateToWidth(l1Left + pad1 + l1Right, width, "");

					// --- Line 2: cwd + branch (left), tool tally (right) ---
					const extensionStatuses = footerData.getExtensionStatuses();
					const isWorktree = effectiveIsWorktree ?? extensionStatuses.has("worktree");
					const l2Left =
						theme.fg("dim", ` ${dir}`) +
						(branch
							? theme.fg("dim", " ") + theme.fg("warning", "(") + theme.fg("success", branch) + theme.fg("warning", ")") + (isWorktree ? "🌳" : "")
							: "");

					const entries = Object.entries(counts);
					const l2Right = entries.length === 0
						? theme.fg("dim", "waiting for tools ")
						: entries.map(
							([name, count]) =>
								theme.fg("accent", name) + theme.fg("dim", " ") + theme.fg("success", `${count}`)
						).join(theme.fg("warning", " | ")) + theme.fg("dim", " ");

					const pad2 = " ".repeat(Math.max(1, width - visibleWidth(l2Left) - visibleWidth(l2Right)));
					const line2 = truncateToWidth(l2Left + pad2 + l2Right, width, "");

					const lines = [line1, line2];
					if (extensionStatuses.size > 0) {
						const worktreeStatus = extensionStatuses.get("worktree");
						const orderedStatuses = Array.from(extensionStatuses.entries())
							.filter(([key]) => key !== "worktree")
							.sort(([a], [b]) => a.localeCompare(b));
						if (worktreeStatus !== undefined) {
							orderedStatuses.splice(Math.min(2, orderedStatuses.length), 0, ["worktree", worktreeStatus]);
						}

						const statusText = orderedStatuses
							.map(([, text]) => theme.fg("accent", sanitizeStatusText(text)))
							.join(theme.fg("dim", " | "));
						lines.push("");
						lines.push(truncateToWidth(theme.fg("dim", " ") + statusText, width, ""));
					}

					return lines;
				},
			};
		});
	});
}
