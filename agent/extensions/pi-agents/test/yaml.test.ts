import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { findContextModeExtension, getContextTools, mergeToolLists, normalizeContextMode } from "../src/context-mode";
import { cleanYamlValue, normalizeTools, parseAgentsYaml, parseAgentsYamlConfig, parseYamlValue } from "../src/yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("parses real agent/agents/agents.yaml explicit defaults", () => {
	const yamlPath = resolve(__dirname, "../../../agents/agents.yaml");
	const raw = readFileSync(yamlPath, "utf-8");
	const parsedConfig = parseAgentsYamlConfig(raw);
	const configs = parseAgentsYaml(raw);
	const byName = new Map(configs.map(config => [config.name, config]));

	assert.equal(parsedConfig.runtime.fallbackModel, "openai-codex/gpt-5.5");

	assert.ok(byName.get("scout")?.model, "scout model is configured");
	assert.equal(byName.get("scout")?.maxCtx, 150);
	assert.equal(byName.get("planner")?.effort, "medium");

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
    fallback_model: fallback/model
    effort: high
    tools: read,grep
    max_ctx: 150
`);

	assert.deepEqual(configs[0], { name: "scout" });
	assert.equal(configs[1].name, "planner");
	assert.equal(configs[1].model, "custom/model");
	assert.equal(configs[1].fallbackModel, "fallback/model");
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

test("parseAgentsYaml supports context-mode profiles and filtered custom tools", () => {
	const configs = parseAgentsYaml(`
agents:
  - scout:
    context_mode: true
  - builder:
    context_mode: custom
    context_tools: [ctx_execute, read, ctx_search, not_a_ctx_tool]
  - reviewer:
    context_mode: false
  - analyst:
    context_mode: exec
    context_tools:
      - ctx_batch_execute
      - write
`);

	assert.equal(configs[0].contextMode, "safe");
	assert.deepEqual(getContextTools(configs[0].contextMode, configs[0].contextTools), ["ctx_execute_file", "ctx_index", "ctx_search", "ctx_fetch_and_index", "ctx_stats"]);
	assert.equal(configs[1].contextMode, "custom");
	assert.deepEqual(configs[1].contextTools, ["ctx_execute", "ctx_search"]);
	assert.deepEqual(getContextTools(configs[1].contextMode, configs[1].contextTools), ["ctx_execute", "ctx_search"]);
	assert.equal(configs[2].contextMode, "off");
	assert.deepEqual(getContextTools(configs[2].contextMode, configs[2].contextTools), []);
	assert.equal(configs[3].contextMode, "exec");
	assert.deepEqual(configs[3].contextTools, ["ctx_batch_execute"]);
});

test("parseAgentsYaml tracks active nested list field in any order", () => {
	const configs = parseAgentsYaml(`
agents:
  - builder:
    context_mode: custom
    context_tools:
      - ctx_search
      - write
    tools:
      - read
      - edit
  - reviewer:
    tools:
      - grep
      - find
    context_tools:
      - ctx_execute_file
      - not_ctx
`);

	assert.deepEqual(configs[0].contextTools, ["ctx_search"]);
	assert.deepEqual(configs[0].tools, ["read", "edit"]);
	assert.deepEqual(configs[1].tools, ["grep", "find"]);
	assert.deepEqual(configs[1].contextTools, ["ctx_execute_file"]);
});

test("parseAgentsYamlConfig supports runtime, auto worktree, and per-agent instances", () => {
	const config = parseAgentsYamlConfig(`
runtime:
  max_parallel_agents: 5
  sessions_dir: .pi/custom-sessions
  fallback_model: runtime/fallback
auto_worktree:
  base_dir: ../custom-worktrees
  merge_resolution_dir: resolve
agents:
  - scout:
    instances: 4
  - builder:
    effort: high
`);

	assert.equal(config.runtime.maxParallelAgents, 5);
	assert.equal(config.runtime.sessionsDir, ".pi/custom-sessions");
	assert.equal(config.runtime.fallbackModel, "runtime/fallback");
	assert.equal(config.autoWorktree.baseDir, "../custom-worktrees");
	assert.equal(config.autoWorktree.mergeResolutionDir, "resolve");
	assert.equal(config.agents[0].instances, 4);
	assert.equal(config.agents[1].effort, "high");
	assert.equal(config.agents[1].instances, undefined);
});

test("parseAgentsYamlConfig defaults match existing runtime behavior", () => {
	const config = parseAgentsYamlConfig(`agents:\n  - scout\n`);

	assert.equal(config.runtime.maxParallelAgents, 3);
	assert.equal(config.runtime.sessionsDir, ".pi/agent-sessions");
	assert.equal(config.runtime.fallbackModel, undefined);
	assert.equal(config.autoWorktree.baseDir, "../worktrees");
	assert.equal(config.autoWorktree.mergeResolutionDir, "merge-resolution");
});

test("parseAgentsYaml remains compatible with runtime section by returning only agent entries", () => {
	const configs = parseAgentsYaml(`
