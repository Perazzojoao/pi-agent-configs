import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function createPiStub() {
	const handlers = new Map<string, Function>();
	let dispatchTool: any;
	const activeTools: string[] = [];
	return {
		pi: {
			registerTool(tool: any) { if (tool?.name === "dispatch_agent") dispatchTool = tool; },
			on(name: string, handler: Function) { handlers.set(name, handler); },
			getActiveTools() { return activeTools; },
			getAllTools() { return []; },
			setActiveTools(next: string[]) { activeTools.splice(0, activeTools.length, ...next); },
			getThinkingLevel() { return ""; },
		},
		getDispatchTool() {
			assert.ok(dispatchTool, "dispatch_agent tool should be registered");
			return dispatchTool;
		},
		async startSession(cwd: string) {
			const handler = handlers.get("session_start");
			assert.ok(handler, "session_start hook should be registered");
			await handler({}, {
				cwd,
				model: { provider: "runtime", id: "model" },
				getContextUsage: () => ({ tokens: 0, percent: 0 }),
				ui: {
					setWidget() {},
					setFooter() {},
					setStatus() {},
					notify() {},
				},
			});
		},
	};
}

async function loadExtension() {
	const mod = await import("../src/extension");
	return mod.default as (pi: any) => void;
}

function writeAgentProject(cwd: string, agentsYaml = "agents:\n  - scout\n") {
	mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "agents", "scout.md"), `---\nname: scout\ndescription: Scout files\ntools: read\n---\nScout system prompt.\n`);
	writeFileSync(join(cwd, ".pi", "agents", "agents.yaml"), agentsYaml);
}

function renderLines(renderable: any, width = 80): string[] {
	assert.equal(typeof renderable?.render, "function");
	return renderable.render(width);
}

test("dispatch_agent renderCall and renderResult cover partial, compact, expanded, fallback, and truncation branches", async () => {
	const extension = await loadExtension();
	const stub = createPiStub();
	extension(stub.pi);
	const tool = stub.getDispatchTool();
	const theme = {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => `**${text}**`,
	};

	assert.match(renderLines(tool.renderCall({ agent: "scout", task: "inspect\nall\tfiles", mode: "write" }, theme), 50).join("\n"), /dispatch_agent.*scout write/);
	assert.deepEqual(renderLines(tool.renderCall({ agent: "scout", task: "x" }, theme), 0), [""]);

	assert.match(renderLines(tool.renderResult({ content: [{ type: "text", text: `${"x\n".repeat(45)}` }] }, {}, theme), 80).join("\n"), /\.\.\. \[truncated\]/);
	assert.match(renderLines(tool.renderResult({ content: [], details: { agent: "scout", status: "dispatching" } }, { isPartial: true }, theme), 80).join("\n"), /working/);
	assert.match(renderLines(tool.renderResult({ content: [], details: { agent: "scout", status: "done", elapsed: 2400, fullOutput: "ok" } }, {}, theme), 80).join("\n"), /✓ scout 2s/);
	assert.match(renderLines(tool.renderResult({ content: [], details: { agent: "scout", status: "error", elapsed: 1000, fullOutput: `${"line\n".repeat(90)}` } }, { expanded: true }, theme), 80).join("\n"), /✗ scout 1s[\s\S]*\.\.\. \[truncated\]/);
});

test("dispatch_agent rejects unknown agents, undeclared writes, and unsafe paths before spawning", async () => {
	const extension = await loadExtension();
	const cwd = mkdtempSync(join(tmpdir(), "pi-agents-dispatch-reject-"));
	try {
		writeAgentProject(cwd);
		execFileSync("git", ["init"], { cwd, stdio: "ignore" });
		const stub = createPiStub();
		extension(stub.pi);
		await stub.startSession(cwd);
		const tool = stub.getDispatchTool();
		const ctx = { cwd, ui: { notify() {} }, model: { provider: "runtime", id: "model" } };

		const missing: any = await tool.execute("call", { agent: "missing", task: "x" }, undefined, undefined, ctx);
		assert.match(missing.content[0].text, /Agent "missing" not found/);
		assert.equal(missing.details.status, "error");

		const undeclaredWrite: any = await tool.execute("call", { agent: "scout", task: "x", mode: "write" }, undefined, undefined, ctx);
		assert.match(undeclaredWrite.content[0].text, /requires declaring files and\/or worktree resources/);

		const unsafePath: any = await tool.execute("call", { agent: "scout", task: "x", files: ["../outside"] }, undefined, undefined, ctx);
		assert.match(unsafePath.content[0].text, /path escapes checkout/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("agent discovery honors project config precedence and reports missing configured specialists", async () => {
	const extension = await loadExtension();
	const cwd = mkdtempSync(join(tmpdir(), "pi-agents-config-precedence-"));
	try {
		writeAgentProject(cwd, "agents:\n  - missing\n");
		const stub = createPiStub();
		extension(stub.pi);
		await stub.startSession(cwd);
		const tool = stub.getDispatchTool();
		const ctx = { cwd, ui: { notify() {} }, model: { provider: "runtime", id: "model" } };

		const result: any = await tool.execute("call", { agent: "scout", task: "x" }, undefined, undefined, ctx);
		assert.match(result.content[0].text, /Agent "scout" not found/);
		assert.match(result.content[0].text, /Available:\s*$/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
