import test from "node:test";
import assert from "node:assert/strict";

import { resolveDispatcherIntegrations } from "../src/dispatcher-config";
import { parseAgentsYamlConfig } from "../src/yaml";

test("dispatcher integrations default to base dispatch plus safe context-mode tools when config is omitted", () => {
	const resolved = resolveDispatcherIntegrations(
		undefined,
		["dispatch_agent", "ask_user_question", "cwd", "tilldone", "sudo_exec", "ctx_search"],
		["tilldone"],
	);

	assert.deepEqual(resolved.warnings, []);
	assert.deepEqual(resolved.tools, ["dispatch_agent", "ctx_search"]);
	assert.deepEqual(resolved.promptSections, []);
	assert.deepEqual(resolved.enabledIntegrations, []);
	assert.ok(!resolved.tools.includes("ask_user_question"));
	assert.ok(!resolved.tools.includes("cwd"));
	assert.ok(!resolved.tools.includes("tilldone"));
	assert.ok(!resolved.tools.includes("sudo_exec"));
});

test("dispatcher integrations parse block prompts and enabled values", () => {
	const config = parseAgentsYamlConfig(`
dispatcher:
  integrations:
    enabled_true:
      enabled: true
      prompt: |
        true prompt
    enabled_false:
      enabled: false
      prompt: |
        false prompt
    enabled_auto:
      enabled: auto
      prompt: |
        auto prompt
    enabled_preserve:
      enabled: preserve_active
      prompt: |
        preserve prompt
agents:
  - scout
`);

	assert.equal(config.dispatcher?.integrations?.enabled_true.enabled, true);
	assert.equal(config.dispatcher?.integrations?.enabled_false.enabled, false);
	assert.equal(config.dispatcher?.integrations?.enabled_auto.enabled, "auto");
	assert.equal(config.dispatcher?.integrations?.enabled_preserve.enabled, "preserve_active");
	assert.equal(config.dispatcher?.integrations?.enabled_true.prompt, "true prompt");

	const resolved = resolveDispatcherIntegrations(
		config.dispatcher,
		["dispatch_agent", "enabled_true", "enabled_false", "enabled_auto", "enabled_preserve"],
		["enabled_preserve"],
	);

	assert.ok(resolved.tools.includes("enabled_true"));
	assert.ok(!resolved.tools.includes("enabled_false"));
	assert.ok(resolved.tools.includes("enabled_auto"));
	assert.ok(resolved.tools.includes("enabled_preserve"));
	assert.deepEqual(resolved.promptSections.filter(section => section.endsWith("prompt")), [
		"true prompt",
		"auto prompt",
		"preserve prompt",
	]);
});

test("dispatcher config cannot grant direct codebase or dangerous context tools", () => {
	const config = parseAgentsYamlConfig(`
dispatcher:
  integrations:
    read:
      enabled: true
      prompt: direct read prompt
    write:
      enabled: true
    edit:
      enabled: true
    bash:
      enabled: true
    grep:
      enabled: true
    find:
      enabled: true
    ls:
      enabled: true
    ctx_purge:
      enabled: true
      prompt: purge prompt
    ctx_upgrade:
      enabled: true
      prompt: upgrade prompt
agents:
  - scout
`);

	const resolved = resolveDispatcherIntegrations(
		config.dispatcher,
		["dispatch_agent", "read", "write", "edit", "bash", "grep", "find", "ls", "ctx_purge", "ctx_upgrade"],
		[],
	);

	for (const tool of ["read", "write", "edit", "bash", "grep", "find", "ls", "ctx_purge", "ctx_upgrade"]) {
		assert.ok(!resolved.tools.includes(tool), `${tool} must not be granted by dispatcher config`);
	}
	assert.ok(!resolved.promptSections.some(section => /read prompt|purge prompt|upgrade prompt/.test(section)));
	assert.equal(resolved.warnings.filter(warning => warning.includes("Ignoring unsafe dispatcher integration")).length, 9);
});

