import { requestUrl } from "obsidian";
import { HttpError, postStream, httpErrorMessage } from "./http";
import type { ResponsesProvider } from "./providers";
import { continueBody, MAX_ROUNDS, parseArguments, rejectsTools, toolParams, type CallOutput } from "./responses-tools";
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

	buildBody(req: AiRequest, withVaultTools = true): Record<string, unknown> {
		const p = this.provider;
		const { system, turns } = splitSystem(req.system, req.messages);
		const model = req.model.trim();
		const target = p.presets && !model.includes("/") ? { preset: model } : { model };
		const tools = toolParams(withVaultTools ? req.tools?.definitions : undefined, !!req.webSearch);
		return {
			...target,
			...(system ? { instructions: system } : {}),
			input: turns.map((m) => ({ role: m.role, content: m.content })),
			max_output_tokens: req.maxTokens,
			stream: true,
			...(p.reasoning ? { reasoning: p.reasoning } : {}),
			...(tools.length ? { tools } : {}),
		};
	}

	async stream(req: AiRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
		const key = this.key();
		let withVault = !!req.tools;
		let body = this.buildBody(req, withVault);
		let round = 0;
		while (round < MAX_ROUNDS) {
			const parser = new SseParser();
			const reducer = new ResponsesStreamReducer();
			try {
				await postStream(
					this.provider.url,
					{ authorization: `Bearer ${key}`, accept: "text/event-stream" },
					body,
					(chunk) => {
						for (const ev of parser.feed(chunk)) {
							const delta = reducer.push(ev);
							if (delta) handlers.onDelta(delta);
							for (const line of reducer.takeToolLines()) handlers.onTool?.(line);
						}
					},
					signal,
					this.provider.label,
				);
			} catch (e) {
				// A provider or model that does not take function tools answers plainly instead.
				if (round === 0 && withVault && e instanceof HttpError && rejectsTools(e.status, e.message)) {
					withVault = false;
					body = this.buildBody(req, false);
					continue;
				}
				throw e;
			}
			if (reducer.failure) throw new Error(reducer.failure);
			if (reducer.truncated || !reducer.calls.length || !req.tools) {
				return { text: reducer.text, truncated: reducer.truncated };
			}
			if (!reducer.responseId) {
				throw new Error(`${this.provider.label} asked for a tool but sent no response id to continue from.`);
			}
			const outputs: CallOutput[] = [];
			for (const call of reducer.calls) {
				if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
				const input = parseArguments(call.arguments);
				handlers.onTool?.(req.tools.describe(call.name, input));
				let output: string;
				try {
					output = await req.tools.run(call.name, input);
				} catch (e) {
					output = `Error: ${e instanceof Error ? e.message : String(e)}`;
				}
				outputs.push({ call, output });
			}
			handlers.onReset?.();
			round++;
			body = continueBody(this.buildBody(req, withVault), reducer.responseId, outputs, {
				outputName: this.provider.outputName,
				lastRound: round === MAX_ROUNDS - 1,
			});
		}
		throw new Error("The model kept using tools without answering. Try asking again.");
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
