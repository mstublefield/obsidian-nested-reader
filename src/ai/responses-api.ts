import { requestUrl } from "obsidian";
import { postStream, httpErrorMessage } from "./http";
import type { ResponsesProvider } from "./providers";
import { ResponsesStreamReducer } from "./responses-stream";
import { SseParser } from "./sse";
import { splitSystem } from "./transcript";
import type { AiRequest, StreamHandlers, StreamResult, Transport } from "./transport";

/** One transport for every provider that speaks the OpenAI Responses streaming format. */
export class ResponsesApiTransport implements Transport {
	constructor(private provider: ResponsesProvider, private getKey: () => string | null) {}

	private key(): string {
		const key = this.getKey();
		if (!key) throw new Error(`Add a ${this.provider.label} API key in settings.`);
		return key;
	}

	buildBody(req: AiRequest): Record<string, unknown> {
		const p = this.provider;
		const { system, turns } = splitSystem(req.system, req.messages);
		const model = req.model.trim();
		const target = p.presets && !model.includes("/") ? { preset: model } : { model };
		return {
			...target,
			...(system ? { instructions: system } : {}),
			input: turns.map((m) => ({ role: m.role, content: m.content })),
			max_output_tokens: req.maxTokens,
			stream: true,
			...(p.reasoning ? { reasoning: p.reasoning } : {}),
		};
	}

	async stream(req: AiRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
		const key = this.key();
		const parser = new SseParser();
		const reducer = new ResponsesStreamReducer();
		await postStream(
			this.provider.url,
			{ authorization: `Bearer ${key}`, accept: "text/event-stream" },
			this.buildBody(req),
			(chunk) => {
				for (const ev of parser.feed(chunk)) {
					const delta = reducer.push(ev);
					if (delta) handlers.onDelta(delta);
				}
			},
			signal,
			this.provider.label,
		);
		if (reducer.failure) throw new Error(reducer.failure);
		return { text: reducer.text, truncated: reducer.truncated };
	}

	async test(): Promise<string> {
		const key = this.key();
		const res = await requestUrl({
			url: this.provider.testUrl,
			method: "GET",
			headers: { authorization: `Bearer ${key}` },
			throw: false,
		});
		if (res.status === 200) return `Connected to the ${this.provider.label} API.`;
		throw new Error(httpErrorMessage(res.status, res.text, this.provider.label));
	}
}
