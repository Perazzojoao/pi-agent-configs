import { CONTEXT_MODE_TOOL_NAMES } from "./context-mode";
import type { DispatcherConfig, DispatcherIntegrationEnabled, ResolvedDispatcherIntegrations } from "./types";

const DISPATCHER_BASE_TOOL = "dispatch_agent";
const DIRECT_CODEBASE_TOOLS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);
const DANGEROUS_CONTEXT_TOOLS = new Set(["ctx_purge", "ctx_upgrade"]);
const DANGEROUS_CONFIG_TOOLS = DANGEROUS_CONTEXT_TOOLS;

export function normalizeDispatcherIntegrationEnabled(value: unknown): DispatcherIntegrationEnabled | undefined {
	if (value === true || value === false) return value;
	const normalized = String(value ?? "").trim().toLowerCase();
	if (normalized === "true") return true;
	if (normalized === "false") return false;
	if (normalized === "auto" || normalized === "preserve_active") return normalized;
	return undefined;
}

export function isUnsafeDispatcherConfigTool(name: string): boolean {
	return DIRECT_CODEBASE_TOOLS.has(name) || DANGEROUS_CONFIG_TOOLS.has(name);
}

export function resolveDispatcherIntegrations(
	config: DispatcherConfig | undefined,
	availableTools: string[],
	activeTools: string[],
): ResolvedDispatcherIntegrations {
	const available = new Set(availableTools);
	const active = new Set(activeTools);
	const warnings: string[] = [];
	const configured = config?.integrations || {};
	const tools = [DISPATCHER_BASE_TOOL];
	const promptSections: string[] = [];
	const enabledIntegrations: string[] = [];

	for (const [name, integration] of Object.entries(configured)) {
		if (integration.invalidEnabledValue !== undefined) continue;
		if (integration.enabled === undefined) {
			warnings.push(`Ignoring dispatcher integration "${name}" because enabled is not set; prompt text alone cannot grant access.`);
			continue;
		}
		const enabled = normalizeDispatcherIntegrationEnabled(integration.enabled);
		if (enabled === undefined) {
			warnings.push(`Ignoring dispatcher integration "${name}" with invalid enabled value "${String(integration.enabled)}".`);
			continue;
		}
		if (enabled === false) continue;
		if (isUnsafeDispatcherConfigTool(name)) {
			warnings.push(`Ignoring unsafe dispatcher integration "${name}"; dispatcher config cannot grant direct or dangerous tools.`);
			continue;
		}
		const exists = available.has(name);
		if (!exists && enabled === true) {
			warnings.push(`Dispatcher integration "${name}" is enabled but no matching tool is registered.`);
			continue;
		}
		const shouldEnable = enabled === "preserve_active" ? active.has(name) : exists;
		if (!shouldEnable) continue;
		tools.push(name);
		enabledIntegrations.push(name);
		if (integration.prompt?.trim()) promptSections.push(integration.prompt.trim());
	}

	// Preserve the original dispatcher context-mode behavior without restoring
	// non-context hard-coded integrations or prompt defaults.
	for (const name of CONTEXT_MODE_TOOL_NAMES) {
		if (name in configured) continue;
		if (DANGEROUS_CONTEXT_TOOLS.has(name)) continue;
		if (available.has(name)) tools.push(name);
	}

	return {
		tools: Array.from(new Set(tools)),
		enabledIntegrations,
		promptSections,
		warnings,
	};
}
