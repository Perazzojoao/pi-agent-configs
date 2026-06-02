import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getContextTools, mergeToolLists, normalizeContextMode } from "../src/context-mode";
import { cleanYamlValue, normalizeTools, parseAgentsYaml, parseYamlValue } from "../src/yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("parses real agent/agents/agents.yaml explicit defaults", () => {
	const yamlPath = resolve(__dirname, "../../../agents/agents.yaml");
	const configs = parseAgentsYaml(readFileSync(yamlPath, "utf-8"));
	const byName = new Map(configs.map(config => [config.name, config]));

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

test("context-mode helpers normalize profiles and merge tools without duplicates", () => {
	assert.equal(normalizeContextMode("unknown"), "off");
	assert.equal(normalizeContextMode("all"), "all");
	assert.equal(mergeToolLists("read,grep,ctx_search", ["ctx_search", "ctx_stats"]), "read,grep,ctx_search,ctx_stats");
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
