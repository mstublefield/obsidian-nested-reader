import type { SseEvent } from "./sse";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Folds OpenAI-Responses-style streaming events (OpenAI, xAI, Perplexity Agent API)
 * into text, truncation and failure. Anything unrecognized is ignored.
 */
export class ResponsesStreamReducer {
	text = "";
	truncated = false;
	failure: string | null = null;
	done = false;

	/** Returns the text delta carried by this event, if any. */
	push(ev: SseEvent): string | undefined {
		if (this.done) return undefined;
		if (ev.data.trim() === "[DONE]") {
			this.done = true;
			return undefined;
		}
		let data: unknown;
		try {
			data = JSON.parse(ev.data);
		} catch {
			return undefined;
		}
		if (!isObj(data)) return undefined;
		const type = str(data.type) ?? ev.event;
		const response = isObj(data.response) ? data.response : undefined;

		if (type === "response.output_text.delta") {
			const delta = str(data.delta);
			if (delta) {
				this.text += delta;
				return delta;
			}
			return undefined;
		}
		if (type === "error") {
			const err = isObj(data.error) ? data.error : undefined;
			this.failure = str(err?.message) ?? str(data.message) ?? "The request failed";
			this.done = true;
			return undefined;
		}
		if (type === "response.failed") {
			const err = isObj(response?.error) ? response.error : undefined;
			this.failure = str(err?.message) ?? "The request failed";
			this.done = true;
			return undefined;
		}
		const details = isObj(response?.incomplete_details) ? response.incomplete_details : undefined;
		if (
			type === "response.incomplete" ||
			details?.reason === "max_output_tokens" ||
			response?.status === "incomplete"
		) {
			this.truncated = true;
			this.done = true;
			return undefined;
		}
		if (type === "response.completed") this.done = true;
		return undefined;
	}
}
