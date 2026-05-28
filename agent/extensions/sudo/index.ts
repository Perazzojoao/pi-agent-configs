import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const SUDO_IN_BASH_RE =
	/(^|[\s;|&(){}[\]`$><])(?:command\s+|builtin\s+|env\s+)*\\?(?:\/usr\/bin\/|\/bin\/)?sudo(?=\s|$)/i;

const SudoExecParams = Type.Object({
	command: Type.String({ description: "Comando alvo a ser executado com sudo (sem o prefixo sudo)." }),
	timeout: Type.Optional(Type.Number({ description: "Timeout em segundos para a execução." })),
});

type DialogResult = { action: "confirm"; passwordBytes: Buffer } | { action: "cancel" };

function isPrintableInput(data: string): boolean {
	if (!data || data.length !== 1) return false;
	const code = data.charCodeAt(0);
	return code >= 32 && code !== 127;
}

function containsSudoInvocation(rawCommand: string): boolean {
	if (!rawCommand) return false;
	const normalized = rawCommand
		.replace(/\\\r?\n/g, " ") // line continuation
		.replace(/[\u0000-\u001f]+/g, " ") // control chars to spaces
		.trim();
	if (!normalized) return false;
	return SUDO_IN_BASH_RE.test(normalized);
}

function showPasswordDialog(command: string, ctx: any) {
	return ctx.ui.custom<DialogResult>((tui, theme, _kb, done) => {
		let password = "";
		let focus: 0 | 1 | 2 = 0; // 0=input, 1=confirm, 2=cancel
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;

		const clearPassword = () => {
			password = "";
		};

		const refresh = () => {
			cachedWidth = undefined;
			cachedLines = undefined;
			tui.requestRender();
		};

		const cycle = (direction: 1 | -1) => {
			const next = (focus + direction + 3) % 3;
			focus = next as 0 | 1 | 2;
			refresh();
		};

		const submitFocused = () => {
			if (focus === 2) {
				clearPassword();
				done({ action: "cancel" });
				return;
			}
			if (focus !== 1) {
				// Harden UX: Enter no input não confirma; usuário deve focar no botão.
				return;
			}
			if (!password) return;
			const passwordBytes = Buffer.from(password, "utf8");
			clearPassword(); // best-effort cleanup
			done({ action: "confirm", passwordBytes });
		};

		return {
			handleInput(data: string) {
				if (matchesKey(data, Key.escape)) {
					clearPassword();
					done({ action: "cancel" });
					return;
				}

				if (matchesKey(data, Key.tab)) {
					cycle(1);
					return;
				}

				if (matchesKey(data, Key.shift("tab"))) {
					cycle(-1);
					return;
				}

				if (matchesKey(data, Key.enter)) {
					submitFocused();
					return;
				}

				if (focus !== 0) return;

				if (matchesKey(data, Key.backspace)) {
					password = password.slice(0, -1);
					refresh();
					return;
				}

				if (isPrintableInput(data)) {
					password += data;
					refresh();
				}
			},

			render(width: number): string[] {
				if (cachedLines && cachedWidth === width) return cachedLines;

				const lines: string[] = [];
				const add = (line = "") => lines.push(truncateToWidth(line, width));
				const fullRule = theme.fg("accent", "─".repeat(Math.max(1, width)));

				add(fullRule);
				add(theme.fg("accent", theme.bold(" sudo_exec • autenticação requerida")));
				add(theme.fg("muted", " Comando alvo:"));

				for (const wrapped of wrapTextWithAnsi(`  ${command}`, Math.max(1, width))) {
					add(theme.fg("text", wrapped));
				}

				add();

				const masked = "*".repeat(password.length);
				const inputPrefix = focus === 0 ? theme.fg("accent", "> Senha sudo: ") : "  Senha sudo: ";
				add(`${inputPrefix}${masked}`);
				add();

				const confirmLabel = "[ Confirmar ]";
				const cancelLabel = "[ Cancelar ]";
				const confirmStyled =
					focus === 1
						? theme.bg("selectedBg", theme.fg("accent", confirmLabel))
						: theme.fg("text", confirmLabel);
				const cancelStyled =
					focus === 2
						? theme.bg("selectedBg", theme.fg("accent", cancelLabel))
						: theme.fg("text", cancelLabel);
				const inputHint = focus === 0 ? theme.fg("accent", "[input ativo]") : theme.fg("dim", "[input]");
				add(`  ${inputHint}   ${confirmStyled}   ${cancelStyled}`);

				add();
				add(theme.fg("dim", " Tab: próximo foco • Shift+Tab: foco anterior • Enter: acionar foco • Esc: cancelar"));
				add(theme.fg("dim", " Dica: para confirmar, mova foco para [ Confirmar ] e pressione Enter."));
				add(fullRule);

				cachedLines = lines;
				cachedWidth = width;
				return lines;
			},

			invalidate() {
				cachedLines = undefined;
				cachedWidth = undefined;
			},
		};
	});
}

async function executeWithSudo(command: string, passwordBytes: Buffer, timeoutSeconds?: number, signal?: AbortSignal) {
	return await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
		const child = spawn("sudo", ["-S", "-p", "", "sh", "-c", command], {
			stdio: ["pipe", "pipe", "pipe"],
			env: process.env,
		});

		let stdout = "";
		let stderr = "";
		let settled = false;
		let timeoutHandle: NodeJS.Timeout | undefined;

		const cleanupSecret = () => {
			passwordBytes.fill(0); // best-effort cleanup
		};

		const finalize = (result: { stdout: string; stderr: string; exitCode: number | null }) => {
			if (settled) return;
			settled = true;
			if (timeoutHandle) clearTimeout(timeoutHandle);
			cleanupSecret();
			resolve(result);
		};

		const fail = (err: Error) => {
			if (settled) return;
			settled = true;
			if (timeoutHandle) clearTimeout(timeoutHandle);
			cleanupSecret();
			reject(err);
		};

		const onAbort = () => {
			if (settled) return;
			child.kill("SIGTERM");
			fail(new Error("Execução sudo cancelada."));
		};

		signal?.addEventListener("abort", onAbort, { once: true });

		if (typeof timeoutSeconds === "number" && timeoutSeconds > 0) {
			timeoutHandle = setTimeout(() => {
				if (settled) return;
				child.kill("SIGTERM");
				fail(new Error(`Execução sudo excedeu timeout de ${timeoutSeconds}s.`));
			}, timeoutSeconds * 1000);
		}

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("error", (err) => {
			fail(err);
		});

		child.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort);
			finalize({ stdout, stderr, exitCode: code });
		});

		// Never log password; write only to stdin.
		child.stdin.write(Buffer.concat([passwordBytes, Buffer.from("\n")]));
		child.stdin.end();
	});
}

export default function sudoExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt:
				event.systemPrompt +
				"\n\nSecurity rule (sudo): NEVER use `sudo` in the `bash` tool (including wrappers like `command sudo`, `env sudo`, absolute paths, etc.). Always use the `sudo_exec` tool exclusively for any privileged action, passing the command without the `sudo` prefix.",
		};
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const command = String(event.input.command ?? "");
		if (!containsSudoInvocation(command)) return;

		return {
			block: true,
			reason:
				"Chamadas sudo via tool bash estão bloqueadas. Use a tool sudo_exec com o comando sem prefixo sudo.",
		};
	});

	pi.registerTool({
		name: "sudo_exec",
		label: "Sudo Exec",
		description:
			"Executa um comando com sudo via prompt seguro de senha no TUI (senha não exposta ao modelo). Use para qualquer operação que requeira privilégio administrativo.",
		parameters: SudoExecParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Erro: sudo_exec requer UI interativa para coleta segura de senha." }],
					details: { exitCode: 1, stdout: "", stderr: "UI indisponível" },
				};
			}

			const command = params.command.trim();
			if (!command) {
				return {
					content: [{ type: "text", text: "Erro: comando vazio para sudo_exec." }],
					details: { exitCode: 2, stdout: "", stderr: "comando vazio" },
				};
			}

			const decision = await showPasswordDialog(command, ctx);
			if (decision.action === "cancel") {
				return {
					content: [{ type: "text", text: "Execução sudo cancelada pelo usuário." }],
					details: { exitCode: 130, stdout: "", stderr: "cancelado" },
				};
			}

			try {
				const result = await executeWithSudo(command, decision.passwordBytes, params.timeout, signal);
				const combined = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
				return {
					content: [
						{
							type: "text",
							text: combined || `(sudo_exec finalizado; exitCode=${result.exitCode ?? -1})`,
						},
					],
					details: {
						exitCode: result.exitCode ?? -1,
						stdout: result.stdout,
						stderr: result.stderr,
					},
					isError: (result.exitCode ?? 1) !== 0,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : "Falha desconhecida em sudo_exec";
				return {
					content: [{ type: "text", text: `Erro ao executar sudo: ${message}` }],
					details: { exitCode: 1, stdout: "", stderr: message },
					isError: true,
				};
			}
		},
	});
}
