import { CONTEXT_MODE_TOOL_NAMES } from "./context-mode";
import type { DispatcherConfig, DispatcherIntegrationConfig, DispatcherIntegrationEnabled, ResolvedDispatcherIntegrations } from "./types";

const DISPATCHER_BASE_TOOL = "dispatch_agent";
const DIRECT_CODEBASE_TOOLS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);
const DANGEROUS_CONTEXT_TOOLS = new Set(["ctx_purge", "ctx_upgrade"]);
const DANGEROUS_CONFIG_TOOLS = DANGEROUS_CONTEXT_TOOLS;

const DEFAULT_PROMPTS: Record<string, string> = {
	tilldone: `## TillDone (Planner-driven planning tracking only)
- tilldone is available only for Planner-driven planning tracking.
- The dispatcher must only use tilldone to create/update/track task lists that represent a plan produced or requested by the Planner.
- Do not use tilldone for generic task management, implementation, review, documentation, debugging, or user-requested tracking unless it is tied to a Planner plan.
- When the Planner asks the dispatcher to create/update tilldone for its plan, the dispatcher should do so before continuing delegation.
- Implementation still goes through dispatch_agent.`,
	sudo_exec: `## Privileged Commands (sudo_exec)
- The sudo_exec tool is enabled for commands that require elevated privileges.
- This is the only exception to the no-direct-execution rule: use sudo_exec for privileged operations, passing the command without the sudo prefix.
- Do not use sudo_exec for normal codebase exploration or implementation work; delegate that work via dispatch_agent.`,
	ask_user_question: `## Planner Clarification Flow (ask_user_question)
- When the Planner agent is available and used, it should formulate implementation questions for the user when answers would help produce a more precise and complete plan.
- Planner has autonomy to decide when to propose questions, unless the user's request explicitly says otherwise.
- Planner must NOT try to ask the user directly; it must return the proposed questions to you, the dispatcher.
- Review, filter, consolidate, and rephrase Planner's proposed questions before asking the user.
- Ask only concise, relevant, and safe questions with ask_user_question. Never ask for secrets, credentials, or unrelated sensitive information.
- After receiving answers, pass the relevant answers back to Planner so it can complete or refine the plan.
- ask_user_question does not provide codebase access; continue to delegate all code exploration and implementation work via dispatch_agent.`,
	cwd: `## Current Directory (cwd)
- The cwd tool is a limited exception only for checking or changing the current working directory according to the tool semantics.
- cwd does not allow reading, writing, searching, or executing directly in the codebase; continue to delegate code exploration and implementation work via dispatch_agent.`,
};

const DEFAULT_INTEGRATIONS: Record<string, DispatcherIntegrationConfig> = {
	tilldone: { enabled: "preserve_active", prompt: DEFAULT_PROMPTS.tilldone },
	sudo_exec: { enabled: "preserve_active", prompt: DEFAULT_PROMPTS.sudo_exec },
	ask_user_question: { enabled: "auto", prompt: DEFAULT_PROMPTS.ask_user_question },
	cwd: { enabled: "auto", prompt: DEFAULT_PROMPTS.cwd },
};

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
	const merged: Record<string, DispatcherIntegrationConfig> = { ...DEFAULT_INTEGRATIONS };

	for (const [name, integration] of Object.entries(configured)) {
		merged[name] = { ...merged[name], ...integration };
	}

	const tools = [DISPATCHER_BASE_TOOL];
	const promptSections: string[] = [];
	const enabledIntegrations: string[] = [];

	for (const [name, integration] of Object.entries(merged)) {
		const hasDefault = Object.prototype.hasOwnProperty.call(DEFAULT_INTEGRATIONS, name);
		if (integration.invalidEnabledValue !== undefined) continue;
		if (!hasDefault && integration.enabled === undefined) {
			warnings.push(`Ignoring dispatcher integration "${name}" because enabled is not set; prompt text alone cannot grant access.`);
			continue;
		}
		const enabled = normalizeDispatcherIntegrationEnabled(integration.enabled ?? DEFAULT_INTEGRATIONS[name]?.enabled);
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

	// Preserve existing hardcoded context-mode behavior unless dispatcher config explicitly controls a context tool.
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
