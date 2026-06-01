import test from "node:test";
import assert from "node:assert/strict";

import { ansiVisibleWidth, buildSpecialistColorMap, fitLine, renderAgentsWidget, stripAnsi, truncateAnsiToWidth, type AgentWidgetState } from "../src/widget";

const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	bold: (text: string) => `**${text}**`,
};

const ansiTheme = {
	fg: (_color: string, text: string) => `\x1b[2m${text}\x1b[0m`,
};

function state(overrides: Partial<AgentWidgetState> = {}): AgentWidgetState {
	return {
		name: "scout",
		description: "explores the repository",
		model: "openai/example-model-with-a-very-long-name",
		maxCtx: 150,
		instances: [
			{
				index: 1,
				status: "idle",
				task: "",
				lastWork: "",
				contextPct: 0,
				elapsed: 0,
				runCount: 0,
				sessionFile: null,
			},
		],
		...overrides,
	};
}

test("widget empty state is width safe", () => {
	for (const width of [0, 1, 2, 10, 30]) {
		const lines = renderAgentsWidget([state()], width, theme);
		for (const line of lines) assert.ok(ansiVisibleWidth(line) <= Math.max(0, width), `${width}: ${line}`);
	}
});

test("widget only shows spawned/relevant instances", () => {
	const lines = renderAgentsWidget([state({
		instances: [
			{ index: 1, status: "idle", task: "", lastWork: "", contextPct: 0, elapsed: 0, runCount: 0, sessionFile: null },
			{ index: 2, status: "running", task: "scan files", lastWork: "", contextPct: 50, elapsed: 1000, runCount: 1, sessionFile: null },
		],
	})], 80, theme).join("\n");

	assert.match(lines, /Scout #2/);
	assert.doesNotMatch(lines, /Scout #1/);
});

test("widget applies requested labels, tree layout, context token estimate, and thinking", () => {
	const lines = renderAgentsWidget([state({
		thinking: "medium",
		instances: [{ index: 1, status: "running", task: "scan files", lastWork: "", contextPct: 50, elapsed: 1000, runCount: 1, sessionFile: null }],
	})], 220, {}, { model: "github-copilot/gpt-5-mini", thinking: "low", contextTokens: 1234 });
	const plain = lines.map(stripAnsi).join("\n");

	assert.match(lines[0], /^\x1b\[36m◆ Dispatcher:/);
	assert.match(plain, /^◆ Dispatcher:  🧠 1k  github-copilot\/gpt-5-mini  \(low\)/);
	assert.match(plain, /\|- ◇ Scout #1: .*● running • .*🧠 75k.* •  .*openai\/example-model-with-a-very-long-name \(medium\)  .*1s/);
	assert.match(plain, /\|    ↳ .*scan files/);
});

test("widget assigns deterministic distinct colors to specialists in a render", () => {
	const lines = renderAgentsWidget([
		state({ name: "scout", instances: [{ index: 1, status: "running", task: "x", lastWork: "", contextPct: 0, elapsed: 1, runCount: 1, sessionFile: null }] }),
		state({ name: "planner", instances: [{ index: 1, status: "running", task: "x", lastWork: "", contextPct: 0, elapsed: 1, runCount: 1, sessionFile: null }] }),
	], 120, {});
	const colors = lines.filter(line => /#1/.test(line)).map(line => line.match(/\x1b\[38;2;(\d+;\d+;\d+)m/)?.[1]);
	assert.equal(colors.length, 2);
	assert.notEqual(colors[0], colors[1]);
});

test("widget context color thresholds are muted, orange, error", () => {
	const mk = (pct: number) => renderAgentsWidget([state({
		instances: [{ index: 1, status: "done", task: "x", lastWork: "", contextPct: pct, elapsed: 1, runCount: 1, sessionFile: null }],
	})], 120, theme)[1];

	assert.match(mk(50), /<muted>🧠 75k<\/muted>/);
	assert.match(mk(51), /\x1b\[38;5;208m🧠 77k\x1b\[0m/);
	assert.match(mk(76), /<error>🧠 114k<\/error>/);
});

test("all widget lines are width limited with ansi and emoji edge cases", () => {
	const widths = [1, 2, 3, 5, 10, 20, 40, 106, 214];
	for (const width of widths) {
		const lines = renderAgentsWidget([state({
			name: "very-long-specialist-name",
			instances: [{
				index: 123,
				status: "error",
				task: "😀".repeat(30) + " a very long task that should never overflow terminal width ✅",
				lastWork: "",
				contextPct: 99,
				elapsed: 123456,
				runCount: 1,
				sessionFile: null,
			}],
		})], width, ansiTheme);
		for (const line of lines) assert.ok(ansiVisibleWidth(line) <= width, `line width ${ansiVisibleWidth(line)} > ${width}: ${line}`);
	}
});

test("dingbat emoji and presentation controls are measured safely", () => {
	assert.equal(ansiVisibleWidth("✅"), 2);
	assert.equal(ansiVisibleWidth("✅".repeat(107)), 214);
	assert.equal(ansiVisibleWidth("☑️"), 2);
	assert.equal(ansiVisibleWidth("©️"), 2);
	assert.equal(ansiVisibleWidth("™️"), 2);
	assert.equal(ansiVisibleWidth("1️⃣"), 2);
	assert.equal(ansiVisibleWidth("#️⃣"), 2);
	assert.equal(ansiVisibleWidth("*️⃣"), 2);
	assert.equal(ansiVisibleWidth("a\u0301"), 1);
	assert.equal(ansiVisibleWidth("👩‍💻"), 2);

	const width = 214;
	const lines = renderAgentsWidget([state({
		instances: [{
			index: 1,
			status: "done",
			task: `${"✅©️™️1️⃣#️⃣*️⃣👩‍💻a\u0301".repeat(40)} finished safely`,
			lastWork: `${"✅©️™️1️⃣#️⃣*️⃣👩‍💻a\u0301".repeat(40)} final line`,
			contextPct: 10,
			elapsed: 1000,
			runCount: 1,
			sessionFile: null,
		}],
	})], width, ansiTheme);

	for (const line of lines) assert.ok(ansiVisibleWidth(line) <= width, `line width ${ansiVisibleWidth(line)} > ${width}: ${line}`);
});

test("fitLine and truncation do not split promoted emoji graphemes", () => {
	const samples = ["✅", "©️", "™️", "1️⃣", "#️⃣", "*️⃣", "👩‍💻", "a\u0301"];
	for (const sample of samples) {
		for (const width of [1, 2, 3, 4, 5, 10]) {
			const fitted = fitLine(`${sample}${sample}${sample}`, width);
			assert.ok(ansiVisibleWidth(fitted) <= width, `${sample} fitted to ${width} => ${ansiVisibleWidth(fitted)}`);
		}
	}

	assert.equal(truncateAnsiToWidth("©️x", 1), "");
	assert.equal(truncateAnsiToWidth("™️x", 1), "");
	assert.equal(truncateAnsiToWidth("1️⃣x", 1), "");
	assert.equal(truncateAnsiToWidth("#️⃣x", 1), "");
	assert.equal(truncateAnsiToWidth("*️⃣x", 1), "");
	assert.equal(truncateAnsiToWidth("a\u0301x", 1), "a\u0301");
	assert.equal(ansiVisibleWidth(truncateAnsiToWidth("©️™️1️⃣#️⃣*️⃣", 10)), 10);
});

test("color map remains unique for more than fourteen specialists", () => {
	const names = Array.from({ length: 30 }, (_, index) => `agent-${index}`);
	const colors = Array.from(buildSpecialistColorMap(names).values()).map(rgb => rgb.join(";"));
	assert.equal(new Set(colors).size, names.length);
	assert.deepEqual(buildSpecialistColorMap(names), buildSpecialistColorMap([...names].reverse()));
});

test("ansi truncation preserves visible width", () => {
	const value = "\x1b[31mabcdef\x1b[0m";
	const out = truncateAnsiToWidth(value, 3);
	assert.equal(ansiVisibleWidth(out), 3);
	assert.match(out, /\x1b\[31mabc/);
});
