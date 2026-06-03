import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

type ToolResult = { content: Array<{ type: "text"; text: string }>; details: { tasks: Task[]; error?: string } };
type Task = { id: number; text: string; status: "idle" | "inprogress" | "done" };

const STUB_MODULES: Record<string, string> = {
	"@mariozechner/pi-ai": `
export const StringEnum = (values) => ({ enum: values });
`,
	"@mariozechner/pi-coding-agent": `
export class DynamicBorder {
	constructor(borderFn) { this.borderFn = borderFn; }
	render() { return []; }
	invalidate() {}
}
`,
	"@mariozechner/pi-tui": `
export class Container {
	constructor() { this.children = []; }
	addChild(child) { this.children.push(child); }
	render() { return []; }
	invalidate() {}
}
export class Text {
	constructor(text = '', x = 0, y = 0) { this.text = text; this.x = x; this.y = y; }
	setText(text) { this.text = text; }
	render() { return [this.text]; }
	invalidate() {}
}
export const matchesKey = () => false;
export const truncateToWidth = (text, width) => String(text).slice(0, Math.max(0, width));
`,
	"@sinclair/typebox": `
export const Type = {
	String: (options) => ({ type: 'string', ...options }),
	Number: (options) => ({ type: 'number', ...options }),
	Array: (items, options) => ({ type: 'array', items, ...options }),
	Object: (properties, options) => ({ type: 'object', properties, ...options }),
	Optional: (schema) => ({ ...schema, optional: true }),
};
`,
};

function createCtx(branch: unknown[] = []) {
	return {
		hasUI: false,
		sessionManager: { getBranch: () => branch },
		ui: {
			setWidget() {},
			setStatus() {},
			notify() {},
			confirm: async () => true,
			select: async () => "Yes",
			custom: async () => undefined,
		},
	};
}

function createPiStub() {
	let tilldoneTool: any;
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => any }>();

	return {
		pi: {
			registerTool(tool: any) {
				if (tool?.name === "tilldone") tilldoneTool = tool;
			},
			on(name: string, handler: (event: any, ctx: any) => any) {
				const current = handlers.get(name) ?? [];
				current.push(handler);
				handlers.set(name, current);
			},
			registerCommand(name: string, command: { handler: (args: string, ctx: any) => any }) {
				commands.set(name, command);
			},
			registerShortcut() {},
			sendMessage() {},
		},
		getTool() {
			assert.ok(tilldoneTool, "tilldone tool should be registered");
			return tilldoneTool;
		},
		getHandler(name: string) {
			const handler = handlers.get(name)?.[0];
			assert.ok(handler, `${name} handler should be registered`);
			return handler;
		},
		getCommand(name: string) {
			const command = commands.get(name);
			assert.ok(command, `${name} command should be registered`);
			return command;
		},
	};
}

