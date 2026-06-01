import { existsSync, realpathSync } from "fs";
import { dirname, isAbsolute, relative, resolve } from "path";
import type { CleanupPlan, DispatchIsolationPlan, DispatchMode, DispatchResourceOptions, ValidationResult } from "./types";

export function shouldUseAutoWorktree(mode: DispatchMode, explicitWorktree: string | undefined, hasConcurrentWrite: boolean): boolean {
	return mode === "write" && !explicitWorktree?.trim() && hasConcurrentWrite;
}

export function sanitizeAgentKey(name: string): string | null {
	const raw = name.trim().toLowerCase();
	if (!raw || raw.includes("/") || raw.includes("\\") || raw.includes("..")) return null;
	const key = raw.replace(/\s+/g, "-");
	if (!key || key.startsWith("-") || key.includes("..") || !/^[a-z0-9][a-z0-9._-]*$/.test(key)) return null;
	return key;
}

function isInsideOrEqual(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!!rel && !rel.startsWith("../") && !rel.startsWith("..\\") && rel !== ".." && !isAbsolute(rel));
}

function nearestExistingPath(path: string): string | null {
	let current = path;
	while (current && current !== dirname(current)) {
		if (existsSync(current)) return current;
		current = dirname(current);
	}
	return existsSync(current) ? current : null;
}

export function validateRelativeCheckoutPath(checkout: string, path: string): ValidationResult {
	const clean = path.trim();
	if (!clean) return { ok: false, error: "empty path" };
	if (isAbsolute(clean)) return { ok: false, error: `absolute paths are not allowed: ${path}` };

	const root = resolve(checkout);
	const target = resolve(root, clean);
	if (!isInsideOrEqual(root, target)) return { ok: false, error: `path escapes checkout: ${path}` };

	if (!existsSync(root)) return { ok: true };
	let rootReal: string;
	try {
		rootReal = realpathSync(root);
	} catch {
		rootReal = root;
	}
	const existing = nearestExistingPath(target);
	if (!existing) return { ok: true };
	try {
		const existingReal = realpathSync(existing);
		if (!isInsideOrEqual(rootReal, existingReal)) return { ok: false, error: `path resolves outside checkout via symlink: ${path}` };
	} catch {
		return { ok: false, error: `could not resolve path safely: ${path}` };
	}
	return { ok: true };
}

export function validateDispatchPaths(runCwd: string, options: DispatchResourceOptions): ValidationResult {
	for (const file of options.files || []) {
		const validation = validateRelativeCheckoutPath(runCwd, file);
		if (!validation.ok) return validation;
	}
	return { ok: true };
}

export function validateSameGitCommonDir(baseCommonDir: string, candidateCommonDir: string): ValidationResult {
	try {
		const base = realpathSync(resolve(baseCommonDir));
		const candidate = realpathSync(resolve(candidateCommonDir));
		return base === candidate ? { ok: true } : { ok: false, error: `worktree belongs to a different Git repository: ${candidate}` };
	} catch (err: any) {
		return { ok: false, error: `could not canonicalize Git common dirs: ${err?.message || err}` };
	}
}

export function planAutoWorktreeCleanup(worktreeRemoveCode: number): CleanupPlan {
	return worktreeRemoveCode === 0
		? { deleteBranch: true }
		: { deleteBranch: false, reason: "worktree removal failed; preserving branch" };
}

export function shouldAbortFailedBaseMerge(mergeExitCode: number): boolean {
	return mergeExitCode !== 0;
}

export function planDispatchIsolation(baseCwd: string, mode: DispatchMode, options: DispatchResourceOptions, hasConcurrentWrite: boolean, autoWorktreePath?: string): DispatchIsolationPlan {
	const explicitWorktree = !!options.worktree?.trim();
	const autoWorktree = shouldUseAutoWorktree(mode, options.worktree, hasConcurrentWrite);
	return {
		runCwd: autoWorktree ? resolve(autoWorktreePath || baseCwd) : explicitWorktree ? resolve(baseCwd, options.worktree!.trim()) : resolve(baseCwd),
		autoWorktree,
		explicitWorktree,
	};
}

export function getDispatchResources(runCwd: string, mode: DispatchMode, options: DispatchResourceOptions, checkoutRoot = runCwd): string[] {
	const resources = new Set<string>();
	const checkout = resolve(runCwd);
	const lockCheckout = resolve(checkoutRoot);
	if (mode === "write") resources.add(`checkout:${lockCheckout}`);
	for (const file of options.files || []) {
		const clean = file.trim();
		if (clean) resources.add(`file:${resolve(checkout, clean)}`);
	}
	if (options.worktree?.trim()) resources.add(`worktree:${resolve(checkout)}`);
	return Array.from(resources).sort();
}

export function hasDeclaredWriteScope(options: DispatchResourceOptions): boolean {
	return !!options.worktree?.trim() || (options.files || []).some(file => !!file.trim());
}

export function getDeclaredRelativePaths(effectiveCwd: string, files: string[] | undefined): string[] {
	const declared: string[] = [];
	for (const file of files || []) {
		const clean = file.trim();
		if (!clean) continue;
		const rel = relative(resolve(effectiveCwd), resolve(effectiveCwd, clean));
		if (!rel || rel === ".." || rel.startsWith("../") || resolve(rel) === rel) continue;
		declared.push(rel);
	}
	return declared.map(path => path.replace(/\/+/g, "/").replace(/\/$/, ""));
}

export function isDeclaredPath(changedFile: string, declaredPaths: string[]): boolean {
	const normalized = changedFile.replace(/\/+/g, "/");
	return declaredPaths.some(declared => normalized === declared || normalized.startsWith(`${declared}/`));
}
