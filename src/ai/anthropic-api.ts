import { requestUrl } from "obsidian";
import { httpErrorMessage, postStream } from "./http";
import { AnthropicStreamReducer, SseParser } from "./sse";
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
		const parser = new SseParser();
		const reducer = new AnthropicStreamReducer();
		await postStream(
			`${BASE}/messages`,
			headers(key),
			{
				model: req.model,
				max_tokens: req.maxTokens,
				...(system ? { system } : {}),
				messages: turns.map((m) => ({ role: m.role, content: m.content })),
				stream: true,
			},
			(chunk) => {
				for (const ev of parser.feed(chunk)) {
					const delta = reducer.push(ev);
					if (delta) handlers.onDelta(delta);
				}
			},
			signal,
			LABEL,
		);
		if (reducer.error) throw new Error(reducer.error);
		return { text: reducer.text, truncated: reducer.truncated };
	}

	async test(): Promise<string> {
		const key = this.getKey();
		if (!key) throw new Error(NO_KEY);
		const res = await requestUrl({ url: `${BASE}/models`, method: "GET", headers: headers(key), throw: false });
		if (res.status === 200) return "Connected to the Anthropic API.";
		throw new Error(httpErrorMessage(res.status, res.text, LABEL));
	}
}