async function loadTilldone() {
	const tempDir = mkdtempSync(join(tmpdir(), "tilldone-ordering-test-"));
	try {
		let source = readFileSync(resolve(__dirname, "../../tilldone.ts"), "utf-8");

		for (const [specifier, stubSource] of Object.entries(STUB_MODULES)) {
			const stubPath = join(tempDir, `${specifier.replaceAll(/[^a-z0-9]/gi, "-")}.mjs`);
			writeFileSync(stubPath, stubSource, "utf-8");
			source = source.replaceAll(`'${specifier}'`, `'${pathToFileURL(stubPath).href}'`);
		}

		const tilldonePath = join(tempDir, "tilldone.ts");
		writeFileSync(tilldonePath, source, "utf-8");
		const mod = await import(pathToFileURL(tilldonePath).href);
		return mod.default as (pi: any) => void;
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

async function execute(tool: any, params: Record<string, unknown>, ctx = createCtx()): Promise<ToolResult> {
	return tool.execute("call-id", params, new AbortController().signal, undefined, ctx);
}

function statuses(result: ToolResult) {
	return result.details.tasks.map(t => [t.id, t.status]);
}

async function setupTilldoneWithTasks(texts = ["first", "second"]) {
	const tilldone = await loadTilldone();
	const stub = createPiStub();
	tilldone(stub.pi);
	const tool = stub.getTool();
	const ctx = createCtx();

	await execute(tool, { action: "add", texts }, ctx);
	return { stub, tool, ctx };
}

test("tilldone blocks starting later idle task before earlier tasks are no longer idle", async () => {
	const { tool, ctx } = await setupTilldoneWithTasks();
	const result = await execute(tool, { action: "toggle", id: 2 }, ctx);

	assert.match(result.content[0].text, /Cannot start task #2 before earlier task #1 is no longer idle/);
	assert.match(result.content[0].text, /remove\/update\/clear\/new-list/);
	assert.deepEqual(statuses(result), [[1, "idle"], [2, "idle"]]);
});

test("tilldone allows ordered progression from first inprogress and done to second inprogress", async () => {
	const { tool, ctx } = await setupTilldoneWithTasks();
	let result = await execute(tool, { action: "toggle", id: 1 }, ctx);
	assert.deepEqual(statuses(result), [[1, "inprogress"], [2, "idle"]]);
	result = await execute(tool, { action: "toggle", id: 1 }, ctx);
	assert.deepEqual(statuses(result), [[1, "done"], [2, "idle"]]);
	result = await execute(tool, { action: "toggle", id: 2 }, ctx);
	assert.deepEqual(statuses(result), [[1, "done"], [2, "inprogress"]]);
});

test("tilldone blocks starting a later task while an earlier task is already in progress", async () => {
	const { tool, ctx } = await setupTilldoneWithTasks();

	await execute(tool, { action: "toggle", id: 1 }, ctx);
	const result = await execute(tool, { action: "toggle", id: 2 }, ctx);

	assert.match(result.content[0].text, /Cannot start task #2 while earlier task #1 is in progress/);
	assert.match(result.content[0].text, /Mark the earlier task done first/);
	assert.match(result.content[0].text, /remove\/update\/clear\/new-list/);
	assert.deepEqual(statuses(result), [[1, "inprogress"], [2, "idle"]]);
});

test("tilldone blocks done to idle regression when a later task is in progress", async () => {
	const { tool, ctx } = await setupTilldoneWithTasks();

	await execute(tool, { action: "toggle", id: 1 }, ctx);
	await execute(tool, { action: "toggle", id: 1 }, ctx);
	await execute(tool, { action: "toggle", id: 2 }, ctx);
	const result = await execute(tool, { action: "toggle", id: 1 }, ctx);

	assert.match(result.content[0].text, /Cannot move task #1 back to idle while later task #2 is in progress/);
	assert.match(result.content[0].text, /remove\/update\/clear\/new-list/);
	assert.deepEqual(statuses(result), [[1, "done"], [2, "inprogress"]]);
});

test("tilldone strict mode blocks tool calls when reconstructed state violates ordering", async () => {
	const tilldone = await loadTilldone();
	const stub = createPiStub();
	tilldone(stub.pi);
	const ctx = createCtx([
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: "tilldone",
				details: {
					action: "toggle",
					tasks: [
						{ id: 1, text: "first", status: "idle" },
						{ id: 2, text: "second", status: "inprogress" },
					],
					nextId: 3,
				},
			},
		},
	]);

	await stub.getHandler("session_start")({}, ctx);
	await stub.getCommand("tilldone").handler("", ctx);
	const result = await stub.getHandler("tool_call")({ toolName: "read" }, ctx);

	assert.equal(result.block, true);
	assert.match(result.reason, /strict mode ordering violation/);
	assert.match(result.reason, /Cannot start task #2 before earlier task #1 is no longer idle/);
});

test("tilldone strict mode allows tool calls when reconstructed active task follows ordering", async () => {
	const tilldone = await loadTilldone();
	const stub = createPiStub();
	tilldone(stub.pi);
	const ctx = createCtx([
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: "tilldone",
				details: {
					action: "toggle",
					tasks: [
						{ id: 1, text: "first", status: "done" },
						{ id: 2, text: "second", status: "inprogress" },
					],
					nextId: 3,
				},
			},
		},
	]);

	await stub.getHandler("session_start")({}, ctx);
	await stub.getCommand("tilldone").handler("", ctx);
	const result = await stub.getHandler("tool_call")({ toolName: "read" }, ctx);

	assert.deepEqual(result, { block: false });
});
