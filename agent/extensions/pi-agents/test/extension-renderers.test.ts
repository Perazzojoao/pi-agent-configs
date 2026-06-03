import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ansiVisibleWidth, fitLine } from "../src/widget";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, "../src/extension.ts"), "utf-8");
const contextModeSource = readFileSync(resolve(__dirname, "../src/context-mode.ts"), "utf-8");
const indexSource = readFileSync(resolve(__dirname, "../index.ts"), "utf-8");

test("package entry exports extension implementation", () => {
	assert.match(indexSource, /export \{ default \} from "\.\/src\/extension";/);
});

test("dispatch_agent custom renderers use width-safe renderables and bounded output", () => {
	assert.match(source, /function widthSafeRenderable/);
	assert.match(source, /renderCall\(args, theme\) \{\s*return widthSafeRenderable/s);
	assert.match(source, /renderResult\(result, options, theme\) \{\s*return widthSafeRenderable/s);
	assert.match(source, /limitTextLines\(String\(details\.fullOutput\), 4000, 80\)/);
});

test("extension render paths use safe theme helpers and exact-fit footer padding", () => {
	assert.match(source, /function safeFg/);
	assert.match(source, /function safeBold/);
	assert.match(source, /safeFg\(theme, "muted", ` \$\{model\}`\)/);
	assert.match(source, /Math\.max\(0, width - ansiVisibleWidth\(left\) - ansiVisibleWidth\(right\)\)/);
});

test("YAML runtime config is wired into extension behavior", () => {
	assert.match(source, /const parsedConfig = parseAgentsYamlConfig\(readFileSync\(agentsConfigPath, "utf-8"\)\);/);
	assert.match(source, /maxParallelDispatches = parsedConfig\.runtime\.maxParallelAgents;/);
	assert.match(source, /sessionDir = resolveSafeSessionDir\(cwd, parsedConfig\.runtime\.sessionsDir, runtimeConfigWarnings\);/);
	assert.match(source, /autoWorktreeConfig = parsedConfig\.autoWorktree;/);
	assert.match(source, /getAutoWorktreePath\(baseCwd, branchSlug, agentKey, instanceIndex, autoWorktreeConfig\)/);
	assert.match(source, /getAutoMergeResolutionWorktreePath\(worktree\.baseCwd, branchSlug, autoWorktreeConfig\)/);
	assert.match(source, /globalRunning >= maxParallelDispatches/);
	assert.match(source, /cleanupSessionJsonFiles\(sessionDir\);/);
});

test("per-agent instances config controls local instance pool and prompt", () => {
	assert.match(source, /Array\.from\(\{ length: Math\.max\(1, config\.instances \|\| 3\) \}/);
	assert.match(source, /up to \$\{s\.instances\.length\} local instance\(s\), counting toward the global limit of \$\{maxParallelDispatches\}/);
});

test("status bar is refreshed from updateWidget", () => {
	assert.match(source, /function getStatusText\(\): string \{/);
	assert.match(source, /function updateStatus\(\) \{/);
	assert.match(source, /function updateWidget\(\) \{\s*if \(!widgetCtx\) return;\s*updateStatus\(\);/s);
	assert.match(source, /widgetCtx\.ui\.setStatus\("pi-agents", getStatusText\(\)\);/);
});

test("registered context-mode tools are included in dispatcher allowlist", () => {
	for (const toolName of [
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
	]) {
		assert.match(contextModeSource, new RegExp(`"${toolName}"`));
	}
	assert.match(source, /function updateDispatcherAllowlist\(\): string\[] \{/);
	assert.match(source, /contextModeToolsEnabled = CONTEXT_MODE_TOOL_NAMES\.filter\(name => allToolNames\.includes\(name\)\);/);
	assert.match(source, /allowedTools\.push\(\.\.\.contextModeToolsEnabled\);/);
	assert.match(source, /dispatcherTools\.push\(\.\.\.contextModeToolsEnabled\);/);
	assert.match(source, /pi\.on\("before_agent_start", async[\s\S]*?updateDispatcherAllowlist\(\);/);
	assert.match(source, /pi\.on\("session_start", async[\s\S]*?const allowedTools = updateDispatcherAllowlist\(\);/);
});

test("specialist context-mode configuration affects spawn args and missing extension errors", () => {
	assert.match(source, /const contextTools = getContextTools\(agentState\.config\.contextMode, agentState\.config\.contextTools\);/);
	assert.match(source, /const tools = mergeToolLists\(baseTools, contextTools\);/);
	assert.match(source, /findContextModeExtension\(ctx\.cwd\)[\s\S]*?planDispatchIsolation\(/);
	assert.match(source, /"--no-extensions",\s*\.\.\.\(contextModeExtension \? \["-e", contextModeExtension\] : \[\]\),/s);
	assert.match(source, /const primaryModel = resolvePrimaryModel\(agentState\.config, ctx\);/);
	assert.match(source, /const fallbackModel = resolveFallbackModel\(agentState\.config, ctx\);/);
	assert.doesNotMatch(source, /--fallback-model|cliSupportsFallbackModelFlag/);
	assert.match(source, /\.\.\.buildModelArgs\(modelForAttempt\),/);
	assert.match(source, /isModelFallbackEligibleFailure\(reason\)/);
	assert.match(source, /if \(attemptDone \|\| finished\) return;/);
	assert.match(source, /if \(fallbackRetryStarted \|\| retried \|\| !primaryModel \|\| !fallbackModel \|\| primaryModel === fallbackModel\) return false;/);
	assert.match(source, /buildArgs\(modelForAttempt, retried \? fallbackRetryNote : "", retried && existsSync\(agentSessionFile\)\)/);
	assert.match(source, /runAttempt\(fallbackModel, true\);/);
	assert.match(source, /Primary attempt diagnostic \(truncated\)/);
	assert.match(source, /primary model \$\{primaryModel\} failed/);
	assert.match(source, /context_mode is enabled for/);
	assert.match(source, /PI_AGENTS_CONTEXT_MODE_EXTENSION/);
});

test("agent stdout event handling is shared by streamed lines and final buffer", () => {
	assert.match(source, /const handleAgentEvent = \(event: any\) => \{/);
	assert.match(source, /event\.type === "message_end"[\s\S]*?updateContextPct\(extractContextTokens\(msg\.usage\)\)/);
	assert.match(source, /event\.type === "agent_end"[\s\S]*?updateContextPct\(extractContextTokens\(last\.usage\)\)/);
	assert.match(source, /for \(const line of lines\)[\s\S]*?handleAgentEvent\(JSON\.parse\(line\)\)/);
	assert.match(source, /if \(buffer\.trim\(\)\)[\s\S]*?handleAgentEvent\(JSON\.parse\(buffer\)\)/);
});

test("dispatch_agent renderers inherit fitLine background padding behavior", () => {
	assert.match(source, /\.map\(line => fitLine\(line, safeWidth\)\)/);

	const rendered = fitLine("\x1b[48;5;236mdispatch_agent scout read — inspect ✅ files\x1b[0m", 64);
	assert.equal(ansiVisibleWidth(rendered), 64);
	assert.match(rendered, /^\x1b\[48;5;236m.* +\x1b\[0m$/u);

	const piLikeForeground = fitLine("\x1b[35mdispatch_agent scout read — inspect ✅ files\x1b[39m", 64);
	assert.equal(ansiVisibleWidth(piLikeForeground), 64);
	assert.doesNotMatch(piLikeForeground, /\x1b\[0m +$/);
	assert.match(`\x1b[48;5;236m${piLikeForeground}\x1b[49m`, / {20}\x1b\[49m$/u);
});
