const INPUT_TOKEN_KEYS = ["input", "input_tokens", "inputTokens"];
const CACHE_READ_TOKEN_KEYS = [
	"cache_read",
	"cacheRead",
	"cache_read_input_tokens",
	"cacheReadInputTokens",
];

function finiteNonNegativeNumber(value: unknown): number {
	const num = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
	return Number.isFinite(num) && num > 0 ? num : 0;
}

function maxTokenValue(usage: Record<string, unknown>, keys: string[]): number {
	return keys.reduce((max, key) => Math.max(max, finiteNonNegativeNumber(usage[key])), 0);
}

export function extractContextTokens(usage: unknown): number {
	if (!usage || typeof usage !== "object") return 0;
	const record = usage as Record<string, unknown>;
	return maxTokenValue(record, INPUT_TOKEN_KEYS) + maxTokenValue(record, CACHE_READ_TOKEN_KEYS);
}
