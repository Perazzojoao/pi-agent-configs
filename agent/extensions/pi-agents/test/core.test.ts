import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	getChangedDuringRun,
	getDeclaredRelativePaths,
	getDispatchResources,
	getOutOfScopeRunChanges,
	hasDeclaredWriteScope,
	isDeclaredPath,
	normalizeTools,
	parseAgentsYaml,
	planAutoWorktreeCleanup,
	parseGitStatusZ,
	planDispatchIsolation,
	sanitizeAgentKey,
	shouldUseAutoWorktree,
	validateDispatchPaths,
	validateRelativeCheckoutPath,
	validateSameGitCommonDir,
	shouldAbortFailedBaseMerge,
	type GitStatusSnapshot,
} from "../core";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("parses real agent/agents/agents.yaml explicit defaults", () => {
	const yamlPath = resolve(__dirname, "../../../agents/agents.yaml");
	const configs = parseAgentsYaml(readFileSync(yamlPath, "utf-8"));
	const byName = new Map(configs.map(config => [config.name, config]));

	assert.ok(byName.get("scout")?.model, "scout model is configured");
	assert.equal(byName.get("scout")?.maxCtx, 150);
	assert.equal(byName.get("planner")?.effort, "high");

	for (const [name, config] of byName) {
		assert.ok(config.effort, `${name} effort`);
		if (name !== "scout") assert.equal(config.maxCtx, 100, `${name} maxCtx`);
		assert.notEqual(normalizeTools(config.tools), "", `${name} tools must not normalize to empty`);
	}
});

test("parseAgentsYaml supports simple list and map fields", () => {
	const configs = parseAgentsYaml(`
agents:
  - scout
  - planner:
    model: custom/model
    effort: high
    tools: read,grep
    max_ctx: 150
`);

	assert.deepEqual(configs[0], { name: "scout" });
	assert.equal(configs[1].name, "planner");
	assert.equal(configs[1].model, "custom/model");
	assert.equal(configs[1].effort, "high");
	assert.equal(configs[1].tools, "read,grep");
	assert.equal(configs[1].maxCtx, 150);
});

test("parseAgentsYaml supports tools inline array and block list", () => {
	const configs = parseAgentsYaml(`
agents:
  - builder:
    tools: [read, write, edit]
  - reviewer:
    tools:
      - read
      - grep
      - find
`);

	assert.deepEqual(configs[0].tools, ["read", "write", "edit"]);
	assert.equal(normalizeTools(configs[0].tools), "read,write,edit");
	assert.deepEqual(configs[1].tools, ["read", "grep", "find"]);
	assert.equal(normalizeTools(configs[1].tools), "read,grep,find");
});

test("empty tools falls back when normalized", () => {
	const configs = parseAgentsYaml(`
agents:
  - builder:
    tools:
`);

	assert.deepEqual(configs[0].tools, []);
	assert.equal(normalizeTools(configs[0].tools, "frontmatter-tools"), "frontmatter-tools");
	assert.equal(normalizeTools("", "frontmatter-tools"), "frontmatter-tools");
});

test("parseGitStatusZ parses paths, renames, and names with spaces", () => {
	const raw = ` M normal.ts\0?? file with spaces.ts\0R  new name.ts\0old name.ts\0`;
	const parsed = parseGitStatusZ(raw);

	assert.equal(parsed.get("normal.ts"), " M");
	assert.equal(parsed.get("file with spaces.ts"), "??");
	assert.equal(parsed.get("new name.ts"), "R ");
	assert.equal(parsed.get("old name.ts"), "R ");
});

test("getChangedDuringRun detects dirty file fingerprint changes", () => {
	const before: GitStatusSnapshot = { files: new Map([
		["already-dirty.ts", "old-fingerprint"],
		["removed-during-run.ts", "present"],
	]) };
	const after: GitStatusSnapshot = { files: new Map([
		["already-dirty.ts", "new-fingerprint"],
		["new-file.ts", "new"],
	]) };

	assert.deepEqual(getChangedDuringRun(before, after).files, [
		"already-dirty.ts",
		"new-file.ts",
		"removed-during-run.ts",
	]);
});

