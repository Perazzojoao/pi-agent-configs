import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AgentConfig } from "./types";

const SAFE_MODEL_FALLBACK = "openai-codex/gpt-5.5";

type RuntimeModel = string | { provider?: unknown; id?: unknown; model?: unknown } | undefined | null;

function modelToString(model: RuntimeModel): string {
	if (!model) return "";
	if (typeof model === "string") return model.trim();
	if (typeof model.model === "string" && model.model.trim()) return model.model.trim();
	if (typeof model.provider === "string" && typeof model.id === "string" && model.provider.trim() && model.id.trim()) {
		return `${model.provider.trim()}/${model.id.trim()}`;
	}
	return "";
}

export function readDefaultModel(ctx: any): string {
	const settingsPath = join(ctx?.agentDir || join(homedir(), ".pi", "agent"), "settings.json");
	try {
		if (!existsSync(settingsPath)) return SAFE_MODEL_FALLBACK;
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		const provider = typeof settings?.defaultProvider === "string" ? settings.defaultProvider.trim() : "";
		const model = typeof settings?.defaultModel === "string" ? settings.defaultModel.trim() : "";
		return provider && model ? `${provider}/${model}` : SAFE_MODEL_FALLBACK;
	} catch {
		return SAFE_MODEL_FALLBACK;
	}
}

export function getRuntimeModel(ctx: any): string {
	return modelToString(ctx?.model);
}

export function getRuntimeFallbackModel(ctx: any): string {
	return modelToString(ctx?.fallback_model ?? ctx?.fallbackModel);
}

export function resolvePrimaryModel(config: Pick<AgentConfig, "model">, ctx: any): string {
	return config.model?.trim() || getRuntimeModel(ctx);
}

export function resolveFallbackModel(config: Pick<AgentConfig, "fallbackModel">, ctx: any): string {
	return config.fallbackModel?.trim() || getRuntimeFallbackModel(ctx) || readDefaultModel(ctx);
}

export function resolveDispatchModel(config: Pick<AgentConfig, "model" | "fallbackModel">, ctx: any): string {
	return resolvePrimaryModel(config, ctx) || resolveFallbackModel(config, ctx);
}

export function buildModelArgs(modelForAttempt: string): string[] {
	return ["--model", modelForAttempt.trim()];
}

export function isModelFallbackEligibleFailure(output: string): boolean {
	const text = output.toLowerCase();
	const explicitModelOrProviderSignals = [
		/model\s+(is\s+)?(unavailable|not\s+available|not\s+found|not\s+supported|unknown|invalid|overloaded)/,
		/(provider|upstream|llm|language\s+model)\s+(error|failure|failed|unavailable|not\s+available|down|overloaded|temporarily\s+unavailable)/,
		/(api|llm|model|provider).{0,80}(rate\s*limit|too\s+many\s+requests|\b429\b|quota|insufficient_quota)/,
		/(rate\s*limit|too\s+many\s+requests|\b429\b|quota|insufficient_quota).{0,80}(api|llm|model|provider)/,
		/(api|llm|model|provider).{0,80}(unauthorized|authentication|auth\s+failed|invalid\s+api\s+key|api\s+key|\b401\b|\b403\b)/,
		/(api|llm|model|provider).{0,80}(timeout|timed\s+out|etimedout|econnreset|econnrefused|enotfound|network\s+error|socket\s+hang\s+up)/,
		/(tool|test|command|process).{0,80}(timeout|timed\s+out)/,
		/(timeout|timed\s+out).{0,80}(tool|test|command|process)/,
	];
	return explicitModelOrProviderSignals.some(pattern => pattern.test(text));
}

export function getFallbackModelLabel(config: Pick<AgentConfig, "fallbackModel">, ctx: any): string {
	return resolveFallbackModel(config, ctx);
}
