import { describe, expect, it } from "vitest";
import { AnthropicTurnReducer, nextMessages, toolParams as anthropicTools, WEB_SEARCH_TOOL } from "../src/ai/anthropic-tools";
import { claudeArgs, claudeToolNames, codexArgs, codexPrompt, readDenyRule, vaultNote } from "../src/ai/cli-args";
import { CliStreamReducer } from "../src/ai/cli-stream";
import { ResponsesStreamReducer } from "../src/ai/responses-stream";
import { continueBody, parseArguments, rejectsTools, toolParams as responsesTools } from "../src/ai/responses-tools";
import { SseParser } from "../src/ai/sse";
import type { AiRequest } from "../src/ai/transport";
import { VAULT_TOOLS } from "../src/vault-rules";

function sse(events: { event: string; data: unknown }[]): string {
	return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
}
function feedAnthropic(text: string) {
	const p = new SseParser();
	const r = new AnthropicTurnReducer();
	const deltas: string[] = [];
	for (const ev of p.feed(text)) {
		const d = r.push(ev);
		if (d) deltas.push(d);
	}
	return { r, deltas, lines: r.takeToolLines() };
}
const ev = (type: string, rest: Record<string, unknown>) => ({ event: type, data: { type, ...rest } });

describe("Anthropic tool turn", () => {
	const turn = sse([
		ev("message_start", { message: { id: "m" } }),
		ev("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } }),
		ev("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "hm" } }),
		ev("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig" } }),
		ev("content_block_stop", { index: 0 }),
		ev("content_block_start", { index: 1, content_block: { type: "text", text: "" } }),
		ev("content_block_stop", { index: 1 }),
		ev("content_block_start", { index: 2, content_block: { type: "text", text: "" } }),
		ev("content_block_delta", { index: 2, delta: { type: "text_delta", text: "Let me " } }),
		ev("content_block_delta", { index: 2, delta: { type: "text_delta", text: "look." } }),
		ev("content_block_stop", { index: 2 }),
		ev("content_block_start", { index: 3, content_block: { type: "tool_use", id: "toolu_1", name: "read_page", input: {} } }),
		ev("content_block_delta", { index: 3, delta: { type: "input_json_delta", partial_json: '{"path"' } }),
		ev("content_block_delta", { index: 3, delta: { type: "input_json_delta", partial_json: ': "notes/a.md"}' } }),
		ev("content_block_stop", { index: 3 }),
		ev("content_block_start", { index: 4, content_block: { type: "tool_use", id: "toolu_2", name: "list_pages", input: {} } }),
		ev("content_block_stop", { index: 4 }),
		ev("message_delta", { delta: { stop_reason: "tool_use" } }),
		ev("message_stop", {}),
	]);

	it("keeps every block, parses tool input, drops empty text", () => {
		const { r, deltas } = feedAnthropic(turn);
		expect(deltas.join("")).toBe("Let me look.");
		expect(r.stopReason).toBe("tool_use");
		const content = r.assistantContent();
		expect(content.map((b) => b.type)).toEqual(["thinking", "text", "tool_use", "tool_use"]);
		expect(content[0]).toMatchObject({ thinking: "hm", signature: "sig" });
		expect(content[1]).toMatchObject({ text: "Let me look." });
		expect(content[2]).toMatchObject({ id: "toolu_1", input: { path: "notes/a.md" } });
		expect(content[3]).toMatchObject({ id: "toolu_2", input: {} });
		expect(r.toolCalls()).toEqual([
			{ id: "toolu_1", name: "read_page", input: { path: "notes/a.md" } },
			{ id: "toolu_2", name: "list_pages", input: {} },
		]);
	});

	it("builds the next request from the turn and the results", () => {
		const { r } = feedAnthropic(turn);
		const prior = [{ role: "user", content: "hi" }];
		const next = nextMessages(prior, r.assistantContent(), [
			{ id: "toolu_1", text: "page text", isError: false },
			{ id: "toolu_2", text: "Error: nope", isError: true },
		]);
		expect(next).toHaveLength(3);
		expect(next[0]).toBe(prior[0]);
		expect(next[1]).toMatchObject({ role: "assistant" });
		expect(next[2]).toEqual({
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "toolu_1", content: "page text", is_error: false },
				{ type: "tool_result", tool_use_id: "toolu_2", content: "Error: nope", is_error: true },
			],
		});
		expect(prior).toHaveLength(1); // not mutated
	});

	it("sends a paused turn back alone", () => {
		expect(nextMessages([], [{ type: "text", text: "x" }], [])).toEqual([
			{ role: "assistant", content: [{ type: "text", text: "x" }] },
		]);
	});

	it("keeps server web search blocks unchanged and raises a progress line", () => {
		const result = {
			type: "web_search_tool_result",
			tool_use_id: "srvtoolu_1",
			content: [{ type: "web_search_result", url: "https://example.com", title: "T", encrypted_content: "ENC", page_age: null }],
		};
		const { r, lines } = feedAnthropic(
			sse([
				ev("content_block_start", { index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search" } }),
				ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"q"}' } }),
				ev("content_block_stop", { index: 0 }),
				ev("content_block_start", { index: 1, content_block: result }),
				ev("content_block_stop", { index: 1 }),
				ev("content_block_start", { index: 2, content_block: { type: "text", text: "", citations: null } }),
				ev("content_block_delta", { index: 2, delta: { type: "text_delta", text: "Answer" } }),
				ev("content_block_delta", { index: 2, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "u" } } }),
				ev("content_block_stop", { index: 2 }),
				ev("message_delta", { delta: { stop_reason: "end_turn" } }),
			]),
		);
		expect(lines).toEqual(["Searching the web"]);
		const content = r.assistantContent();
		expect(content[0]).toMatchObject({ type: "server_tool_use", input: { query: "q" } });
		expect(content[1]).toEqual(result);
		expect(content[2].citations).toEqual([{ type: "web_search_result_location", url: "u" }]);
		expect(r.toolCalls()).toEqual([]); // server tools are not ours to run
	});

	it("strips a null citations field from plain text blocks", () => {
		const { r } = feedAnthropic(
			sse([
				ev("content_block_start", { index: 0, content_block: { type: "text", text: "", citations: null } }),
				ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "hi" } }),
			]),
		);
		expect(r.assistantContent()[0]).toEqual({ type: "text", text: "hi" });
	});

	it("declares the tools", () => {
		const t = anthropicTools(VAULT_TOOLS, true);
		expect(t).toHaveLength(4);
		expect(t[1]).toMatchObject({ name: "read_page", input_schema: { required: ["path"] } });
		expect(t[3]).toEqual({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
		expect(WEB_SEARCH_TOOL.max_uses).toBe(5);
		expect(anthropicTools(undefined, false)).toEqual([]);
	});
});

