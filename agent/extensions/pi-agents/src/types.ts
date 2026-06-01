export interface AgentConfig {
	name: string;
	model?: string;
	effort?: string;
	tools?: string | string[];
	maxCtx?: number;
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
