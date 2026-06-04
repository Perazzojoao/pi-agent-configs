import type { ContextModeProfile } from "./context-mode";

export interface AgentConfig {
	name: string;
	model?: string;
	fallbackModel?: string;
	effort?: string;
	tools?: string | string[];
	maxCtx?: number;
	contextMode?: ContextModeProfile;
	contextTools?: string[];
	instances?: number;
}

export interface RuntimeConfig {
	maxParallelAgents: number;
	sessionsDir: string;
	fallbackModel?: string;
}

export interface AutoWorktreeConfig {
	baseDir: string;
	mergeResolutionDir: string;
}

export type DispatcherIntegrationEnabled = boolean | "auto" | "preserve_active";

export interface DispatcherIntegrationConfig {
	enabled?: DispatcherIntegrationEnabled;
	prompt?: string;
	invalidEnabledValue?: string;
}

export interface DispatcherConfig {
	integrations?: Record<string, DispatcherIntegrationConfig>;
}

export interface AgentsYamlConfig {
	runtime: RuntimeConfig;
	autoWorktree: AutoWorktreeConfig;
	dispatcher?: DispatcherConfig;
	agents: AgentConfig[];
	warnings: string[];
}

export interface ResolvedDispatcherIntegrations {
	tools: string[];
	enabledIntegrations: string[];
	promptSections: string[];
	warnings: string[];
}

export interface GitStatusSnapshot {
	files: Map<string, string>;
	error?: string;
}

export type DispatchMode = "read" | "write";

export interface DispatchResourceOptions {
	files?: string[];
	worktree?: string;
}

export interface DispatchIsolationPlan {
	runCwd: string;
	autoWorktree: boolean;
	explicitWorktree: boolean;
}

export interface ValidationResult {
	ok: boolean;
	error?: string;
}

export interface CleanupPlan {
	deleteBranch: boolean;
	reason?: string;
}
