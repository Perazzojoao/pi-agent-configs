import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildModelArgs, getFallbackModelLabel, getRuntimeFallbackModel, getRuntimeModel, isModelFallbackEligibleFailure, readDefaultModel, resolveDispatchModel, resolveFallbackModel, resolvePrimaryModel } from "../src/model";

test("runtime model helpers accept Pi model objects and string fallbacks", () => {
	assert.equal(getRuntimeModel({ model: { provider: "provider", id: "primary" } }), "provider/primary");
	assert.equal(getRuntimeModel({ model: { model: "provider/nested-primary" } }), "provider/nested-primary");
	assert.equal(getRuntimeModel({ model: "provider/string-primary" }), "provider/string-primary");
	assert.equal(getRuntimeFallbackModel({ fallback_model: { provider: "provider", id: "fallback" } }), "provider/fallback");
	assert.equal(getRuntimeFallbackModel({ fallbackModel: "provider/camel-fallback" }), "provider/camel-fallback");
	assert.equal(getRuntimeModel({ model: { provider: " ", id: "primary" } }), "");
	assert.equal(getRuntimeModel({ model: { provider: "provider", id: 42 } }), "");
});

test("primary model resolution preserves model before fallback models", () => {
	const ctx = { model: { provider: "runtime", id: "primary" }, fallback_model: "runtime/fallback" };

	assert.equal(resolvePrimaryModel({ model: "agent/primary" }, ctx), "agent/primary");
	assert.equal(resolvePrimaryModel({}, ctx), "runtime/primary");
	assert.equal(resolveDispatchModel({ model: "agent/primary", fallbackModel: "agent/fallback" }, ctx), "agent/primary");
	assert.equal(resolveDispatchModel({ fallbackModel: "agent/fallback" }, ctx), "runtime/primary");
});

test("fallback model resolution uses agent fallback, runtime fallback, then settings default", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-agents-model-"));
	try {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "settings", defaultModel: "default" }));

		assert.equal(resolveFallbackModel({ fallbackModel: "agent/fallback" }, { agentDir, fallback_model: "runtime/fallback" }), "agent/fallback");
		assert.equal(resolveFallbackModel({}, { agentDir, fallback_model: "runtime/fallback" }), "runtime/fallback");
		assert.equal(resolveFallbackModel({}, { agentDir }), "settings/default");
		assert.equal(resolveDispatchModel({ fallbackModel: "agent/fallback" }, { agentDir }), "agent/fallback");
		assert.equal(getFallbackModelLabel({}, { agentDir }), "settings/default");
		assert.equal(readDefaultModel({ agentDir }), "settings/default");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("buildModelArgs always passes only the current attempt model", () => {
	assert.deepEqual(buildModelArgs("agent/primary"), ["--model", "agent/primary"]);
	assert.deepEqual(buildModelArgs("agent/fallback"), ["--model", "agent/fallback"]);
	assert.deepEqual(buildModelArgs(" agent/spaced "), ["--model", "agent/spaced"]);
});

test("model fallback eligibility covers model/provider failures, rate limits, and quotas", () => {
	assert.equal(isModelFallbackEligibleFailure("Error: model unavailable"), true);
	assert.equal(isModelFallbackEligibleFailure("model unknown for provider"), true);
	assert.equal(isModelFallbackEligibleFailure("provider error: temporarily unavailable"), true);
	assert.equal(isModelFallbackEligibleFailure("upstream error overloaded"), true);
	assert.equal(isModelFallbackEligibleFailure("LLM API 429 rate limit exceeded"), true);
	assert.equal(isModelFallbackEligibleFailure("too many requests from model provider"), true);
	assert.equal(isModelFallbackEligibleFailure("quota exceeded for model gpt-example"), true);
	assert.equal(isModelFallbackEligibleFailure("insufficient_quota for API account"), true);
	assert.equal(isModelFallbackEligibleFailure("API authentication failed: invalid api key"), true);
});

test("model fallback eligibility retries tool/test/command timeouts without LLM/API context", () => {
	assert.equal(isModelFallbackEligibleFailure("tool failed: npm test timeout after 30s"), true);
	assert.equal(isModelFallbackEligibleFailure("command timed out while running grep"), true);
	assert.equal(isModelFallbackEligibleFailure("process timeout while executing test runner"), true);
});

test("model fallback eligibility rejects non-model application and filesystem failures", () => {
	assert.equal(isModelFallbackEligibleFailure("network timeout while contacting database"), false);
	assert.equal(isModelFallbackEligibleFailure("HTTP 401 from app under test"), false);
	assert.equal(isModelFallbackEligibleFailure("permission denied writing file"), false);
	assert.equal(isModelFallbackEligibleFailure("TypeScript assertion failed"), false);
	assert.equal(isModelFallbackEligibleFailure("npm test failed because assertion expected 1 got 2"), false);
});

test("readDefaultModel keeps a safe final fallback when settings cannot be read", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-agents-model-"));
	try {
		mkdirSync(join(agentDir, "settings.json"));
		assert.equal(readDefaultModel({ agentDir }), "openai-codex/gpt-5.5");
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
