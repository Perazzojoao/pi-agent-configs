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

function charWidth(ch: string): number {
	const cp = ch.codePointAt(0) || 0;
	if (cp === 0) return 0;
	if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
	if (cp >= 0x300 && cp <= 0x36f) return 0;
	if (
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2329 && cp <= 0x232a) ||
		(cp >= 0x2e80 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe10 && cp <= 0xfe19) ||
		(cp >= 0xfe30 && cp <= 0xfe6f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1faff)
	) return 2;
	return 1;
}

export function ansiVisibleWidth(value: string): number {
	let width = 0;
	for (const ch of stripAnsi(value)) width += charWidth(ch);
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
		const ch = Array.from(value.slice(i))[0];
		const w = charWidth(ch);
		if (width + w > maxWidth) break;
		out += ch;
		width += w;
		i += ch.length;
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

export function renderAgentsWidget(states: AgentWidgetState[], width: number, theme: WidgetTheme = {}): string[] {
	if (width <= 0) return [""];
	const lines: string[] = [];
	const colorMap = buildSpecialistColorMap(states.map(state => state.name));
	const instances = states.flatMap(state => state.instances
		.filter(instance => instance.status !== "idle" || instance.runCount > 0 || !!instance.sessionFile)
		.map(instance => ({ state, instance })));

	if (instances.length === 0) {
		return [fitLine(themed(theme, "dim", "No spawned specialists yet."), width)];
	}

	for (const { state, instance } of instances) {
		const color = colorMap.get(state.name.toLowerCase()) ?? hslToRgb(23, 0.72, 0.68);
		const name = displayName(state.name);
		const nameAndIndex = colorRgb(color, `${name} #${instance.index}`);
		const status = themed(theme, instance.status === "error" ? "error" : instance.status === "done" ? "success" : instance.status === "running" ? "accent" : "dim", statusIcon(instance.status));
		const currentK = Math.max(0, Math.round(state.maxCtx * (instance.contextPct || 0) / 100));
		const ctx = contextText(theme, instance.contextPct || 0, `🧠 ${currentK}k`);
		const model = themed(theme, "muted", state.model);
		const elapsed = instance.status === "running" || instance.elapsed > 0 ? themed(theme, "dim", `${Math.round(instance.elapsed / 1000)}s`) : "";
		lines.push(fitLine([nameAndIndex, status, ctx, model, elapsed].filter(Boolean).join("  "), width));

		const work = (instance.lastWork || instance.task || state.description || "").trim();
		if (work) lines.push(fitLine(`  ${themed(theme, "muted", work)}`, width));
	}
	return lines.map(line => fitLine(line, width));
}
