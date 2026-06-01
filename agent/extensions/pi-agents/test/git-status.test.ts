import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getChangedDuringRun, getOutOfScopeRunChanges, parseGitStatusZ } from "../src/git-status";
import type { GitStatusSnapshot } from "../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
