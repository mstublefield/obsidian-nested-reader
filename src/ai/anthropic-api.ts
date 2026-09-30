import { requestUrl } from "obsidian";
import { httpErrorMessage, postStream } from "./http";
import { AnthropicTurnReducer, MAX_ROUNDS, nextMessages, toolParams, type ToolResult } from "./anthropic-tools";
import { SseParser } from "./sse";
import { splitSystem } from "./transcript";
import type { AiRequest, StreamHandlers, StreamResult, Transport } from "./transport";

const BASE = "https://api.anthropic.com/v1";
const NO_KEY = "Add an Anthropic API key in settings.";
const LABEL = "Anthropic";

function headers(key: string): Record<string, string> {
	return {
		"x-api-key": key,
		"anthropic-version": "2023-06-01",
		"content-type": "application/json",
	};
}

export class AnthropicApiTransport implements Transport {
	constructor(private getKey: () => string | null) {}

	async stream(req: AiRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
		const key = this.getKey();
		if (!key) throw new Error(NO_KEY);
		const { system, turns } = splitSystem(req.system, req.messages);
		const tools = toolParams(req.tools?.definitions, !!req.webSearch);
		let messages: Record<string, unknown>[] = turns.map((m) => ({ role: m.role, content: m.content }));
		let carried = "";

		for (let round = 0; round < MAX_ROUNDS; round++) {
			const parser = new SseParser();
			const reducer = new AnthropicTurnReducer();
			await postStream(
				`${BASE}/messages`,
				headers(key),
				{
					model: req.model,
					max_tokens: req.maxTokens,
					...(system ? { system } : {}),
					messages,
					...(tools.length ? { tools } : {}),
					// On the last round the answer must come, not another tool call.
					...(tools.length && round === MAX_ROUNDS - 1 && round > 0 ? { tool_choice: { type: "none" } } : {}),
					stream: true,
				},
				(chunk) => {
					for (const ev of parser.feed(chunk)) {
						const delta = reducer.push(ev);
						if (delta) handlers.onDelta(delta);
						for (const line of reducer.takeToolLines()) handlers.onTool?.(line);
					}
				},
				signal,
				LABEL,
			);
			if (reducer.error) throw new Error(reducer.error);
			if (reducer.truncated) return { text: carried + reducer.text, truncated: true };

			const calls = reducer.toolCalls();
			if (reducer.stopReason === "tool_use" && calls.length && req.tools) {
				const results: ToolResult[] = [];
				for (const c of calls) {
					if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
					handlers.onTool?.(req.tools.describe(c.name, c.input));
					try {
						results.push({ id: c.id, text: await req.tools.run(c.name, c.input), isError: false });
					} catch (e) {
						results.push({ id: c.id, text: e instanceof Error ? e.message : String(e), isError: true });
					}
				}
				handlers.onReset?.();
				messages = nextMessages(messages, reducer.assistantContent(), results);
				continue;
			}
			if (reducer.stopReason === "pause_turn") {
				// A long search turn paused: send it back unchanged and the answer carries on from it.
				carried += reducer.text;
				messages = nextMessages(messages, reducer.assistantContent(), []);
				continue;
			}
			return { text: carried + reducer.text, truncated: false };
		}
		throw new Error("The model kept using tools without answering. Try asking again.");
	}

	async test(): Promise<string> {
		const key = this.getKey();
		if (!key) throw new Error(NO_KEY);
		const res = await requestUrl({ url: `${BASE}/models`, method: "GET", headers: headers(key), throw: false });
		if (res.status === 200) return "Connected to the Anthropic API.";
		throw new Error(httpErrorMessage(res.status, res.text, LABEL));
	}
}
