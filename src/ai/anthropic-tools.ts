// Pure pieces of the Anthropic tool loop. Must not import "obsidian".
import { AnthropicStreamReducer, type SseEvent } from "./sse";
import type { ToolDef } from "./transport";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** How many turns one answer may take before it must come, as upstream. */
export const MAX_ROUNDS = 8;

/**
 * Anthropic's server-side web search, basic version. The newer `web_search_20260209` and later
 * run search through code execution ("dynamic filtering") and need `allowed_callers` on models
 * that cannot do that; the basic tool works everywhere and needs no beta header.
 */
export const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 5 } as const;

export function toolParams(tools: ToolDef[] | undefined, webSearch: boolean): Json[] {
	const out: Json[] = (tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
	if (webSearch) out.push({ ...WEB_SEARCH_TOOL });
	return out;
}

export type ToolCall = { id: string; name: string; input: unknown };
export type ToolResult = { id: string; text: string; isError: boolean };

/**
 * Keeps every content block of one streamed assistant turn (text, tool_use with its input
 * assembled from json deltas, server_tool_use, web_search_tool_result, thinking with its
 * signature), because the whole turn has to go back with the tool results.
 */
export class AnthropicTurnReducer extends AnthropicStreamReducer {
	private blocks: (Json | undefined)[] = [];
	private json = new Map<number, string>();
	/** Progress lines raised since the last `takeToolLines`. */
	private lines: string[] = [];

	takeToolLines(): string[] {
		return this.lines.splice(0);
	}

	override push(ev: SseEvent): string | undefined {
		const delta = super.push(ev);
		let data: unknown;
		try {
			data = JSON.parse(ev.data);
		} catch {
			return delta;
		}
		if (!isObj(data)) return delta;
		const type = ev.event ?? data.type;
		const index = typeof data.index === "number" ? data.index : -1;

		if (type === "content_block_start" && index >= 0 && isObj(data.content_block)) {
			const block: Json = { ...data.content_block };
			if (block.type === "text") block.text = typeof block.text === "string" ? block.text : "";
			if (block.type === "tool_use" || block.type === "server_tool_use") {
				this.json.set(index, "");
				if (block.type === "server_tool_use") this.lines.push("Searching the web");
			}
			this.blocks[index] = block;
		} else if (type === "content_block_delta" && index >= 0 && isObj(data.delta)) {
			const block = this.blocks[index];
			const d = data.delta;
			if (!block) return delta;
			if (d.type === "text_delta" && typeof d.text === "string") {
				block.text = `${typeof block.text === "string" ? block.text : ""}${d.text}`;
			} else if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
				this.json.set(index, (this.json.get(index) ?? "") + d.partial_json);
			} else if (d.type === "thinking_delta" && typeof d.thinking === "string") {
				block.thinking = `${typeof block.thinking === "string" ? block.thinking : ""}${d.thinking}`;
			} else if (d.type === "signature_delta" && typeof d.signature === "string") {
				block.signature = d.signature;
			} else if (d.type === "citations_delta" && isObj(d.citation)) {
				const prior: unknown[] = Array.isArray(block.citations) ? (block.citations as unknown[]) : [];
				block.citations = [...prior, d.citation];
			}
		} else if (type === "content_block_stop" && index >= 0) {
			this.finishBlock(index);
		}
		return delta;
	}

	private finishBlock(index: number): void {
		const block = this.blocks[index];
		const raw = this.json.get(index);
		if (!block || raw === undefined) return;
		this.json.delete(index);
		let input: unknown = {};
		if (raw.trim()) {
			try {
				input = JSON.parse(raw);
			} catch {
				input = {};
			}
		}
		block.input = isObj(input) ? input : {};
	}

	/** The blocks to replay as the assistant message; an empty text block is refused by the API, so it is dropped. */
	assistantContent(): Json[] {
		for (const i of [...this.json.keys()]) this.finishBlock(i);
		const out: Json[] = [];
		for (const b of this.blocks) {
			if (!b) continue;
			if (b.type === "text" && !b.text) continue;
			const copy = { ...b };
			if (copy.type === "text" && (copy.citations === null || (Array.isArray(copy.citations) && !copy.citations.length))) {
				delete copy.citations;
			}
			out.push(copy);
		}
		return out;
	}

	/** Calls to the plugin's own tools. Server tools (web search) are run by Anthropic and are not here. */
	toolCalls(): ToolCall[] {
		return this.assistantContent()
			.filter((b) => b.type === "tool_use")
			.map((b) => ({
				id: typeof b.id === "string" ? b.id : "",
				name: typeof b.name === "string" ? b.name : "",
				input: b.input ?? {},
			}));
	}
}

/**
 * The messages for the next round: what was sent, the assistant turn as streamed, and a user
 * message of tool_result blocks. A `pause_turn` has no results, so the assistant turn goes back alone.
 */
export function nextMessages(messages: Json[], assistant: Json[], results: ToolResult[]): Json[] {
	const next: Json[] = [...messages, { role: "assistant", content: assistant }];
	if (results.length) {
		next.push({
			role: "user",
			content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.text, is_error: r.isError })),
		});
	}
	return next;
}
