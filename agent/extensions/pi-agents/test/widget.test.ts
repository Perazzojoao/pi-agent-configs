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

test("widget empty state renders only dispatcher and remains width safe", () => {
	for (const width of [0, 1, 2, 10, 30]) {
		const lines = renderAgentsWidget([state()], width, theme);
		assert.equal(lines.length, 1);
		assert.doesNotMatch(lines.map(stripAnsi).join("\n"), /No spawned specialists yet|\|/);
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
	assert.match(plain, /\|- ◇ Scout #1: .*🧠 75k.* •  .*openai\/example-model-with-a-very-long-name \(medium\) .*● running .*1s/);
	assert.match(plain, /\|    ↳ .*scan files/);
});

test("widget hides specialist thinking when off and colors status with elapsed", () => {
	const widgetState = state({
		name: "git-master",
		model: "github-copilot/gpt-5.3-codex",
		thinking: " Off ",
		maxCtx: 100,
		instances: [{ index: 1, status: "done", task: "", lastWork: "", contextPct: 8, elapsed: 25000, runCount: 1, sessionFile: null }],
	});
	const plain = renderAgentsWidget([widgetState], 220, {}).map(stripAnsi).join("\n");
	const themedLines = renderAgentsWidget([widgetState], 220, theme);

	assert.match(plain, /\|- ◇ Git Master #1: 🧠 8k •  github-copilot\/gpt-5\.3-codex ✓ done 25s/);
	assert.doesNotMatch(plain, /\(Off\)|\(off\)/);
	assert.match(themedLines[1], /<success>✓ done<\/success> <success>25s<\/success>/);
});

test("widget floors context thousands to avoid display jitter", () => {
	const lines = renderAgentsWidget([state({
		maxCtx: 100,
		instances: [{ index: 1, status: "running", task: "scan files", lastWork: "", contextPct: 19.99, elapsed: 1000, runCount: 1, sessionFile: null }],
	})], 220, {}, { model: "github-copilot/gpt-5-mini", contextTokens: 1999 });
	const plain = lines.map(stripAnsi).join("\n");

	assert.match(plain, /^◆ Dispatcher:  🧠 1k/);
	assert.match(plain, /🧠 19k/);
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
	assert.match(mk(51), /\x1b\[38;5;208m🧠 76k\x1b\[0m/);
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

test("fitLine keeps ANSI background over padding and resets after the line", () => {
	const value = "\x1b[48;5;236mtool call\x1b[0m";
	const out = fitLine(value, 14);
	assert.equal(ansiVisibleWidth(out), 14);
	assert.match(out, /^\x1b\[48;5;236mtool call {5}\x1b\[0m$/);

	const trueColor = fitLine("\x1b[48;2;1;2;3m✅x\x1b[0m", 6);
	assert.equal(ansiVisibleWidth(trueColor), 6);
	assert.match(trueColor, /^\x1b\[48;2;1;2;3m✅x {3}\x1b\[0m$/);
});

const piLikeTheme = {
	fg: (_color: string, text: string) => `\x1b[35m${text}\x1b[39m`,
};

test("fitLine closes active background when exact truncation leaves no padding", () => {
	const out = fitLine("\x1b[44mabcdef\x1b[0m", 3);
	assert.equal(ansiVisibleWidth(out), 3);
	assert.equal(out, "\x1b[44mabc\x1b[49m");

	const emoji = fitLine("\x1b[44m✅abcdef\x1b[0m", 3);
	assert.equal(ansiVisibleWidth(emoji), 3);
	assert.equal(emoji, "\x1b[44m✅a\x1b[49m");
});


test("fitLine does not insert hard reset before padding for Pi-like foreground inside external background", () => {
	const fitted = fitLine(piLikeTheme.fg("accent", "dispatch_agent scout"), 24);
	assert.equal(ansiVisibleWidth(fitted), 24);
	assert.doesNotMatch(fitted, /\x1b\[0m +$/);
	assert.match(fitted, /^\x1b\[35mdispatch_agent scout\x1b\[39m {4}$/);

	const hardResetForeground = fitLine("\x1b[35mdispatch_agent scout\x1b[0m", 24);
	assert.equal(ansiVisibleWidth(hardResetForeground), 24);
	assert.doesNotMatch(hardResetForeground, /\x1b\[0m +$/);
	assert.match(hardResetForeground, /^\x1b\[35mdispatch_agent scout\x1b\[39m {4}$/);

	const externallyPainted = `\x1b[48;5;236m${fitted}\x1b[49m`;
	assert.match(externallyPainted, /^\x1b\[48;5;236m\x1b\[35mdispatch_agent scout\x1b\[39m {4}\x1b\[49m$/);
});


test("padAnsiLine does not revive backgrounds explicitly reset with 49", () => {
	const out = fitLine("\x1b[48;5;236mbg\x1b[49m", 5);
	assert.equal(ansiVisibleWidth(out), 5);
	assert.equal(out, "\x1b[48;5;236mbg\x1b[49m   ");
});

test("fitLine remains width safe with background, truncation, and emoji graphemes", () => {
	for (const width of [1, 2, 3, 4, 5, 8]) {
		const out = fitLine("\x1b[44m✅✅abcdef\x1b[0m", width);
		assert.ok(ansiVisibleWidth(out) <= width, `line width ${ansiVisibleWidth(out)} > ${width}`);
		assert.equal(ansiVisibleWidth(out), width);
		if (width > 0 && / $/.test(stripAnsi(out))) assert.match(out, /^\x1b\[44m.* +\x1b\[0m$/u);
	}
});

test("fitLine does not treat extended foreground parameters as background", () => {
	const out = fitLine("\x1b[38;2;44;1;2mfg\x1b[0m plain", 12);
	assert.equal(ansiVisibleWidth(out), 12);
	assert.ok(out.endsWith("    "), JSON.stringify(out));
	assert.doesNotMatch(out, /\x1b\[0m +$/);
	assert.doesNotMatch(out, /\x1b\[44m +\x1b\[0m$/);
	assert.doesNotMatch(out, /\x1b\[48;2;44;1;2m +\x1b\[0m$/);

	const indexedForeground = fitLine("\x1b[38;5;100mfg\x1b[0m plain", 12);
	assert.equal(ansiVisibleWidth(indexedForeground), 12);
	assert.doesNotMatch(indexedForeground, /\x1b\[100m +\x1b\[0m$/);
});