test("disabled dispatcher integration excludes both allowlist access and prompt section", () => {
	const resolved = resolveDispatcherIntegrations(
		{ integrations: { ask_user_question: { enabled: false, prompt: "disabled question prompt" } } },
		["dispatch_agent", "ask_user_question"],
		["ask_user_question"],
	);

	assert.ok(!resolved.tools.includes("ask_user_question"));
	assert.ok(!resolved.promptSections.some(section => section.includes("disabled question prompt")));
});

test("dispatcher prompt text alone does not grant access without an allowed and enabled tool", () => {
	const resolved = resolveDispatcherIntegrations(
		{ integrations: { missing_tool: { enabled: true, prompt: "missing tool prompt" } } },
		["dispatch_agent"],
		[],
	);

	assert.deepEqual(resolved.tools, ["dispatch_agent"]);
	assert.ok(!resolved.promptSections.includes("missing tool prompt"));
	assert.ok(resolved.warnings.some(warning => warning.includes("no matching tool is registered")));
});

test("prompt-only registered custom dispatcher integration does not grant access or prompt section", () => {
	const resolved = resolveDispatcherIntegrations(
		{ integrations: { custom_tool: { prompt: "registered prompt-only custom tool" } } },
		["dispatch_agent", "custom_tool"],
		["custom_tool"],
	);

	assert.deepEqual(resolved.tools, ["dispatch_agent"]);
	assert.ok(!resolved.promptSections.includes("registered prompt-only custom tool"));
	assert.ok(resolved.warnings.some(warning => warning.includes("prompt text alone cannot grant access")));
});

test("invalid dispatcher integration enabled value does not auto-enable and produces warnings", () => {
	const config = parseAgentsYamlConfig(`
dispatcher:
  integrations:
    custom_tool:
      enabled: sometimes
      prompt: invalid enabled prompt
agents:
  - scout
`);

	assert.ok(config.warnings.some(warning => warning.includes("Invalid dispatcher.integrations.custom_tool.enabled value")));

	const resolved = resolveDispatcherIntegrations(config.dispatcher, ["dispatch_agent", "custom_tool"], ["custom_tool"]);

	assert.deepEqual(resolved.tools, ["dispatch_agent"]);
	assert.ok(!resolved.promptSections.includes("invalid enabled prompt"));

	const directResolved = resolveDispatcherIntegrations(
		{ integrations: { custom_tool: { enabled: "sometimes" as any, prompt: "invalid direct prompt" } } },
		["dispatch_agent", "custom_tool"],
		["custom_tool"],
	);
	assert.deepEqual(directResolved.tools, ["dispatch_agent"]);
	assert.ok(!directResolved.promptSections.includes("invalid direct prompt"));
	assert.ok(directResolved.warnings.some(warning => warning.includes("invalid enabled value")));
});

test("dangerous context tools are denied while safe context tools remain implicit", () => {
	const explicit = resolveDispatcherIntegrations(
		{
			integrations: {
				ctx_search: { enabled: true, prompt: "Search indexed context." },
				ctx_purge: { enabled: true },
				ctx_upgrade: { enabled: true },
			},
		},
		["dispatch_agent", "ctx_search", "ctx_purge", "ctx_upgrade"],
		["ctx_purge", "ctx_upgrade"],
	);

	assert.deepEqual(explicit.tools, ["dispatch_agent", "ctx_search"]);
	assert.deepEqual(explicit.promptSections, ["Search indexed context."]);
	assert.equal(explicit.warnings.filter(warning => warning.includes("Ignoring unsafe dispatcher integration")).length, 2);

	const implicit = resolveDispatcherIntegrations(
		undefined,
		["dispatch_agent", "ctx_search", "ctx_purge", "ctx_upgrade"],
		["ctx_purge", "ctx_upgrade"],
	);

	assert.deepEqual(implicit.tools, ["dispatch_agent", "ctx_search"]);
});

test("explicit dispatcher config controls safe context tools", () => {
	const disabled = resolveDispatcherIntegrations(
		{ integrations: { ctx_search: { enabled: false, prompt: "disabled context prompt" } } },
		["dispatch_agent", "ctx_search"],
		["ctx_search"],
	);

	assert.deepEqual(disabled.tools, ["dispatch_agent"]);
	assert.deepEqual(disabled.promptSections, []);
});
