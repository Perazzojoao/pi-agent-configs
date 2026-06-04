declare const process: {
  cwd(): string;
  env: { HOME?: string } & Record<string, string | undefined>;
};

declare class Buffer {}

declare namespace NodeJS {
  interface ErrnoException extends Error {
    code?: string;
  }

  interface ProcessEnv extends Record<string, string | undefined> {}
}

declare module "node:fs" {
  export function mkdtempSync(prefix: string): string;
  export function readdirSync(path: string): string[];
  export function realpathSync(path: string): string;
  export function statSync(path: string): { isDirectory(): boolean };
}

declare module "node:os" {
  export function homedir(): string;
  export function tmpdir(): string;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}

declare module "@earendil-works/pi-tui" {
  export interface AutocompleteItem {
    value: string;
    label?: string;
    description?: string;
  }
}

declare module "@earendil-works/pi-coding-agent" {
  import type { Static, TSchema } from "typebox";
  import type { AutocompleteItem } from "@earendil-works/pi-tui";

  export type AgentToolResult<TDetails = unknown> = {
    content: Array<{ type: "text"; text: string }>;
    details: TDetails;
    terminate?: boolean;
  };

  export type AgentToolUpdateCallback<TDetails = unknown> = (
    partialResult: AgentToolResult<TDetails>,
  ) => void;

  export interface ToolDefinition<
    TParams extends TSchema = TSchema,
    TDetails = unknown,
  > {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: TParams;
    execute(
      toolCallId: string,
      params: Static<TParams>,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<TDetails>>;
  }

  export interface ExtensionAPI {
    registerTool<TParams extends TSchema = TSchema, TDetails = unknown>(
      tool: ToolDefinition<TParams, TDetails>,
    ): void;
    registerCommand(
      name: string,
      options: {
        description?: string;
        handler: (
          args: string,
          ctx: ExtensionCommandContext,
        ) => Promise<void> | void;
        getArgumentCompletions?: (
          argumentPrefix: string,
        ) => AutocompleteItem[] | null;
      },
    ): void;
    appendEntry(customType: string, data: unknown): void;
    on(
      channel: string,
      handler: (event: any, ctx: ExtensionContext) => unknown,
    ): void;
    events: {
      on(channel: string, handler: (data: unknown) => void): () => void;
      emit(channel: string, data: unknown): void;
    };
  }

  export interface ExtensionContext {
    hasUI: boolean;
    ui: {
      notify(message: string, level: "info" | "error" | "warning"): void;
      setStatus(key: string, value: string | undefined): void;
      theme: { fg(color: string, text: string): string };
    };
    sessionManager: {
      getBranch(): Array<{
        type?: string;
        customType?: string;
        data?: unknown;
      }>;
    };
  }

  export interface ExtensionCommandContext extends ExtensionContext {}

  export interface ExecOptions {
    onData: (data: Buffer) => void;
    signal?: AbortSignal;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
  }

  export function createLocalBashOperations(): {
    exec(command: string, cwd: string, options: ExecOptions): unknown;
  };
}
