export const NOT_SIGNED_IN = "Not signed in to Claude Code. Run `claude` in a terminal and use /login.";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export type CliStep = { texts: string[]; tools: string[] };

/**
 * Reducer over the JSON lines of `claude -p --output-format stream-json`.
 * Port of upstream's Rust logic.
 */
export class CliStreamReducer {
	stopReason: string | null = null;
	failure: string | null = null;
	done = false;
	/** With partial messages on, text arrives as deltas AND again in the assistant message. */
	private streamed = false;

	push(line: unknown): CliStep {
		const step: CliStep = { texts: [], tools: [] };
		if (this.done || !isObj(line)) return step;

		if (line.type === "stream_event") {
			const delta = isObj(line.event) && isObj(line.event.delta) ? line.event.delta : null;
			if (delta?.type === "text_delta" && typeof delta.text === "string") {
				this.streamed = true;
				step.texts.push(delta.text);
			} else if (typeof delta?.stop_reason === "string") {
				this.stopReason = delta.stop_reason;
			}
		} else if (line.type === "assistant" && isObj(line.message)) {
			if (typeof line.message.stop_reason === "string") this.stopReason = line.message.stop_reason;
			const content = Array.isArray(line.message.content) ? line.message.content : [];
			for (const block of content) {
				if (!isObj(block)) continue;
				if (block.type === "text" && !this.streamed && typeof block.text === "string") {
					step.texts.push(block.text); // fallback for CLIs without partial messages
				} else if (block.type === "tool_use") {
					step.tools.push(toolDetail(block));
				}
			}
		} else if (line.type === "result") {
			if (line.is_error === true) {
				const msg = typeof line.result === "string" ? line.result : "Claude Code reported an error.";
				this.failure = msg.includes("Not logged in") ? NOT_SIGNED_IN : msg;
			}
			this.done = true;
		}
		return step;
	}

	get truncated(): boolean {
		return this.stopReason === "max_tokens";
	}
}

function toolDetail(block: Json): string {
	const name = typeof block.name === "string" ? block.name : "a tool";
	const input = isObj(block.input) ? block.input : {};
	const str = (k: string) => (typeof input[k] === "string" ? input[k] : undefined);
	if (name === "Read") {
		const p = str("file_path") ?? str("path");
		if (p) return `Reading ${p.split(/[\\/]/).pop()}`;
	}
	if (name === "Grep") {
		const pat = str("pattern");
		if (pat) return `Searching for “${[...pat].slice(0, 40).join("")}”`;
	}
	if (name === "WebSearch") return "Searching the web";
	if (name === "WebFetch") {
		const url = str("url");
		let host = "";
		try {
			host = url ? new URL(url).hostname : "";
		} catch {
			// not a URL
		}
		return host ? `Reading ${host}` : "Reading a web page";
	}
	if (name === "Glob" || name === "LS") return "Listing the pages";
	return `Using ${name}`;
}