runtime:
  max_parallel_agents: 9
agents:
  - scout
`);

	assert.deepEqual(configs, [{ name: "scout" }]);
});

test("context-mode helpers normalize profiles and merge tools without duplicates", () => {
	assert.equal(normalizeContextMode(true), "safe");
	assert.equal(normalizeContextMode(false), "off");
	assert.equal(normalizeContextMode(null), "off");
	assert.equal(normalizeContextMode(""), "off");
	assert.equal(normalizeContextMode(" true "), "safe");
	assert.equal(normalizeContextMode("false"), "off");
	assert.equal(normalizeContextMode("custom"), "custom");
	assert.equal(normalizeContextMode("unknown"), "off");
	assert.equal(normalizeContextMode("all"), "all");
	assert.deepEqual(getContextTools("exec", undefined), ["ctx_execute", "ctx_execute_file", "ctx_batch_execute", "ctx_stats"]);
	assert.deepEqual(getContextTools("all", undefined), [
		"ctx_execute",
		"ctx_execute_file",
		"ctx_index",
		"ctx_search",
		"ctx_fetch_and_index",
		"ctx_batch_execute",
		"ctx_stats",
		"ctx_doctor",
		"ctx_upgrade",
		"ctx_purge",
		"ctx_insight",
	]);
	assert.deepEqual(getContextTools("custom", undefined), []);
	assert.equal(mergeToolLists("read, grep, ctx_search", ["ctx_search", "ctx_stats"]), "read,grep,ctx_search,ctx_stats");
	assert.equal(mergeToolLists("", ["ctx_search"]), "ctx_search");
});

test("findContextModeExtension returns an existing override before path discovery", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-agents-context-mode-"));
	try {
		mkdirSync(join(cwd, "overrides"), { recursive: true });
		const override = join(cwd, "overrides", "extension.js");
		writeFileSync(override, "export default {};\n");
		const discovered = join(cwd, "node_modules", "context-mode", "build", "adapters", "pi", "extension.js");
		mkdirSync(dirname(discovered), { recursive: true });
		writeFileSync(discovered, "export default {};\n");

		assert.equal(findContextModeExtension(cwd, { PI_AGENTS_CONTEXT_MODE_EXTENSION: "overrides/extension.js" }), override);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("findContextModeExtension ignores missing overrides and discovers cwd package paths", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-agents-context-mode-"));
	try {
		const discovered = join(cwd, "node_modules", "context-mode", "build", "adapters", "pi", "extension.js");
		mkdirSync(dirname(discovered), { recursive: true });
		writeFileSync(discovered, "export default {};\n");

		assert.equal(findContextModeExtension(cwd, { PI_AGENTS_CONTEXT_MODE_EXTENSION: "missing.js" }), discovered);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
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

test("parseAgentsYaml supports one-line scalar model entries", () => {
	const configs = parseAgentsYaml(`
agents:
  - scout: custom/model
`);

	assert.deepEqual(configs, [{ name: "scout", model: "custom/model" }]);
});

test("parseAgentsYaml ignores duplicate agent names case-insensitively", () => {
	const configs = parseAgentsYaml(`
agents:
  - Scout:
    model: first/model
  - scout:
    model: second/model
  - planner: inline/model
`);

	assert.deepEqual(configs.map(config => config.name), ["Scout", "planner"]);
	assert.equal(configs[0].model, "first/model");
	assert.equal(configs[1].model, "inline/model");
});

test("parseAgentsYaml skips invalid max_ctx and strips quoted scalar values", () => {
	const configs = parseAgentsYaml(`
agents:
  - "quoted agent":
    model: 'custom/model'
    effort: "medium"
    max_ctx: not-a-number
`);

	assert.equal(configs[0].name, "quoted agent");
	assert.equal(configs[0].model, "custom/model");
	assert.equal(configs[0].effort, "medium");
	assert.equal(configs[0].maxCtx, undefined);
});

test("yaml value helpers trim quotes and empty inline array entries", () => {
	assert.equal(cleanYamlValue(" 'read' "), "read");
	assert.deepEqual(parseYamlValue("[read, '', grep,  ]"), ["read", "grep"]);
});
