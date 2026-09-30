import type { ChatMessage } from "../platform/types";

export type AiRequest = {
	system?: string;
	messages: ChatMessage[];
	model: string;
	maxTokens: number;
};
export type StreamHandlers = {
	onDelta(text: string): void;
	/** Short progress line, e.g. "Reading replay.md" (CLI only). */
	onTool?(detail: string): void;
};
export type StreamResult = { text: string; truncated: boolean };

export interface Transport {
	/** Rejects with an Error whose message is fit to show the user. */
	stream(req: AiRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<StreamResult>;
	/** Resolves with a short status sentence, or rejects with a readable Error. */
	test(): Promise<string>;
}
