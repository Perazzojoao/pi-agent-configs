import type { ContextModeProfile } from "./context-mode";

export interface AgentConfig {
	name: string;
	model?: string;
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
}

export interface AutoWorktreeConfig {
	baseDir: string;
	mergeResolutionDir: string;
}

export interface AgentsYamlConfig {
	runtime: RuntimeConfig;
	autoWorktree: AutoWorktreeConfig;
	agents: AgentConfig[];
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
