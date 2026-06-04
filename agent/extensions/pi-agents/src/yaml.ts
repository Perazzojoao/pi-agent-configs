import { CONTEXT_MODE_TOOL_NAMES, normalizeContextMode } from "./context-mode";
import type { AgentConfig, AgentsYamlConfig, DispatcherConfig, DispatcherIntegrationConfig } from "./types";

export function cleanYamlValue(value: string): string {
	return value.trim().replace(/^["']|["']$/g, "");
}

export function parseYamlValue(value: string): string | string[] {
	const clean = cleanYamlValue(value);
	if (clean.startsWith("[") && clean.endsWith("]")) {
		return clean.slice(1, -1)
			.split(",")
			.map(item => cleanYamlValue(item.trim()))
			.filter(Boolean);
	}
	return clean;
}

export function normalizeTools(tools: string | string[] | undefined, fallback = "read,grep,find,ls"): string {
	if (Array.isArray(tools)) {
		const filtered = tools.map(tool => tool.trim()).filter(Boolean);
		return filtered.length > 0 ? filtered.join(",") : fallback;
	}
	return tools && tools.trim() ? tools : fallback;
}

type ListField = "tools" | "contextTools";

const DEFAULT_RUNTIME = { maxParallelAgents: 3, sessionsDir: ".pi/agent-sessions" };
const DEFAULT_AUTO_WORKTREE = {
	baseDir: "../worktrees",
	mergeResolutionDir: "merge-resolution",
};

function toPositiveInt(value: unknown): number | undefined {
	if (Array.isArray(value) || value === undefined || value === "") return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseIndentedBlock(lines: string[], startIndex: number, fieldIndent: number): { value: string; nextIndex: number } {
	const blockLines: string[] = [];
	let minIndent: number | undefined;
	let i = startIndex;
	for (; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) {
			blockLines.push("");
			continue;
		}
		const indent = line.match(/^\s*/)?.[0].length ?? 0;
		if (indent <= fieldIndent) break;
		if (minIndent === undefined || indent < minIndent) minIndent = indent;
		blockLines.push(line);
	}
	const strip = minIndent ?? fieldIndent + 2;
	return {
		value: blockLines.map(line => line.trim() ? line.slice(Math.min(strip, line.length)) : "").join("\n").replace(/\n+$/, ""),
		nextIndex: i,
	};
}

function parseDispatcherConfig(raw: string, warnings: string[]): DispatcherConfig | undefined {
	const lines = raw.split("\n");
	const integrations: Record<string, DispatcherIntegrationConfig> = {};
	let inDispatcher = false;
	let inIntegrations = false;
	let currentName: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i];
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;

		if (indent === 0) {
			inDispatcher = /^dispatcher:\s*(?:#.*)?$/.test(trimmed);
			inIntegrations = false;
			currentName = null;
			continue;
		}
		if (!inDispatcher) continue;
		if (indent === 2) {
			inIntegrations = /^integrations:\s*(?:#.*)?$/.test(trimmed);
			currentName = null;
			continue;
		}
		if (!inIntegrations) continue;
		if (indent === 4) {
			const match = trimmed.match(/^([^:#]+):\s*(?:#.*)?$/);
			if (!match) continue;
			currentName = cleanYamlValue(match[1]);
			if (!currentName) continue;
			integrations[currentName] ||= {};
			continue;
		}
		if (indent >= 6 && currentName) {
			const match = rawLine.match(/^\s+(enabled|prompt):\s*(.*?)\s*$/);
			if (!match) continue;
			const [, key, rawValue] = match;
			if (key === "enabled") {
				const value = cleanYamlValue(rawValue.replace(/#.*$/, ""));
				if (value === "true") integrations[currentName].enabled = true;
				else if (value === "false") integrations[currentName].enabled = false;
				else if (value === "auto" || value === "preserve_active") integrations[currentName].enabled = value;
				else {
					integrations[currentName].invalidEnabledValue = value;
					warnings.push(`Invalid dispatcher.integrations.${currentName}.enabled value "${value}" ignored; integration disabled.`);
				}
			} else if (key === "prompt") {
				const value = rawValue.trim();
				if (value === "|" || value === ">") {
					const block = parseIndentedBlock(lines, i + 1, indent);
					integrations[currentName].prompt = value === ">" ? block.value.replace(/\n+/g, " ") : block.value;
					i = block.nextIndex - 1;
				} else if (value) {
					integrations[currentName].prompt = cleanYamlValue(value.replace(/#.*$/, ""));
				}
			}
		}
	}

	return Object.keys(integrations).length > 0 ? { integrations } : undefined;
}

function parseAgentField(config: AgentConfig, key: string, value: string | string[]): ListField | null {
	if (key === "tools" && !value) {
		config.tools = [];
		return "tools";
	}
	if (key === "context_tools") {
		const tools = Array.isArray(value) ? value : value ? String(value).split(",").map(tool => cleanYamlValue(tool.trim())) : [];
		config.contextTools = tools.filter(tool => CONTEXT_MODE_TOOL_NAMES.includes(tool));
		return !value || (Array.isArray(value) && value.length === 0) ? "contextTools" : null;
	}
	if (key === "context_mode") {
		config.contextMode = normalizeContextMode(value);
		return null;
	}
	if (Array.isArray(value) ? value.length === 0 : !value) return null;
	if (key === "max_ctx") {
		const parsed = toPositiveInt(value);
		if (parsed) config.maxCtx = parsed;
	} else if (key === "instances") {
		const parsed = toPositiveInt(value);
		if (parsed) config.instances = parsed;
	} else if (key === "fallback_model") {
		if (!Array.isArray(value)) config.fallbackModel = value;
	} else if (key === "model" || key === "effort" || key === "tools") {
		(config as any)[key] = value;
	}
	return null;
}

export function parseAgentsYamlConfig(raw: string): AgentsYamlConfig {
	const config: AgentsYamlConfig = {
		runtime: { ...DEFAULT_RUNTIME },
		autoWorktree: { ...DEFAULT_AUTO_WORKTREE },
		agents: [],
		warnings: [],
	};
	config.dispatcher = parseDispatcherConfig(raw, config.warnings);
	const seen = new Set<string>();
	let section = "";
	let current: AgentConfig | null = null;
	let activeListField: ListField | null = null;

	const addAgent = (name: string): AgentConfig | null => {
		const cleanName = cleanYamlValue(name.replace(/:$/, ""));
		if (!cleanName) return null;
		if (seen.has(cleanName.toLowerCase())) {
			config.warnings.push(`Duplicate agent "${cleanName}" ignored.`);
			return null;
		}
		const agent = { name: cleanName } as AgentConfig;
		config.agents.push(agent);
		seen.add(cleanName.toLowerCase());
		return agent;
	};

	for (const rawLine of raw.split("\n")) {
		const line = rawLine.replace(/#.*$/, "");
		if (!line.trim()) continue;
		const top = line.match(/^([A-Za-z_][\w-]*):\s*$/);
		if (top) { section = top[1]; current = null; activeListField = null; continue; }

		const nestedItemMatch = line.match(/^(\s+)-\s*(.+?)\s*$/);
		if (section === "agents" && nestedItemMatch && nestedItemMatch[1].length > 2 && current && activeListField) {
			const value = cleanYamlValue(nestedItemMatch[2]);
			if (activeListField === "contextTools") {
				if (CONTEXT_MODE_TOOL_NAMES.includes(value)) current.contextTools?.push(value);
			} else {
				current.tools = Array.isArray(current.tools) ? current.tools : [];
				current.tools.push(value);
			}
			continue;
		}

		if (section === "agents") {
			const itemMatch = line.match(/^\s*-\s*([^:]+?)\s*:?\s*$/);
			const scalarItemMatch = line.match(/^\s*-\s*([^:]+?)\s*:\s*(.+?)\s*$/);
			if (itemMatch) { current = addAgent(itemMatch[1]); activeListField = null; continue; }
			if (scalarItemMatch) { current = addAgent(scalarItemMatch[1]); activeListField = null; if (current) current.model = cleanYamlValue(scalarItemMatch[2]); continue; }
			const fieldMatch = line.match(/^\s+(model|fallback_model|effort|tools|max_ctx|context_mode|context_tools|instances):\s*(.*?)\s*$/);
			if (fieldMatch && current) activeListField = parseAgentField(current, fieldMatch[1], parseYamlValue(fieldMatch[2]));
			continue;
		}

		const fieldMatch = line.match(/^\s+(max_parallel_agents|sessions_dir|fallback_model|base_dir|merge_resolution_dir):\s*(.*?)\s*$/);
		if (!fieldMatch) continue;
		const [, key, rawValue] = fieldMatch;
		const value = parseYamlValue(rawValue);
		if (section === "runtime") {
			if (key === "max_parallel_agents") config.runtime.maxParallelAgents = toPositiveInt(value) || config.runtime.maxParallelAgents;
			if (key === "sessions_dir" && !Array.isArray(value) && value) config.runtime.sessionsDir = String(value);
			if (key === "fallback_model" && !Array.isArray(value) && value) config.runtime.fallbackModel = String(value);
		} else if (section === "auto_worktree") {
			if (!Array.isArray(value) && value) {
				if (key === "base_dir") config.autoWorktree.baseDir = String(value);
				if (key === "merge_resolution_dir") config.autoWorktree.mergeResolutionDir = String(value);
			}
		}
	}

	return config;
}

export function parseAgentsYaml(raw: string): AgentConfig[] {
	return parseAgentsYamlConfig(raw).agents;
}
