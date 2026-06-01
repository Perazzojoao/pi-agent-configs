import type { AgentConfig } from "./types";

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

export function parseAgentsYaml(raw: string): AgentConfig[] {
	const agents: AgentConfig[] = [];
	const seen = new Set<string>();
	let inAgents = false;
	let current: AgentConfig | null = null;

	const addAgent = (name: string): AgentConfig | null => {
		const cleanName = cleanYamlValue(name.replace(/:$/, ""));
		if (!cleanName || seen.has(cleanName.toLowerCase())) return null;
		const config: AgentConfig = { name: cleanName };
		agents.push(config);
		seen.add(cleanName.toLowerCase());
		return config;
	};

	for (const rawLine of raw.split("\n")) {
		const line = rawLine.replace(/#.*$/, "");
		if (!line.trim()) continue;

		if (!inAgents) {
			if (line.trim() === "agents:") inAgents = true;
			continue;
		}

		const nestedItemMatch = line.match(/^(\s+)-\s*(.+?)\s*$/);
		if (nestedItemMatch && nestedItemMatch[1].length > 2 && current && Array.isArray(current.tools)) {
			current.tools.push(cleanYamlValue(nestedItemMatch[2]));
			continue;
		}

		const itemMatch = line.match(/^\s*-\s*([^:]+?)\s*:?\s*$/);
		if (itemMatch) {
			current = addAgent(itemMatch[1]);
			continue;
		}

		const scalarItemMatch = line.match(/^\s*-\s*([^:]+?)\s*:\s*(.+?)\s*$/);
		if (scalarItemMatch) {
			current = addAgent(scalarItemMatch[1]);
			if (current) current.model = cleanYamlValue(scalarItemMatch[2]);
			continue;
		}

		const fieldMatch = line.match(/^\s+(model|effort|tools|max_ctx):\s*(.*?)\s*$/);
		if (fieldMatch && current) {
			const key = fieldMatch[1];
			const value = parseYamlValue(fieldMatch[2]);
			if (key === "tools" && !value) {
				current.tools = [];
				continue;
			}
			if (Array.isArray(value) ? value.length === 0 : !value) continue;
			if (key === "max_ctx") {
				if (Array.isArray(value)) continue;
				const parsed = Number(value);
				if (!Number.isNaN(parsed)) current.maxCtx = parsed;
			} else {
				(current as any)[key] = value;
			}
		}
	}

	return agents;
}
