import test from "node:test";
import assert from "node:assert/strict";

import { resolveDispatcherIntegrations } from "../src/dispatcher-config";
import { parseAgentsYamlConfig } from "../src/yaml";

test("dispatcher integration defaults preserve backward-compatible allowlist when config is omitted", () => {
	const resolved = resolveDispatcherIntegrations(
		undefined,
		["dispatch_agent", "ask_user_question", "cwd", "tilldone", "sudo_exec", "ctx_search"],
		["tilldone"],
	);

	assert.deepEqual(resolved.warnings, []);
	assert.ok(resolved.tools.includes("dispatch_agent"));
	assert.ok(resolved.tools.includes("ask_user_question"), "auto default enables registered ask_user_question");
	assert.ok(resolved.tools.includes("cwd"), "auto default enables registered cwd");
	assert.ok(resolved.tools.includes("tilldone"), "preserve_active default keeps active tilldone");
	assert.ok(!resolved.tools.includes("sudo_exec"), "preserve_active default does not newly grant inactive sudo_exec");
	assert.ok(resolved.tools.includes("ctx_search"), "legacy context-mode allowlist is preserved when omitted");
	assert.ok(resolved.promptSections.some(section => section.includes("Planner Clarification Flow")));
	assert.ok(resolved.promptSections.some(section => section.includes("Current Directory")));
	assert.ok(resolved.promptSections.some(section => section.includes("TillDone")));
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

test("dangerous context tools are denied from explicit config and implicit legacy context allowlist", () => {
	const explicit = resolveDispatcherIntegrations(
		{ integrations: { ctx_purge: { enabled: true }, ctx_upgrade: { enabled: true } } },
		["dispatch_agent", "ctx_purge", "ctx_upgrade"],
		["ctx_purge", "ctx_upgrade"],
	);

	assert.deepEqual(explicit.tools, ["dispatch_agent"]);
	assert.equal(explicit.warnings.filter(warning => warning.includes("Ignoring unsafe dispatcher integration")).length, 2);

	const implicit = resolveDispatcherIntegrations(
		undefined,
		["dispatch_agent", "ctx_search", "ctx_purge", "ctx_upgrade"],
		["ctx_purge", "ctx_upgrade"],
	);

	assert.ok(implicit.tools.includes("ctx_search"));
	assert.ok(!implicit.tools.includes("ctx_purge"));
	assert.ok(!implicit.tools.includes("ctx_upgrade"));
});
