import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	getAutoMergeResolutionWorktreePath,
	getAutoWorktreePath,
	getAgentSessionBasenames,
	getDeclaredRelativePaths,
	getDispatchResources,
	hasDeclaredWriteScope,
	isDeclaredPath,
	sanitizeAgentKey,
	validateDispatchPaths,
	validateRelativeCheckoutPath,
} from "../src/paths";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("sanitizes agent keys for deterministic paths and branches", () => {
	assert.equal(sanitizeAgentKey("Builder Agent"), "builder-agent");
	assert.equal(sanitizeAgentKey("../evil"), null);
	assert.equal(sanitizeAgentKey("---"), null);
	assert.equal(sanitizeAgentKey("a/b"), null);
	assert.equal(sanitizeAgentKey("a..b"), null);
});

test("returns only known generated agent session file basenames", () => {
	assert.deepEqual(getAgentSessionBasenames("Builder Agent", 2), ["builder-agent-1.json", "builder-agent-2.json"]);
	assert.deepEqual(getAgentSessionBasenames("../evil", 2), []);
	assert.ok(!getAgentSessionBasenames("Builder Agent", 2).includes("unrelated.json"));
});

test("rejects absolute or escaping declared file paths", () => {
	const cwd = resolve(__dirname, "fixture-root");
	assert.equal(validateRelativeCheckoutPath(cwd, "src/index.ts").ok, true);
	assert.equal(validateRelativeCheckoutPath(cwd, "/tmp/evil").ok, false);
	assert.equal(validateRelativeCheckoutPath(cwd, "../outside").ok, false);
	assert.equal(validateDispatchPaths(cwd, { files: ["src/index.ts", "../outside"] }).ok, false);
});

test("rejects symlink paths that resolve outside checkout including nonexistent child", () => {
	const temp = mkdtempSync(resolve(__dirname, "tmp-symlink-"));
	try {
		const checkout = join(temp, "checkout");
		const outside = join(temp, "outside");
		mkdirSync(checkout);
		mkdirSync(outside);
		writeFileSync(join(outside, "secret.txt"), "secret");
		symlinkSync(outside, join(checkout, "link-out"), "dir");

		assert.equal(validateRelativeCheckoutPath(checkout, "link-out/secret.txt").ok, false);
		assert.equal(validateRelativeCheckoutPath(checkout, "link-out/new-file.txt").ok, false);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("declared paths allow directories and safe relative names", () => {
	const cwd = resolve(__dirname, "fixture-root");
	const declared = getDeclaredRelativePaths(cwd, ["src", "..foo", "../outside"]);

	assert.deepEqual(declared, ["src", "..foo"]);
	assert.equal(isDeclaredPath("src/index.ts", declared), true);
	assert.equal(isDeclaredPath("..foo", declared), true);
	assert.equal(isDeclaredPath("src-other/index.ts", declared), false);
});

test("dispatch resources are calculated against effective run cwd and include checkout write lock", () => {
	const base = resolve(__dirname, "fixture-root");
	const run = resolve(base, "..", "worktrees", "branch", "builder-2");
	const baseResources = getDispatchResources(base, "write", { files: ["src/a.ts"] });
	const wtResources = getDispatchResources(run, "write", { files: ["src/a.ts"] });

	assert.deepEqual(baseResources, [`checkout:${base}`, `file:${resolve(base, "src/a.ts")}`].sort());
	assert.deepEqual(wtResources, [`checkout:${run}`, `file:${resolve(run, "src/a.ts")}`].sort());
	assert.notDeepEqual(baseResources, wtResources);
	assert.deepEqual(getDispatchResources(base, "read", { files: ["src/a.ts"] }), [`file:${resolve(base, "src/a.ts")}`]);
	assert.equal(hasDeclaredWriteScope({ files: [" "] }), false);
	assert.equal(hasDeclaredWriteScope({ worktree: "../wt" }), true);
});

test("base checkout lock can be canonical root even when run cwd is a subdirectory", () => {
	const root = resolve(__dirname, "fixture-root");
	const subdir = resolve(root, "packages/app");
	const resources = getDispatchResources(subdir, "write", { files: ["src/a.ts"] }, root);
	assert.ok(resources.includes(`checkout:${root}`));
	assert.ok(!resources.includes(`checkout:${subdir}`));
	assert.ok(resources.includes(`file:${resolve(subdir, "src/a.ts")}`));
});

test("auto worktree paths support configurable base and merge resolution directory", () => {
	const base = resolve(__dirname, "fixture-root");
	const config = {
		baseDir: "../custom-worktrees",
		mergeResolutionDir: "resolve",
	};

	assert.equal(getAutoWorktreePath(base, "main", "builder", 2, config), resolve(base, "..", "custom-worktrees", "main", "builder-2"));
	assert.equal(getAutoMergeResolutionWorktreePath(base, "main-builder", config), resolve(base, "..", "custom-worktrees", "resolve", "main-builder"));
});

test("explicit worktree files are validated against effective checkout, not original cwd", () => {
	const temp = mkdtempSync(resolve(__dirname, "tmp-explicit-"));
	try {
		const base = join(temp, "base");
		const explicit = join(temp, "explicit");
		const outside = join(temp, "outside");
		mkdirSync(base, { recursive: true });
		mkdirSync(outside, { recursive: true });
		mkdirSync(join(explicit, "only-here"), { recursive: true });
		symlinkSync(outside, join(base, "only-here"), "dir");
		assert.equal(validateDispatchPaths(base, { files: ["only-here/file.ts"] }).ok, false, "same file path is unsafe in original/base cwd");
		assert.equal(validateDispatchPaths(explicit, { files: ["only-here/file.ts"] }).ok, true, "same file path is safe in explicit worktree");
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
