// Pure pieces of the Responses-API tool loop. Must not import "obsidian".
import type { FunctionCall } from "./responses-stream";
import type { ToolDef } from "./transport";

type Json = Record<string, unknown>;

export const MAX_ROUNDS = 8;

/** Whether an error from a provider says it refused the request because of its tools. */
export function rejectsTools(status: number, message: string): boolean {
	return status === 400 && /tool|function/i.test(message);
}

/**
 * The `tools` array: the vault tools as function tools, plus the provider's own web search.
 * OpenAI, xAI and Perplexity all name their server-side search `web_search`.
 */
export function toolParams(tools: ToolDef[] | undefined, webSearch: boolean): Json[] {
	const out: Json[] = (tools ?? []).map((t) => ({
		type: "function",
		name: t.name,
		description: t.description,
		parameters: t.schema,
	}));
	if (webSearch) out.push({ type: "web_search" });
	return out;
}

export function parseArguments(raw: string): unknown {
	if (!raw.trim()) return {};
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return {};
	}
}

export type CallOutput = { call: FunctionCall; output: string };

/**
 * The request for the next round. Every provider documents `previous_response_id` (OpenAI, xAI,
 * Perplexity), so the server keeps the earlier turns and this sends only the function results.
 * The model, instructions and tools are sent again: they are not carried over. Perplexity's
 * schema also takes the function's `name` on the output item.
 */
export function continueBody(
	base: Json,
	responseId: string,
	outputs: CallOutput[],
	opts: { outputName?: boolean; lastRound?: boolean } = {},
): Json {
	const hasTools = Array.isArray(base.tools) && base.tools.length > 0;
	return {
		...base,
		previous_response_id: responseId,
		input: outputs.map((o) => ({
			type: "function_call_output",
			call_id: o.call.callId,
			...(opts.outputName ? { name: o.call.name } : {}),
			output: o.output,
		})),
		// On the last round the answer must come, not another tool call.
		...(opts.lastRound && hasTools ? { tool_choice: "none" } : {}),
	};
}
