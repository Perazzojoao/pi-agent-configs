import test from "node:test";
import assert from "node:assert/strict";

import { extractContextTokens } from "../src/usage";

test("extractContextTokens returns input tokens plus cache-read tokens", () => {
	assert.equal(extractContextTokens({ input: 1200, cache_read: 300 }), 1500);
	assert.equal(extractContextTokens({ input: 1200, cacheRead: 300 }), 1500);
	assert.equal(extractContextTokens({ input: 1200, cache_read_input_tokens: 300 }), 1500);
	assert.equal(extractContextTokens({ input: 1200, cacheReadInputTokens: 300 }), 1500);
});

test("extractContextTokens avoids double-counting cache-read aliases", () => {
	assert.equal(extractContextTokens({
		input: 1000,
		cache_read: 200,
		cacheRead: 200,
		cache_read_input_tokens: 200,
		cacheReadInputTokens: 200,
	}), 1200);

	assert.equal(extractContextTokens({
		input: 1000,
		cache_read: 200,
		cacheReadInputTokens: 250,
	}), 1250);
});

test("extractContextTokens tolerates missing or non-numeric usage fields", () => {
	assert.equal(extractContextTokens(undefined), 0);
	assert.equal(extractContextTokens({ output: 500 }), 0);
	assert.equal(extractContextTokens({ input: "100", cacheRead: "25" }), 125);
	assert.equal(extractContextTokens({ input: -100, cacheRead: Number.NaN }), 0);
});
