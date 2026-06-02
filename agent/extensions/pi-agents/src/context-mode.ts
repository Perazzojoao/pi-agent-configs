import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

export type ContextModeProfile = "off" | "safe" | "exec" | "all" | "custom";

export const CONTEXT_MODE_TOOL_NAMES = [
	"ctx_execute",
	"ctx_execute_file",
	"ctx_index",
	"ctx_search",
	"ctx_fetch_and_index",
	"ctx_batch_execute",
	"ctx_stats",
	"ctx_doctor",
	"ctx_upgrade",
	"ctx_purge",
	"ctx_insight",
];

export const CONTEXT_MODE_PROFILE_TOOLS: Record<Exclude<ContextModeProfile, "off" | "custom">, string[]> = {
	safe: ["ctx_execute_file", "ctx_index", "ctx_search", "ctx_fetch_and_index", "ctx_stats"],
	exec: ["ctx_execute", "ctx_execute_file", "ctx_batch_execute", "ctx_stats"],
	all: CONTEXT_MODE_TOOL_NAMES,
};

export function normalizeContextMode(value: unknown): ContextModeProfile {
	if (value === true) return "safe";
	if (value === false || value == null || value === "") return "off";
	const normalized = String(value).trim().toLowerCase();
	if (normalized === "true") return "safe";
	if (normalized === "false") return "off";
	if (["off", "safe", "exec", "all", "custom"].includes(normalized)) return normalized as ContextModeProfile;
	return "off";
}

export function getContextTools(profileValue: unknown, customTools: string[] | undefined): string[] {
	const profile = normalizeContextMode(profileValue);
	if (profile === "off") return [];
	if (profile === "custom") return (customTools || []).filter(tool => CONTEXT_MODE_TOOL_NAMES.includes(tool));
	return CONTEXT_MODE_PROFILE_TOOLS[profile];
}

export function mergeToolLists(baseTools: string, extraTools: string[]): string {
	const merged = new Set(baseTools.split(",").map(tool => tool.trim()).filter(Boolean));
	for (const tool of extraTools) merged.add(tool);
	return Array.from(merged).join(",");
}

export function findContextModeExtension(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const override = env.PI_AGENTS_CONTEXT_MODE_EXTENSION;
	if (override && existsSync(resolvePath(override, cwd))) return resolvePath(override, cwd);

	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(cwd, "agent", "npm", "node_modules", "context-mode", "build", "adapters", "pi", "extension.js"),
		join(cwd, "agent", "npm", "node_modules", "context-mode", "build", "pi-extension.js"),
		join(cwd, "node_modules", "context-mode", "build", "adapters", "pi", "extension.js"),
		join(cwd, "node_modules", "context-mode", "build", "pi-extension.js"),
		join(homedir(), ".pi", "agent", "npm", "node_modules", "context-mode", "build", "adapters", "pi", "extension.js"),
		join(homedir(), ".pi", "agent", "npm", "node_modules", "context-mode", "build", "pi-extension.js"),
		join(homedir(), ".pi", "agent", "npm", "node_modules", "context-mode", "build", "extension.js"),
		resolve(here, "..", "..", "..", "npm", "node_modules", "context-mode", "build", "adapters", "pi", "extension.js"),
		resolve(here, "..", "..", "..", "npm", "node_modules", "context-mode", "build", "pi-extension.js"),
	];
	return candidates.find(path => existsSync(path)) || null;
}

function resolvePath(path: string, cwd: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : resolve(cwd, path);
}
