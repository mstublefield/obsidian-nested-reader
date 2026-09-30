import { requestUrl } from "obsidian";
import { AnthropicStreamReducer, SseParser } from "./sse";
import { splitSystem } from "./transcript";
import type { AiRequest, StreamHandlers, StreamResult, Transport } from "./transport";

const BASE = "https://api.anthropic.com/v1";
const NO_KEY = "Add an Anthropic API key in settings.";
const REFUSED = "The API key was refused. Check it in settings.";

function headers(key: string): Record<string, string> {
	return {
		"x-api-key": key,
		"anthropic-version": "2023-06-01",
		"content-type": "application/json",
		// Required for calls from an Electron renderer, which Anthropic treats as a browser.
		"anthropic-dangerous-direct-browser-access": "true",
	};
}

export class AnthropicApiTransport implements Transport {
	constructor(private getKey: () => string | null) {}

	async stream(req: AiRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
		const key = this.getKey();
		if (!key) throw new Error(NO_KEY);
		const { system, turns } = splitSystem(req.system, req.messages);
		// Streaming needs fetch; requestUrl buffers the whole response.
		const res = await fetch(`${BASE}/messages`, {
			method: "POST",
			headers: headers(key),
			body: JSON.stringify({
				model: req.model,
				max_tokens: req.maxTokens,
				...(system ? { system } : {}),
				messages: turns.map((m) => ({ role: m.role, content: m.content })),
				stream: true,
			}),
			signal,
		});
		if (!res.ok) throw new Error(await failureMessage(res));
		if (!res.body) throw new Error("The response had no body.");

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		const parser = new SseParser();
		const reducer = new AnthropicStreamReducer();
		const handle = (chunk: string) => {
			for (const ev of parser.feed(chunk)) {
				const delta = reducer.push(ev);
				if (delta) handlers.onDelta(delta);
			}
		};
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			handle(decoder.decode(value, { stream: true }));
			if (reducer.error) break;
		}
		handle(decoder.decode());
		if (reducer.error) throw new Error(reducer.error);
		return { text: reducer.text, truncated: reducer.truncated };
	}

	async test(): Promise<string> {
		const key = this.getKey();
		if (!key) throw new Error(NO_KEY);
		const res = await requestUrl({ url: `${BASE}/models`, method: "GET", headers: headers(key), throw: false });
		if (res.status === 200) return "Connected to the Anthropic API.";
		if (res.status === 401) throw new Error(REFUSED);
		throw new Error(errorText(res.text) ?? `The API returned status ${res.status}.`);
	}
}

async function failureMessage(res: Response): Promise<string> {
	if (res.status === 401) return REFUSED;
	return errorText(await res.text().catch(() => "")) ?? `The API returned status ${res.status}.`;
}

function errorText(body: string): string | undefined {
	try {
		const msg = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
		return typeof msg === "string" ? msg : undefined;
	} catch {
		return undefined;
	}
}
