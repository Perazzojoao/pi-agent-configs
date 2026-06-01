import type { GitStatusSnapshot } from "./types";
import { getDeclaredRelativePaths, isDeclaredPath } from "./paths";

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
