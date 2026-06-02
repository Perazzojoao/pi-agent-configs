import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, "../src/extension.ts"), "utf-8");

type Hook = (event: unknown, ctx: unknown) => Promise<{ systemPrompt: string }>;

function createPiStub() {
	let beforeAgentStart: Hook | undefined;
	let dispatchExecute: ((...args: any[]) => unknown) | undefined;
	const activeTools: string[] = [];
	return {
		pi: {
			registerTool(tool: any) {
				if (tool?.name === "dispatch_agent") dispatchExecute = tool.execute;
			},
			on(name: string, handler: Hook) {
				if (name === "before_agent_start") beforeAgentStart = handler;
			},
			getActiveTools() { return activeTools; },
			getAllTools() { return []; },
			setActiveTools(next: string[]) {
				activeTools.splice(0, activeTools.length, ...next);
			},
		},
		getBeforeAgentStart() {
			assert.ok(beforeAgentStart, "before_agent_start hook should be registered");
			return beforeAgentStart;
		},
		getDispatchExecute() {
			assert.ok(dispatchExecute, "dispatch_agent tool should be registered");
			return dispatchExecute;
		},
	};
}

function ensureTypeboxStub() {
	const packageDir = resolve(__dirname, "../node_modules/@sinclair/typebox");
	if (existsSync(join(packageDir, "index.js"))) return;
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(join(packageDir, "package.json"), JSON.stringify({ type: "module", main: "index.js" }), "utf-8");
	writeFileSync(join(packageDir, "index.js"), `
export const Type = {
	String: (options) => ({ type: "string", ...options }),
	Array: (items, options) => ({ type: "array", items, ...options }),
	Object: (properties, options) => ({ type: "object", properties, ...options }),
	Optional: (schema) => ({ ...schema, optional: true }),
	Union: (schemas, options) => ({ anyOf: schemas, ...options }),
	Literal: (value) => ({ const: value }),
};
`, "utf-8");
}

async function loadExtension() {
	ensureTypeboxStub();
	const mod = await import("../src/extension");
	return mod.default as (pi: any) => void;
}

test("dispatcher appends ctx.agentDir APPEND_SYSTEM.md content at the end of its system prompt", async () => {
	const extension = await loadExtension();

	const tempAgentDir = mkdtempSync(join(tmpdir(), "pi-agents-append-system-"));
	try {
		const appendSystem = "APPEND_SYSTEM_SENTINEL: dispatcher-only runtime test content";
		writeFileSync(join(tempAgentDir, "APPEND_SYSTEM.md"), appendSystem, "utf-8");

		const stub = createPiStub();
		extension(stub.pi);

		const result = await stub.getBeforeAgentStart()({}, { agentDir: tempAgentDir });

		assert.ok(result.systemPrompt.includes(appendSystem));
		assert.ok(result.systemPrompt.endsWith(appendSystem));
		assert.match(result.systemPrompt, /You are a dispatcher agent\./);
	} finally {
		rmSync(tempAgentDir, { recursive: true, force: true });
	}
});

test("dispatcher ignores missing ctx.agentDir APPEND_SYSTEM.md without adding cwd fallback content", async () => {
	const extension = await loadExtension();

	const tempAgentDir = mkdtempSync(join(tmpdir(), "pi-agents-missing-append-system-"));
	const tempCwd = mkdtempSync(join(tmpdir(), "pi-agents-cwd-append-system-"));
	const oldCwd = process.cwd();
	try {
		const unsafeCwdContent = "UNSAFE_CWD_APPEND_SYSTEM_SENTINEL";
		writeFileSync(join(tempCwd, "APPEND_SYSTEM.md"), unsafeCwdContent, "utf-8");
		process.chdir(tempCwd);

		const stub = createPiStub();
		extension(stub.pi);

		const result = await stub.getBeforeAgentStart()({}, { agentDir: tempAgentDir });

		assert.doesNotMatch(result.systemPrompt, new RegExp(unsafeCwdContent));
		assert.match(result.systemPrompt, /You are a dispatcher agent\./);
	} finally {
		process.chdir(oldCwd);
		rmSync(tempAgentDir, { recursive: true, force: true });
		rmSync(tempCwd, { recursive: true, force: true });
	}
});

test("specialist dispatch does not receive dispatcher APPEND_SYSTEM.md content", async () => {
	const extension = await loadExtension();

	const tempAgentDir = mkdtempSync(join(tmpdir(), "pi-agents-specialist-append-system-"));
	try {
		const appendSystem = "APPEND_SYSTEM_SENTINEL_NOT_FOR_SPECIALIST";
		writeFileSync(join(tempAgentDir, "APPEND_SYSTEM.md"), appendSystem, "utf-8");

		const stub = createPiStub();
		extension(stub.pi);
		await stub.getBeforeAgentStart()({}, { agentDir: tempAgentDir });

		const result: any = await stub.getDispatchExecute()("tool-call", { agent: "missing", task: "test" }, undefined, undefined, {
			cwd: tempAgentDir,
			ui: { notify() {} },
		});

		assert.doesNotMatch(result.content[0].text, new RegExp(appendSystem));
	} finally {
		rmSync(tempAgentDir, { recursive: true, force: true });
	}
});

test("dispatcher append-system loading is limited to controlled paths", () => {
	assert.match(source, /ctx\?\.agentDir \? join\(ctx\.agentDir, "APPEND_SYSTEM\.md"\) : ""/);
	assert.match(source, /join\(extensionDir, "\.\.", "\.\.", "\.\.", "APPEND_SYSTEM\.md"\)/);
	assert.match(source, /catch \{\s*\/\/ Ignore unreadable\/missing append files so the extension can still start\.\s*\}/);
	assert.doesNotMatch(source, /process\.cwd\(\).*APPEND_SYSTEM\.md/s);
});

test("specialist append-system prompt uses only the specialist definition", () => {
	assert.match(source, /"--append-system-prompt", agentState\.def\.systemPrompt/);
	assert.doesNotMatch(source, /"--append-system-prompt",[^\n]*dispatcherAppendSystem/);
	assert.doesNotMatch(source, /"--append-system-prompt",[^\n]*dispatcherAppendSection/);
});
