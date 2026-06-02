import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ansiVisibleWidth, fitLine } from "../src/widget";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, "../src/extension.ts"), "utf-8");
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

test("status bar is refreshed from updateWidget", () => {
	assert.match(source, /function getStatusText\(\): string \{/);
	assert.match(source, /function updateStatus\(\) \{/);
	assert.match(source, /function updateWidget\(\) \{\s*if \(!widgetCtx\) return;\s*updateStatus\(\);/s);
	assert.match(source, /widgetCtx\.ui\.setStatus\("pi-agents", getStatusText\(\)\);/);
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