test("sanitizes agent keys for deterministic paths and branches", () => {
	assert.equal(sanitizeAgentKey("Builder Agent"), "builder-agent");
	assert.equal(sanitizeAgentKey("../evil"), null);
	assert.equal(sanitizeAgentKey("---"), null);
	assert.equal(sanitizeAgentKey("a/b"), null);
	assert.equal(sanitizeAgentKey("a..b"), null);
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
	const checkout = join(temp, "checkout");
	const outside = join(temp, "outside");
	mkdirSync(checkout);
	mkdirSync(outside);
	writeFileSync(join(outside, "secret.txt"), "secret");
	symlinkSync(outside, join(checkout, "link-out"), "dir");

	assert.equal(validateRelativeCheckoutPath(checkout, "link-out/secret.txt").ok, false);
	assert.equal(validateRelativeCheckoutPath(checkout, "link-out/new-file.txt").ok, false);
});

test("validates same git common dir and cleanup/abort decisions", () => {
	const temp = mkdtempSync(resolve(__dirname, "tmp-common-"));
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
});

test("declared paths allow directories and safe relative names", () => {
	const cwd = resolve(__dirname, "fixture-root");
	const declared = getDeclaredRelativePaths(cwd, ["src", "..foo", "../outside"]);

	assert.deepEqual(declared, ["src", "..foo"]);
	assert.equal(isDeclaredPath("src/index.ts", declared), true);
	assert.equal(isDeclaredPath("..foo", declared), true);
	assert.equal(isDeclaredPath("src-other/index.ts", declared), false);
});

test("automatic worktree isolation is planned before lock resources", () => {
	const base = resolve(__dirname, "fixture-root");
	assert.equal(shouldUseAutoWorktree("write", undefined, true), true);
	assert.equal(shouldUseAutoWorktree("write", "../explicit", true), false);
	assert.equal(shouldUseAutoWorktree("read", undefined, true), false);

	const auto = planDispatchIsolation(base, "write", { files: ["src/a.ts"] }, true, resolve(base, ".pi/agent-worktrees/branch/builder-2"));
	assert.equal(auto.autoWorktree, true);
	assert.equal(auto.runCwd.endsWith(".pi/agent-worktrees/branch/builder-2"), true);

	const explicit = planDispatchIsolation(base, "write", { files: ["src/a.ts"], worktree: "../wt" }, true);
	assert.equal(explicit.autoWorktree, false);
	assert.equal(explicit.explicitWorktree, true);
	assert.equal(explicit.runCwd, resolve(base, "../wt"));
});

test("dispatch resources are calculated against effective run cwd and include checkout write lock", () => {
	const base = resolve(__dirname, "fixture-root");
	const run = resolve(base, ".pi/agent-worktrees/branch/builder-2");
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

test("explicit worktree files are validated against effective checkout, not original cwd", () => {
	const temp = mkdtempSync(resolve(__dirname, "tmp-explicit-"));
	const base = join(temp, "base");
	const explicit = join(temp, "explicit");
	const outside = join(temp, "outside");
	mkdirSync(base, { recursive: true });
	mkdirSync(outside, { recursive: true });
	mkdirSync(join(explicit, "only-here"), { recursive: true });
	symlinkSync(outside, join(base, "only-here"), "dir");
	assert.equal(validateDispatchPaths(base, { files: ["only-here/file.ts"] }).ok, false, "same file path is unsafe in original/base cwd");
	assert.equal(validateDispatchPaths(explicit, { files: ["only-here/file.ts"] }).ok, true, "same file path is safe in explicit worktree");
});

test("getOutOfScopeRunChanges allows declared directories and detects outside files", () => {
	const cwd = resolve(__dirname, "fixture-root");
	const before: GitStatusSnapshot = { files: new Map([
		["src/preexisting.ts", "old"],
	]) };
	const after: GitStatusSnapshot = { files: new Map([
		["src/preexisting.ts", "new"],
		["src/new.ts", "new"],
		["docs/outside.md", "new"],
	]) };

	const result = getOutOfScopeRunChanges(cwd, ["src"], before, after);
	assert.deepEqual(result.changedDuringRun, ["docs/outside.md", "src/new.ts", "src/preexisting.ts"]);
	assert.deepEqual(result.outOfScope, ["docs/outside.md"]);
});
