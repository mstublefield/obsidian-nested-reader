export type SseEvent = { event?: string; data: string };

/**
 * Incremental Server-Sent-Events parser. Network chunks split anywhere, so
 * partial lines are held back until their terminator arrives.
 */
export class SseParser {
	private buf = "";
	private event: string | undefined;
	private data: string[] = [];

	feed(chunk: string): SseEvent[] {
		this.buf += chunk;
		const out: SseEvent[] = [];
		// A trailing "\r" may be the first half of "\r\n"; wait for the next chunk.
		const held = this.buf.endsWith("\r") ? "\r" : "";
		const lines = (held ? this.buf.slice(0, -1) : this.buf).split(/\r\n|\n|\r/);
		this.buf = (lines.pop() ?? "") + held;
		for (const line of lines) {
			if (line === "") {
				if (this.data.length) out.push({ event: this.event, data: this.data.join("\n") });
				this.event = undefined;
				this.data = [];
			} else if (line.startsWith(":")) {
				continue; // comment / keep-alive
			} else {
				const i = line.indexOf(":");
				const field = i < 0 ? line : line.slice(0, i);
				let value = i < 0 ? "" : line.slice(i + 1);
				if (value.startsWith(" ")) value = value.slice(1);
				if (field === "event") this.event = value;
				else if (field === "data") this.data.push(value);
			}
		}
		return out;
	}
}

/** Folds Anthropic Messages streaming events into text, stop reason and error. */
export class AnthropicStreamReducer {
	text = "";
	stopReason: string | null = null;
	error: string | null = null;

	/** Returns the text delta carried by this event, if any. */
	push(ev: SseEvent): string | undefined {
		let data: unknown;
		try {
			data = JSON.parse(ev.data);
		} catch {
			return undefined;
		}
		if (!data || typeof data !== "object") return undefined;
		const d = data as {
			type?: string;
			delta?: { type?: string; text?: string; stop_reason?: string | null };
			error?: { message?: string };
		};
		const type = ev.event ?? d.type;
		if (type === "content_block_delta" && d.delta?.type === "text_delta" && typeof d.delta.text === "string") {
			this.text += d.delta.text;
			return d.delta.text;
		}
		if (type === "message_delta" && typeof d.delta?.stop_reason === "string") {
			this.stopReason = d.delta.stop_reason;
		} else if (type === "error") {
			this.error = d.error?.message ?? "The request failed.";
		}
		// thinking/signature/input_json deltas, ping and block/message markers are ignored.
		return undefined;
	}

	get truncated(): boolean {
		return this.stopReason === "max_tokens";
	}
}
