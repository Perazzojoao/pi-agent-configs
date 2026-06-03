import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createPiStub() {
	const handlers = new Map<string, Function>();
	let widgetFactory: any;
	let status = "";
	let notification = "";
	let footerFactory: any;
	const activeTools: string[] = [];
	return {
		pi: {
			registerTool() {},
			on(name: string, handler: Function) { handlers.set(name, handler); },
			getActiveTools() { return activeTools; },
			getAllTools() { return []; },
			setActiveTools(next: string[]) { activeTools.splice(0, activeTools.length, ...next); },
			getThinkingLevel() { return ""; },
		},
		async startSession(cwd: string) {
			const handler = handlers.get("session_start");
			assert.ok(handler, "session_start hook should be registered");
			await handler({}, {
				cwd,
				model: { provider: "runtime", id: "model" },
				getContextUsage: () => ({ tokens: 0, percent: 0 }),
				ui: {
					setWidget(_name: string, next: any) { widgetFactory = next; },
					setStatus(_name: string, next: string) { status = next; },
					setFooter(_name: string, next: any) { footerFactory = next; },
					notify(next: string) { notification = next; },
				},
			});
		},
		renderWidget(width = 120): string[] {
			assert.equal(typeof widgetFactory, "function", "widget should be installed");
			return widgetFactory({}, {}).render(width);
		},
		getStatus() { return status; },
		getNotification() { return notification; },
	};
}

async function loadExtension() {
	const mod = await import("../src/extension");
	return mod.default as (pi: any) => void;
}

function writeAgentProject(cwd: string, agentsYaml: string) {
	mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "agents", "scout.md"), `---\nname: scout\ndescription: Scout files\ntools: read\n---\nScout system prompt.\n`);
	writeFileSync(join(cwd, ".pi", "agents", "agents.yaml"), agentsYaml);
}

test("runtime.sessions_dir cleans only the configured safe .pi directory before instances are created", async () => {
	const extension = await loadExtension();
	const cwd = mkdtempSync(join(tmpdir(), "pi-agents-runtime-config-"));
	try {
		writeAgentProject(cwd, `runtime:\n  max_parallel_agents: 4\n  sessions_dir: .pi/custom-sessions\nagents:\n  - scout:\n    instances: 2\n`);
		mkdirSync(join(cwd, ".pi", "custom-sessions"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "custom-sessions", "scout-1.json"), "{}");

		const stub = createPiStub();
		extension(stub.pi);
		await stub.startSession(cwd);

		assert.equal(existsSync(join(cwd, ".pi", "custom-sessions", "scout-1.json")), false, "configured session JSON should be cleaned");
		assert.match(stub.getStatus(), /Running: 0\/4/);
		assert.match(stub.getNotification(), /Specialists: Scout/);

		const widgetText = stub.renderWidget().join("\n");
		assert.doesNotMatch(widgetText, /#1/, "deleted session file must not leave a stale visible instance");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("absolute runtime.sessions_dir is ignored and cannot delete JSON outside cwd .pi", async () => {
	const extension = await loadExtension();
	const cwd = mkdtempSync(join(tmpdir(), "pi-agents-unsafe-session-"));
	const outside = mkdtempSync(join(tmpdir(), "pi-agents-outside-session-"));
	try {
		writeAgentProject(cwd, `runtime:\n  sessions_dir: ${outside}\nagents:\n  - scout\n`);
		writeFileSync(join(outside, "scout-1.json"), "{}");
		mkdirSync(join(cwd, ".pi", "agent-sessions"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "agent-sessions", "scout-1.json"), "{}");

		const stub = createPiStub();
		extension(stub.pi);
		await stub.startSession(cwd);

		assert.equal(existsSync(join(outside, "scout-1.json")), true, "unsafe absolute sessions_dir must not be cleaned");
		assert.equal(existsSync(join(cwd, ".pi", "agent-sessions", "scout-1.json")), false, "fallback safe session dir is cleaned");
		assert.match(stub.getNotification(), /Ignoring unsafe runtime\.sessions_dir/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("escaping relative runtime.sessions_dir is ignored and falls back to cwd .pi", async () => {
	const extension = await loadExtension();
	const cwd = mkdtempSync(join(tmpdir(), "pi-agents-escaping-session-"));
	const outside = join(cwd, "..", "outside-sessions");
	try {
		writeAgentProject(cwd, `runtime:\n  sessions_dir: ../outside-sessions\nagents:\n  - scout\n`);
		mkdirSync(outside, { recursive: true });
		writeFileSync(join(outside, "scout-1.json"), "{}");
		mkdirSync(join(cwd, ".pi", "agent-sessions"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "agent-sessions", "scout-1.json"), "{}");

		const stub = createPiStub();
		extension(stub.pi);
		await stub.startSession(cwd);

		assert.equal(existsSync(join(outside, "scout-1.json")), true, "escaping relative sessions_dir must not be cleaned");
		assert.equal(existsSync(join(cwd, ".pi", "agent-sessions", "scout-1.json")), false, "fallback safe session dir is cleaned");
		assert.match(stub.getNotification(), /Ignoring unsafe runtime\.sessions_dir/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

test("runtime.sessions_dir equal to .pi is ignored without deleting project .pi JSON files", async () => {
	const extension = await loadExtension();
	const cwd = mkdtempSync(join(tmpdir(), "pi-agents-pi-session-"));
	try {
		writeAgentProject(cwd, `runtime:\n  sessions_dir: .pi\nagents:\n  - scout\n`);
		writeFileSync(join(cwd, ".pi", "keep-root.json"), "{}");
		mkdirSync(join(cwd, ".pi", "agent-sessions"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "agent-sessions", "scout-1.json"), "{}");

		const stub = createPiStub();
		extension(stub.pi);
		await stub.startSession(cwd);

		assert.equal(existsSync(join(cwd, ".pi", "keep-root.json")), true, "project .pi JSON must not be deleted");
		assert.equal(existsSync(join(cwd, ".pi", "agent-sessions", "scout-1.json")), false, "fallback safe session dir is cleaned");
		assert.match(stub.getNotification(), /Ignoring unsafe runtime\.sessions_dir/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
