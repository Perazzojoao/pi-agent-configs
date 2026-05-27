import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type KeybindingsFile = Record<string, string | string[]>;

const TARGET_ACTION = "tui.input.newLine";
const REQUIRED_KEYS = ["ctrl+enter", "shift+enter", "ctrl+j"];

function normalizeKeys(value: string | string[] | undefined): string[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

function mergeNewLineKeys(config: KeybindingsFile): { changed: boolean; next: KeybindingsFile } {
	const rawCurrent = normalizeKeys(config[TARGET_ACTION]);
	const nextKeys: string[] = [];
	const seen = new Set<string>();

	for (const key of rawCurrent) {
		const normalized = key.toLowerCase();
		if (!seen.has(normalized)) {
			seen.add(normalized);
			nextKeys.push(normalized);
		}
	}

	for (const key of REQUIRED_KEYS) {
		if (!seen.has(key)) {
			seen.add(key);
			nextKeys.push(key);
		}
	}

	const isStoredAsArray = Array.isArray(config[TARGET_ACTION]);
	const hasSameSequence =
		rawCurrent.length === nextKeys.length &&
		rawCurrent.every((key, index) => key === nextKeys[index]);

	if (isStoredAsArray && hasSameSequence) {
		return { changed: false, next: config };
	}

	return {
		changed: true,
		next: {
			...config,
			[TARGET_ACTION]: nextKeys,
		},
	};
}

async function ensureKeybinding(ctx: ExtensionContext): Promise<void> {
	const keybindingsPath = path.join(os.homedir(), ".pi", "agent", "keybindings.json");
	const keybindingsDir = path.dirname(keybindingsPath);

	await fs.mkdir(keybindingsDir, { recursive: true });

	let parsed: KeybindingsFile = {};
	try {
		const raw = await fs.readFile(keybindingsPath, "utf8");
		if (raw.trim().length > 0) {
			const json = JSON.parse(raw) as unknown;
			if (json && typeof json === "object" && !Array.isArray(json)) {
				parsed = json as KeybindingsFile;
			}
		}
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code !== "ENOENT") {
			ctx.ui.notify(
				`Não foi possível ler keybindings.json (${err.message}).`,
				"warning",
			);
		}
	}

	const { changed, next } = mergeNewLineKeys(parsed);
	if (!changed) return;

	await fs.writeFile(keybindingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	ctx.ui.notify(
		"Hotkeys de nova linha (ctrl+enter, shift+enter e ctrl+j) configuradas. Use /reload para aplicar sem reiniciar.",
		"info",
	);
}

export default function newlineHotkeysExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		await ensureKeybinding(ctx);
	});
}
