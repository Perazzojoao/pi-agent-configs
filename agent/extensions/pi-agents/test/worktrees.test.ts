import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	getAutoMergeResolutionWorktreePath,
	getAutoWorktreePath,
	planAutoWorktreeCleanup,
	planDispatchIsolation,
	shouldAbortFailedBaseMerge,
	shouldUseAutoWorktree,
	validateSameGitCommonDir,
} from "../src/paths";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("validates same git common dir and cleanup/abort decisions", () => {
	const temp = mkdtempSync(resolve(__dirname, "tmp-common-"));
	try {
		const repo = join(temp, "repo.git");
		const other = join(temp, "other.git");
		mkdirSync(repo);
		mkdirSync(other);
		assert.equal(validateSameGitCommonDir(repo, repo).ok, true);
		assert.equal(validateSameGitCommonDir(repo, other).ok, false);
		assert.deepEqual(planAutoWorktreeCleanup(0), { deleteBranch: true });
		assert.equal(planAutoWorktreeCleanup(1).deleteBranch, false);
		assert.equal(shouldAbortFailedBaseMerge(1), true);
		assert.equal(shouldAbortFailedBaseMerge(0), false);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("automatic worktree isolation is planned before lock resources", () => {
	const base = resolve(__dirname, "fixture-root");
	assert.equal(shouldUseAutoWorktree("write", undefined, true), true);
	assert.equal(shouldUseAutoWorktree("write", "../explicit", true), false);
	assert.equal(shouldUseAutoWorktree("read", undefined, true), false);

	const autoPath = getAutoWorktreePath(base, "branch", "builder", 2);
	const auto = planDispatchIsolation(base, "write", { files: ["src/a.ts"] }, true, autoPath);
	assert.equal(auto.autoWorktree, true);
	assert.equal(auto.runCwd, resolve(base, "..", "worktrees", "branch", "builder-2"));
	assert.equal(getAutoMergeResolutionWorktreePath(base, "branch-builder-2-merge-resolution"), resolve(base, "..", "worktrees", "merge-resolution", "branch-builder-2-merge-resolution"));

	const explicit = planDispatchIsolation(base, "write", { files: ["src/a.ts"], worktree: "../wt" }, true);
	assert.equal(explicit.autoWorktree, false);
	assert.equal(explicit.explicitWorktree, true);
	assert.equal(explicit.runCwd, resolve(base, "../wt"));
});
