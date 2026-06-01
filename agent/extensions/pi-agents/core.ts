import { existsSync, realpathSync } from "fs";
import { dirname, isAbsolute, relative, resolve } from "path";

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

export function parseGitStatusZ(raw: string): Map<string, string> {
	const paths = new Map<string, string>();
	const entries = raw.split("\0").filter(Boolean);
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.length < 4) continue;
		const status = entry.slice(0, 2);
		const path = entry.slice(3);
		paths.set(path, status);
		if (status[0] === "R" || status[1] === "R" || status[0] === "C" || status[1] === "C") {
			const oldPath = entries[++i];
			if (oldPath) paths.set(oldPath, status);
		}
	}
	return paths;
}

export function getChangedDuringRun(before: GitStatusSnapshot, after: GitStatusSnapshot): { files: string[]; error?: string } {
	if (before.error) return { files: [], error: before.error };
	if (after.error) return { files: [], error: after.error };
	const changed = new Set<string>();
	for (const [file, afterFingerprint] of after.files) {
		if (before.files.get(file) !== afterFingerprint) changed.add(file);
	}
	for (const file of before.files.keys()) {
		if (!after.files.has(file)) changed.add(file);
	}
	return { files: Array.from(changed).sort() };
}

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

export function getOutOfScopeRunChanges(effectiveCwd: string, declaredFiles: string[] | undefined, before: GitStatusSnapshot, after: GitStatusSnapshot): { outOfScope: string[]; changedDuringRun: string[]; error?: string } {
	const changed = getChangedDuringRun(before, after);
	if (changed.error) return { outOfScope: [], changedDuringRun: [], error: changed.error };
	if (!declaredFiles || declaredFiles.length === 0) return { outOfScope: [], changedDuringRun: changed.files };
	const declared = getDeclaredRelativePaths(effectiveCwd, declaredFiles);
	return {
		changedDuringRun: changed.files,
		outOfScope: changed.files.filter(file => !isDeclaredPath(file, declared)),
	};
}
