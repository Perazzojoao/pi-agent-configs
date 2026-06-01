import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