describe("Responses tool round trip", () => {
	const events = sse([
		ev("response.created", { response: { id: "resp_1", status: "in_progress" } }),
		ev("response.output_item.added", { item: { type: "web_search_call", id: "ws_1" } }),
		ev("response.output_item.added", { item: { type: "function_call", call_id: "call_1", name: "search_pages", arguments: "" } }),
		ev("response.function_call_arguments.delta", { delta: '{"query":' }),
		ev("response.output_item.done", { item: { type: "function_call", call_id: "call_1", name: "search_pages", arguments: '{"query":"ripple"}' } }),
		ev("response.completed", {
			response: {
				id: "resp_1",
				output: [{ type: "function_call", call_id: "call_1", name: "search_pages", arguments: '{"query":"ripple"}' }],
			},
		}),
	]);

	it("collects the call once, the response id, and search progress", () => {
		const p = new SseParser();
		const r = new ResponsesStreamReducer();
		for (const e of p.feed(events)) r.push(e);
		expect(r.responseId).toBe("resp_1");
		expect(r.calls).toEqual([{ callId: "call_1", name: "search_pages", arguments: '{"query":"ripple"}' }]);
		expect(r.takeToolLines()).toEqual(["Searching the web"]);
	});

	it("takes calls from the completed response when no item-done event came", () => {
		const r = new ResponsesStreamReducer();
		const p = new SseParser();
		const text = sse([
			ev("response.completed", { response: { id: "r2", output: [{ type: "function_call", call_id: "c", name: "list_pages", arguments: "{}" }] } }),
		]);
		for (const e of p.feed(text)) r.push(e);
		expect(r.calls).toHaveLength(1);
		expect(r.responseId).toBe("r2");
	});

	it("continues from the previous response with only the function outputs", () => {
		const base = { model: "m", instructions: "sys", input: [{ role: "user", content: "hi" }], tools: [{ type: "function" }], stream: true };
		const next = continueBody(base, "resp_1", [{ call: { callId: "call_1", name: "search_pages", arguments: "{}" }, output: "hits" }]);
		expect(next).toMatchObject({ model: "m", instructions: "sys", previous_response_id: "resp_1", stream: true });
		expect(next.input).toEqual([{ type: "function_call_output", call_id: "call_1", output: "hits" }]);
		expect(next.tool_choice).toBeUndefined();
		expect(base.input).toHaveLength(1); // not mutated
	});

	it("names the function for Perplexity and stops tools on the last round", () => {
		const next = continueBody({ tools: [{}] }, "r", [{ call: { callId: "c", name: "n", arguments: "{}" }, output: "o" }], {
			outputName: true,
			lastRound: true,
		});
		expect(next.input).toEqual([{ type: "function_call_output", call_id: "c", name: "n", output: "o" }]);
		expect(next.tool_choice).toBe("none");
	});

	it("declares function tools and web search", () => {
		const t = responsesTools(VAULT_TOOLS, true);
		expect(t[0]).toMatchObject({ type: "function", name: "list_pages", parameters: { type: "object" } });
		expect(t[3]).toEqual({ type: "web_search" });
		expect(responsesTools(undefined, false)).toEqual([]);
	});

	it("parses arguments leniently and spots a tools rejection", () => {
		expect(parseArguments('{"a":1}')).toEqual({ a: 1 });
		expect(parseArguments("")).toEqual({});
		expect(parseArguments("{bad")).toEqual({});
		expect(rejectsTools(400, "Unknown parameter: 'tools'")).toBe(true);
		expect(rejectsTools(400, "max_output_tokens too large")).toBe(false);
		expect(rejectsTools(500, "tools")).toBe(false);
	});
});

