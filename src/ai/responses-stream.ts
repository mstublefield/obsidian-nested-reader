import type { SseEvent } from "./sse";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Folds OpenAI-Responses-style streaming events (OpenAI, xAI, Perplexity Agent API)
 * into text, truncation and failure. Anything unrecognized is ignored.
 */
export type FunctionCall = { callId: string; name: string; arguments: string };

export class ResponsesStreamReducer {
	text = "";
	/** The response's id, which the next round names as `previous_response_id`. */
	responseId: string | null = null;
	/** Function calls the model made, in order. */
	calls: FunctionCall[] = [];
	private lines: string[] = [];

	/** Progress lines raised since the last call. */
	takeToolLines(): string[] {
		return this.lines.splice(0);
	}

	private addCall(item: Json): void {
		const callId = str(item.call_id) ?? str(item.id);
		const name = str(item.name);
		if (!callId || !name || this.calls.some((c) => c.callId === callId)) return;
		this.calls.push({ callId, name, arguments: str(item.arguments) ?? "{}" });
	}
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
		if (!this.responseId && str(response?.id)) this.responseId = str(response?.id) ?? null;
		const item = isObj(data.item) ? data.item : undefined;

		if (type === "response.output_item.added" && typeof item?.type === "string" && item.type.startsWith("web_search")) {
			this.lines.push("Searching the web");
		} else if (type === "response.output_item.done" && item?.type === "function_call") {
			this.addCall(item);
		}
		if (type === "response.completed" && Array.isArray(response?.output)) {
			for (const o of response.output) if (isObj(o) && o.type === "function_call") this.addCall(o);
		}

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
