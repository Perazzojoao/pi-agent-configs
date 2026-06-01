export type AgentRunStatus = "idle" | "running" | "done" | "error";

export interface AgentWidgetInstance {
	index: number;
	status: AgentRunStatus;
	task: string;
	lastWork: string;
	contextPct: number;
	elapsed: number;
	runCount: number;
	sessionFile: string | null;
	needsCompaction?: boolean;
}

export interface AgentWidgetState {
	name: string;
	description: string;
	model: string;
	maxCtx: number;
	instances: AgentWidgetInstance[];
}

export interface DispatcherWidgetState {
	model: string;
	contextTokens: number;
}

export interface WidgetTheme {
	fg?: (color: string, text: string) => string;
	bold?: (text: string) => string;
}

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const RESET = "\x1b[0m";

export function displayName(name: string): string {
	return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function stripAnsi(value: string): string {
	return value.replace(ANSI_RE, "");
}

const WIDE_RANGES: Array<[number, number]> = [
	[0x1100, 0x115f],
	[0x2329, 0x232a],
	[0x2600, 0x27bf], // Misc symbols + dingbats; includes ✅ (U+2705)
	[0x2b00, 0x2bff],
	[0x2e80, 0xa4cf],
	[0xac00, 0xd7a3],
	[0xf900, 0xfaff],
	[0xfe10, 0xfe19],
	[0xfe30, 0xfe6f],
	[0xff00, 0xff60],
	[0xffe0, 0xffe6],
	[0x1f000, 0x1faff],
	[0x1fc00, 0x1fffd],
];

function inRanges(cp: number, ranges: Array<[number, number]>): boolean {
	return ranges.some(([from, to]) => cp >= from && cp <= to);
}

function charWidth(ch: string): number {
	const cp = ch.codePointAt(0) || 0;
	if (cp === 0) return 0;
	if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
	if (
		cp === 0x200d || // Zero-width joiner.
		(cp >= 0x200b && cp <= 0x200f) || // Zero-width spaces/direction marks.
		(cp >= 0x202a && cp <= 0x202e) ||
		(cp >= 0x2060 && cp <= 0x206f) ||
		(cp >= 0xfe00 && cp <= 0xfe0f) || // Emoji/text presentation selectors.
		(cp >= 0xe0100 && cp <= 0xe01ef) || // Variation selectors supplement.
		/\p{Mark}/u.test(ch)
	) return 0;
	if (inRanges(cp, WIDE_RANGES)) return 2;
	return 1;
}

const graphemeSegmenter = typeof (Intl as any).Segmenter === "function"
	? new (Intl as any).Segmenter(undefined, { granularity: "grapheme" })
	: null;

function graphemes(value: string): string[] {
	if (!value) return [];
	if (!graphemeSegmenter) return Array.from(value);
	return Array.from(graphemeSegmenter.segment(value), (segment: any) => segment.segment as string);
}

function clusterWidth(cluster: string): number {
	// Keycap clusters (0-9, #, *) are rendered as emoji-width even though the
	// enclosing keycap is a combining mark and VS16 is zero-width by itself.
	if (/^[0-9#*]\ufe0f?\u20e3$/u.test(cluster)) return 2;

	const chars = Array.from(cluster);
	// VS16 promotes text-default symbols like © and ™ to emoji presentation.
	// Counting the whole cluster as width 2 avoids under-padding terminal lines.
	if (chars.some(ch => ch.codePointAt(0) === 0xfe0f)) return 2;
	// ZWJ emoji sequences render as one emoji cell pair on terminals. Width 2 is
	// safe for common sequences; over-counting is safer than under-counting, but
	// this keeps truncation closer to what the TUI expects.
	if (chars.some(ch => ch.codePointAt(0) === 0x200d)) return 2;

	return chars.reduce((total, ch) => total + charWidth(ch), 0);
}

export function ansiVisibleWidth(value: string): number {
	let width = 0;
	for (const cluster of graphemes(stripAnsi(value))) width += clusterWidth(cluster);
	return width;
}

export function truncateAnsiToWidth(value: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	let out = "";
	let width = 0;
	let openAnsi = false;
	for (let i = 0; i < value.length;) {
		const ansi = value.slice(i).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
		if (ansi) {
			out += ansi[0];
			openAnsi = true;
			i += ansi[0].length;
			continue;
		}

		const nextAnsiIndex = value.indexOf("\x1b", i);
		const runEnd = nextAnsiIndex === -1 ? value.length : nextAnsiIndex;
		const run = value.slice(i, runEnd);
		let consumed = 0;
		for (const cluster of graphemes(run)) {
			const w = clusterWidth(cluster);
			if (width + w > maxWidth) {
				return openAnsi && out && !out.endsWith(RESET) ? out + RESET : out;
			}
			out += cluster;
			width += w;
			consumed += cluster.length;
		}
		if (consumed === 0) consumed = Array.from(value.slice(i))[0]?.length || 1;
		i += consumed;
	}
	return openAnsi && out && !out.endsWith(RESET) ? out + RESET : out;
}

export function fitLine(value: string, width: number): string {
	if (width <= 0) return "";
	const truncated = truncateAnsiToWidth(value, width);
	const pad = width - ansiVisibleWidth(truncated);
	return truncated + (pad > 0 ? " ".repeat(pad) : "");
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
	const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const h = hue / 60;
	const x = c * (1 - Math.abs((h % 2) - 1));
	const [r1, g1, b1] = h < 1 ? [c, x, 0]
		: h < 2 ? [x, c, 0]
			: h < 3 ? [0, c, x]
				: h < 4 ? [0, x, c]
					: h < 5 ? [x, 0, c]
						: [c, 0, x];
	const m = lightness - c / 2;
	return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

export function buildSpecialistColorMap(names: string[]): Map<string, [number, number, number]> {
	const uniqueNames = Array.from(new Set(names.map(name => name.toLowerCase()))).sort();
	const goldenAngle = 137.508;
	return new Map(uniqueNames.map((name, index) => [name, hslToRgb((index * goldenAngle + 23) % 360, 0.72, 0.68)]));
}

function colorRgb(rgb: [number, number, number], value: string): string {
	return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${value}${RESET}`;
}

function color256(code: number, value: string): string {
	return `\x1b[38;5;${code}m${value}${RESET}`;
}

function colorCyan(value: string): string {
	return `\x1b[36m${value}${RESET}`;
}

function themed(theme: WidgetTheme, color: string, value: string): string {
	try {
		return theme.fg ? theme.fg(color, value) : value;
	} catch {
		return value;
	}
}

function statusIcon(status: AgentRunStatus): string {
	if (status === "running") return "● running";
	if (status === "done") return "✓ done";
	if (status === "error") return "✗ error";
	return "○ idle";
}

function contextText(theme: WidgetTheme, pct: number, value: string): string {
	if (pct > 75) return themed(theme, "error", value);
	if (pct > 50) return color256(208, value);
	return themed(theme, "muted", value);
}


function tokensK(tokens: number): number {
	return Math.max(0, Math.round(tokens / 1000));
}

export function renderAgentsWidget(states: AgentWidgetState[], width: number, theme: WidgetTheme = {}, dispatcher?: DispatcherWidgetState): string[] {
	if (width <= 0) return [""];
	const lines: string[] = [];
	const dispatcherState = dispatcher ?? { model: "current Pi model", contextTokens: 0 };
	const dispatcherParts = [
		colorCyan("◆ Dispatcher:"),
		colorCyan(`🧠 ${tokensK(dispatcherState.contextTokens)}k`),
		colorCyan(dispatcherState.model),
	].filter(Boolean);
	lines.push(fitLine(dispatcherParts.join("  "), width));

	const colorMap = buildSpecialistColorMap(states.map(state => state.name));
	const instances = states.flatMap(state => state.instances
		.filter(instance => instance.status !== "idle" || instance.runCount > 0 || !!instance.sessionFile)
		.map(instance => ({ state, instance })));

	if (instances.length === 0) {
		lines.push(fitLine(`|  ${themed(theme, "dim", "No spawned specialists yet.")}`, width));
		return lines;
	}

	for (const { state, instance } of instances) {
		const color = colorMap.get(state.name.toLowerCase()) ?? hslToRgb(23, 0.72, 0.68);
		const name = displayName(state.name);
		const nameAndIndex = colorRgb(color, `◇ ${name} #${instance.index}:`);
		const status = themed(theme, instance.status === "error" ? "error" : instance.status === "done" ? "success" : instance.status === "running" ? "accent" : "dim", statusIcon(instance.status));
		const currentK = Math.max(0, Math.round(state.maxCtx * (instance.contextPct || 0) / 100));
		const ctx = contextText(theme, instance.contextPct || 0, `🧠 ${currentK}k`);
		const model = themed(theme, "muted", state.model);
		const elapsed = instance.status === "running" || instance.elapsed > 0 ? themed(theme, "dim", `${Math.round(instance.elapsed / 1000)}s`) : "";
		lines.push(fitLine(`|- ${nameAndIndex} ${status} • ${ctx} •  ${model}${elapsed ? `  ${elapsed}` : ""}`, width));

		const work = (instance.lastWork || instance.task || state.description || "").trim();
		if (work) lines.push(fitLine(`|    ↳ ${themed(theme, "muted", work)}`, width));
	}
	return lines.map(line => fitLine(line, width));
}
