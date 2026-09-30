import type { ChatMessage } from "../platform/types";
import type { ToolDef } from "../vault-rules";

export type { ToolDef };

/** The read-only vault tools a model may call, with the code that runs them. */
export type ToolSet = {
	definitions: ToolDef[];
	/** The short progress line for a call, e.g. "Reading replay.md". */
	describe(name: string, input: unknown): string;
	/** Runs one call. Failures that the model can act on come back as text; a throw is sent as an error result. */
	run(name: string, input: unknown): Promise<string>;
};

export type AiRequest = {
	system?: string;
	messages: ChatMessage[];
	model: string;
	maxTokens: number;
	/** Vault tools for API transports. */
	tools?: ToolSet;
	/** Let the model search the web: the service's own tool, or the CLI's. */
	webSearch?: boolean;
	/** Absolute path of the vault, when CLIs may read it. */
	vaultDir?: string;
	/** Absolute paths of excluded folders, for CLIs. */
	excludeDirs?: string[];
};
export type StreamHandlers = {
	onDelta(text: string): void;
	/** Short progress line, e.g. "Reading replay.md". */
	onTool?(detail: string): void;
	/** Text streamed so far came from a turn that went on to use tools; drop it. */
	onReset?(): void;
};
export type StreamResult = { text: string; truncated: boolean };

export interface Transport {
	/** Rejects with an Error whose message is fit to show the user. */
	stream(req: AiRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<StreamResult>;
	/** Resolves with a short status sentence, or rejects with a readable Error. */
	test(): Promise<string>;
}