const VAULT = "/vault/My Notes";
const base = (over: Partial<AiRequest> = {}): AiRequest => ({ messages: [], model: "claude-haiku-4-5", maxTokens: 1000, ...over });
const after = (args: string[], flag: string) => {
	const i = args.indexOf(flag);
	const rest: string[] = [];
	for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) rest.push(args[j]);
	return rest;
};

describe("claude args", () => {
	it("keeps one turn and no tools when nothing is on", () => {
		const a = claudeArgs(base(), "sys");
		expect(a).toContain("--max-turns");
		expect(a[a.indexOf("--max-turns") + 1]).toBe("1");
		expect(a[a.indexOf("--tools") + 1]).toBe("");
		expect(a).not.toContain("--allowedTools");
		expect(a).not.toContain("--add-dir");
		expect(a[a.indexOf("--system-prompt") + 1]).toBe("sys");
	});
	it("gives read-only vault tools and the vault directory", () => {
		const a = claudeArgs(base({ vaultDir: VAULT }), "sys");
		expect(a[a.indexOf("--max-turns") + 1]).toBe("12");
		expect(a[a.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
		expect(a[a.indexOf("--allowedTools") + 1]).toBe("Read,Grep,Glob");
		expect(a[a.indexOf("--add-dir") + 1]).toBe(VAULT);
		expect(after(a, "--disallowedTools")).toEqual([`Read(/${VAULT}/.obsidian/**)`]);
		expect(a[a.indexOf("--system-prompt") + 1]).toContain(`vault at ${VAULT}`);
	});
	it("gives only web tools for web search alone", () => {
		const a = claudeArgs(base({ webSearch: true }), undefined);
		expect(a[a.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
		expect(a[a.indexOf("--allowedTools") + 1]).toBe("WebSearch,WebFetch");
		expect(a).not.toContain("--add-dir");
		expect(a).not.toContain("--system-prompt");
	});
	it("combines both", () => {
		expect(claudeToolNames(base({ vaultDir: VAULT, webSearch: true }))).toEqual(["Read", "Grep", "Glob", "WebSearch", "WebFetch"]);
	});
	it("denies excluded folders with absolute-path rules and names them in the prompt", () => {
		const a = claudeArgs(base({ vaultDir: VAULT, excludeDirs: [`${VAULT}/Clients/Acme`, `${VAULT}/Private`] }), "sys");
		expect(after(a, "--disallowedTools")).toEqual([
			"Read(//vault/My Notes/.obsidian/**)",
			"Read(//vault/My Notes/Clients/Acme/**)",
			"Read(//vault/My Notes/Private/**)",
		]);
		const sys = a[a.indexOf("--system-prompt") + 1];
		expect(sys).toContain(`${VAULT}/Clients/Acme`);
		expect(sys).toContain("Never read");
	});
	it("writes rules with a double slash and escapes glob characters", () => {
		expect(readDenyRule("/Users/me/v/a")).toBe("Read(//Users/me/v/a/**)");
		expect(readDenyRule("/v/a[1]*/")).toBe("Read(//v/a\\[1\\]\\*/**)");
	});
	it("adds no vault note without a vault", () => {
		expect(vaultNote(base({ webSearch: true }))).toBeUndefined();
	});
});

describe("codex args", () => {
	it("stays in the neutral directory with web search off", () => {
		const a = codexArgs(base({ model: "gpt-x" }));
		expect(a).not.toContain("--cd");
		expect(a).toContain('web_search="disabled"');
		expect(a.slice(-3)).toEqual(["--model", "gpt-x", "-"]);
		expect(a).toContain("read-only");
	});
	it("opens the vault and turns live search on", () => {
		const a = codexArgs(base({ vaultDir: VAULT, webSearch: true }));
		expect(a[a.indexOf("--cd") + 1]).toBe(VAULT);
		expect(a).toContain('web_search="live"');
	});
	it("names excluded folders in the prompt", () => {
		const p = codexPrompt(base({ vaultDir: VAULT, excludeDirs: [`${VAULT}/Private`] }), "sys", "Q");
		expect(p).toContain("sys");
		expect(p).toContain(`${VAULT}/Private`);
		expect(p.endsWith("Q")).toBe(true);
	});
});

describe("claude tool lines for the web", () => {
	it("maps WebSearch and WebFetch", () => {
		const r = new CliStreamReducer();
		const step = r.push({
			type: "assistant",
			message: {
				content: [
					{ type: "tool_use", name: "WebSearch", input: { query: "x" } },
					{ type: "tool_use", name: "WebFetch", input: { url: "https://www.bbc.com/news" } },
					{ type: "tool_use", name: "WebFetch", input: {} },
				],
			},
		});
		expect(step.tools).toEqual(["Searching the web", "Reading www.bbc.com", "Reading a web page"]);
	});
});
