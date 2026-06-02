export type AgentRunStatus = 'idle' | 'running' | 'done' | 'error'

export interface AgentWidgetInstance {
	index: number
	status: AgentRunStatus
	task: string
	lastWork: string
	contextPct: number
	elapsed: number
	runCount: number
	sessionFile: string | null
	needsCompaction?: boolean
}

export interface AgentWidgetState {
	name: string
	description: string
	model: string
	thinking?: string
	maxCtx: number
	instances: AgentWidgetInstance[]
}

export interface DispatcherWidgetState {
	model: string
	thinking?: string
	contextTokens: number
}

export interface WidgetTheme {
	fg?: (color: string, text: string) => string
	bold?: (text: string) => string
}

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g
const SGR_RE = /\x1b\[([0-9;]*)m/g
const RESET = '\x1b[0m'

export function displayName(name: string): string {
	return name
		.split('-')
		.map(w => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ')
}

export function stripAnsi(value: string): string {
	return value.replace(ANSI_RE, '')
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
]

function inRanges(cp: number, ranges: Array<[number, number]>): boolean {
	return ranges.some(([from, to]) => cp >= from && cp <= to)
}

function charWidth(ch: string): number {
	const cp = ch.codePointAt(0) || 0
	if (cp === 0) return 0
	if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
	if (
		cp === 0x200d || // Zero-width joiner.
		(cp >= 0x200b && cp <= 0x200f) || // Zero-width spaces/direction marks.
		(cp >= 0x202a && cp <= 0x202e) ||
		(cp >= 0x2060 && cp <= 0x206f) ||
		(cp >= 0xfe00 && cp <= 0xfe0f) || // Emoji/text presentation selectors.
		(cp >= 0xe0100 && cp <= 0xe01ef) || // Variation selectors supplement.
		/\p{Mark}/u.test(ch)
	)
		return 0
	if (inRanges(cp, WIDE_RANGES)) return 2
	return 1
}

const graphemeSegmenter =
	typeof (Intl as any).Segmenter === 'function'
		? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
		: null

function graphemes(value: string): string[] {
	if (!value) return []
	if (!graphemeSegmenter) return Array.from(value)
	return Array.from(graphemeSegmenter.segment(value), (segment: any) => segment.segment as string)
}

function clusterWidth(cluster: string): number {
	// Keycap clusters (0-9, #, *) are rendered as emoji-width even though the
	// enclosing keycap is a combining mark and VS16 is zero-width by itself.
	if (/^[0-9#*]\ufe0f?\u20e3$/u.test(cluster)) return 2

	const chars = Array.from(cluster)
	// VS16 promotes text-default symbols like © and ™ to emoji presentation.
	// Counting the whole cluster as width 2 avoids under-padding terminal lines.
	if (chars.some(ch => ch.codePointAt(0) === 0xfe0f)) return 2
	// ZWJ emoji sequences render as one emoji cell pair on terminals. Width 2 is
	// safe for common sequences; over-counting is safer than under-counting, but
	// this keeps truncation closer to what the TUI expects.
	if (chars.some(ch => ch.codePointAt(0) === 0x200d)) return 2

	return chars.reduce((total, ch) => total + charWidth(ch), 0)
}

export function ansiVisibleWidth(value: string): number {
	let width = 0
	for (const cluster of graphemes(stripAnsi(value))) width += clusterWidth(cluster)
	return width
}

interface SgrState {
	fg: boolean
	bg: boolean
	intensity: boolean
	italic: boolean
	underline: boolean
	blink: boolean
	reverse: boolean
	conceal: boolean
	strike: boolean
}

function newSgrState(): SgrState {
	return {
		fg: false,
		bg: false,
		intensity: false,
		italic: false,
		underline: false,
		blink: false,
		reverse: false,
		conceal: false,
		strike: false,
	}
}

function sgrParams(sequence: string): number[] | null {
	const match = /^\x1b\[([0-9;]*)m$/.exec(sequence)
	if (!match) return null
	return match[1] ? match[1].split(';').map(part => (part === '' ? 0 : Number(part))) : [0]
}

function applySgrParams(state: SgrState, params: number[]): void {
	for (let i = 0; i < params.length; i++) {
		const code = Number.isFinite(params[i]) ? params[i] : 0
		if (code === 0) {
			Object.assign(state, newSgrState())
		} else if (code === 1 || code === 2) {
			state.intensity = true
		} else if (code === 3) {
			state.italic = true
		} else if (code === 4) {
			state.underline = true
		} else if (code === 5 || code === 6) {
			state.blink = true
		} else if (code === 7) {
			state.reverse = true
		} else if (code === 8) {
			state.conceal = true
		} else if (code === 9) {
			state.strike = true
		} else if (code === 22) {
			state.intensity = false
		} else if (code === 23) {
			state.italic = false
		} else if (code === 24) {
			state.underline = false
		} else if (code === 25) {
			state.blink = false
		} else if (code === 27) {
			state.reverse = false
		} else if (code === 28) {
			state.conceal = false
		} else if (code === 29) {
			state.strike = false
		} else if (code === 39) {
			state.fg = false
		} else if (code === 49) {
			state.bg = false
		} else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
			state.fg = true
		} else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
			state.bg = true
		} else if (code === 38 || code === 48) {
			const isBackground = code === 48
			const mode = params[i + 1]
			if (mode === 5 && Number.isFinite(params[i + 2])) {
				if (isBackground) state.bg = true
				else state.fg = true
				i += 2
			} else if (
				mode === 2 &&
				Number.isFinite(params[i + 2]) &&
				Number.isFinite(params[i + 3]) &&
				Number.isFinite(params[i + 4])
			) {
				if (isBackground) state.bg = true
				else state.fg = true
				i += 4
			} else if (mode === 5 || mode === 2) {
				i += 1
			}
		}
	}
}

function closeSgrState(state: SgrState, includeBackground: boolean): string {
	let out = ''
	if (state.fg) out += '\x1b[39m'
	if (includeBackground && state.bg) out += '\x1b[49m'
	if (state.intensity) out += '\x1b[22m'
	if (state.italic) out += '\x1b[23m'
	if (state.underline) out += '\x1b[24m'
	if (state.blink) out += '\x1b[25m'
	if (state.reverse) out += '\x1b[27m'
	if (state.conceal) out += '\x1b[28m'
	if (state.strike) out += '\x1b[29m'
	return out
}

function sgrState(value: string): SgrState {
	const state = newSgrState()
	for (const match of value.matchAll(ANSI_RE)) {
		const params = sgrParams(match[0])
		if (params) applySgrParams(state, params)
	}
	return state
}

function truncateAnsiToWidthInternal(
	value: string,
	maxWidth: number,
	closeBackground: boolean,
): { text: string; truncated: boolean } {
	if (maxWidth <= 0) return { text: '', truncated: value.length > 0 }
	let out = ''
	let width = 0
	const state = newSgrState()
	for (let i = 0; i < value.length; ) {
		const ansi = value.slice(i).match(/^\x1b\[[0-?]*[ -/]*[@-~]/)
		if (ansi) {
			out += ansi[0]
			const params = sgrParams(ansi[0])
			if (params) applySgrParams(state, params)
			i += ansi[0].length
			continue
		}

		const nextAnsiIndex = value.indexOf('\x1b', i)
		const runEnd = nextAnsiIndex === -1 ? value.length : nextAnsiIndex
		const run = value.slice(i, runEnd)
		let consumed = 0
		for (const cluster of graphemes(run)) {
			const w = clusterWidth(cluster)
			if (width + w > maxWidth) return { text: out + closeSgrState(state, closeBackground), truncated: true }
			out += cluster
			width += w
			consumed += cluster.length
		}
		if (consumed === 0) consumed = Array.from(value.slice(i))[0]?.length || 1
		i += consumed
	}
	return { text: out, truncated: false }
}

export function truncateAnsiToWidth(value: string, maxWidth: number): string {
	return truncateAnsiToWidthInternal(value, maxWidth, true).text
}

function backgroundState(value: string): { active: string | null; last: string | null } {
	let active: string | null = null
	let last: string | null = null
	SGR_RE.lastIndex = 0
	for (const match of value.matchAll(SGR_RE)) {
		const params = match[1] ? match[1].split(';').map(part => (part === '' ? 0 : Number(part))) : [0]
		for (let i = 0; i < params.length; i++) {
			const code = Number.isFinite(params[i]) ? params[i] : 0
			if (code === 0) {
				active = null
			} else if (code === 49) {
				active = null
			} else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
				active = `\x1b[${code}m`
				last = active
			} else if (code === 38 || code === 48) {
				const mode = params[i + 1]
				if (mode === 5 && Number.isFinite(params[i + 2])) {
					if (code === 48) {
						active = `\x1b[48;5;${params[i + 2]}m`
						last = active
					}
					i += 2
				} else if (
					mode === 2 &&
					Number.isFinite(params[i + 2]) &&
					Number.isFinite(params[i + 3]) &&
					Number.isFinite(params[i + 4])
				) {
					if (code === 48) {
						active = `\x1b[48;2;${params[i + 2]};${params[i + 3]};${params[i + 4]}m`
						last = active
					}
					i += 4
				} else if (mode === 5 || mode === 2) {
					i += 1
				}
			}
		}
	}
	return { active, last }
}

function padAnsiLine(value: string, pad: number): string {
	if (pad <= 0) return value
	const spaces = ' '.repeat(pad)
	if (!value.includes('\x1b[')) return value + spaces

	if (value.endsWith(RESET)) {
		const withoutFinalReset = value.slice(0, -RESET.length)
		const state = backgroundState(withoutFinalReset)
		if (state.active) return withoutFinalReset + spaces + RESET
		return withoutFinalReset + closeSgrState(sgrState(withoutFinalReset), false) + spaces
	}

	const state = backgroundState(value)
	return state.active ? value + state.active + spaces + RESET : value + spaces
}

export function fitLine(value: string, width: number): string {
	if (width <= 0) return ''
	const truncated = truncateAnsiToWidthInternal(value, width, false).text
	const pad = width - ansiVisibleWidth(truncated)
	if (pad <= 0) return truncateAnsiToWidthInternal(value, width, true).text
	return padAnsiLine(truncated, pad)
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
	const c = (1 - Math.abs(2 * lightness - 1)) * saturation
	const h = hue / 60
	const x = c * (1 - Math.abs((h % 2) - 1))
	const [r1, g1, b1] =
		h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
	const m = lightness - c / 2
	return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)]
}

export function buildSpecialistColorMap(names: string[]): Map<string, [number, number, number]> {
	const uniqueNames = Array.from(new Set(names.map(name => name.toLowerCase()))).sort()
	const goldenAngle = 137.508
	return new Map(uniqueNames.map((name, index) => [name, hslToRgb((index * goldenAngle + 23) % 360, 0.72, 0.68)]))
}

function colorRgb(rgb: [number, number, number], value: string): string {
	return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${value}${RESET}`
}

function color256(code: number, value: string): string {
	return `\x1b[38;5;${code}m${value}${RESET}`
}

function colorCyan(value: string): string {
	return `\x1b[36m${value}${RESET}`
}

function themed(theme: WidgetTheme, color: string, value: string): string {
	try {
		return theme.fg ? theme.fg(color, value) : value
	} catch {
		return value
	}
}

function statusIcon(status: AgentRunStatus): string {
	if (status === 'running') return '● running'
	if (status === 'done') return '✓ done'
	if (status === 'error') return '✗ error'
	return '○ idle'
}

function contextText(theme: WidgetTheme, pct: number, value: string): string {
	if (pct > 75) return themed(theme, 'error', value)
	if (pct > 50) return color256(208, value)
	return themed(theme, 'muted', value)
}

function thinkingText(value: string | undefined, options: { hideOff?: boolean } = {}): string {
	const clean = value?.trim()
	if (!clean || (options.hideOff && clean.toLowerCase() === 'off')) return ''
	return `(${clean})`
}

function tokensK(tokens: number): number {
	return Math.max(0, Math.floor(tokens / 1000))
}

export function renderAgentsWidget(
	states: AgentWidgetState[],
	width: number,
	theme: WidgetTheme = {},
	dispatcher?: DispatcherWidgetState,
): string[] {
	if (width <= 0) return ['']
	const lines: string[] = []
	const dispatcherState = dispatcher ?? { model: 'current Pi model', contextTokens: 0 }
	const dispatcherParts = [
		colorCyan('◆ Dispatcher:'),
		colorCyan(`🧠 ${tokensK(dispatcherState.contextTokens)}k`),
		colorCyan(dispatcherState.model),
		thinkingText(dispatcherState.thinking) ? colorCyan(thinkingText(dispatcherState.thinking)) : '',
	].filter(Boolean)
	lines.push(fitLine(dispatcherParts.join(' '), width))

	const colorMap = buildSpecialistColorMap(states.map(state => state.name))
	const instances = states.flatMap(state =>
		state.instances
			.filter(instance => instance.status !== 'idle' || instance.runCount > 0 || !!instance.sessionFile)
			.map(instance => ({ state, instance })),
	)

	if (instances.length === 0) return lines

	for (const { state, instance } of instances) {
		const color = colorMap.get(state.name.toLowerCase()) ?? hslToRgb(23, 0.72, 0.68)
		const name = displayName(state.name)
		const nameAndIndex = colorRgb(color, `◇ ${name} #${instance.index}:`)
		const statusColor =
			instance.status === 'error'
				? 'error'
				: instance.status === 'done'
					? 'success'
					: instance.status === 'running'
						? 'accent'
						: 'dim'
		const status = themed(theme, statusColor, statusIcon(instance.status))
		const currentK = Math.max(0, Math.floor((state.maxCtx * (instance.contextPct || 0)) / 100))
		const ctx = contextText(theme, instance.contextPct || 0, `🧠 ${currentK}k`)
		const model = themed(
			theme,
			'muted',
			[state.model, thinkingText(state.thinking, { hideOff: true })].filter(Boolean).join(' '),
		)
		const elapsed =
			instance.status === 'running' || instance.elapsed > 0
				? themed(theme, statusColor, `${Math.round(instance.elapsed / 1000)}s`)
				: ''
		lines.push(fitLine(`|- ${nameAndIndex} ${ctx} • ${model} ${status}${elapsed ? ` ${elapsed}` : ''}`, width))

		const work = (instance.lastWork || instance.task || state.description || '').trim()
		if (work) lines.push(fitLine(`|    ↳ ${themed(theme, 'muted', work)}`, width))
	}
	return lines.map(line => fitLine(line, width))
}
