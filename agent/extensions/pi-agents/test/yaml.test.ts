import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeTools, parseAgentsYaml } from "../src/yaml";

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
