import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnthropicStreamReducer, SseParser, type SseEvent } from "../src/ai/sse";

const fixture = readFileSync("test/fixtures/anthropic-sse.txt", "utf8");

function parseAll(text: string, size: number): SseEvent[] {
	const p = new SseParser();
	const out: SseEvent[] = [];
	for (let i = 0; i < text.length; i += size) out.push(...p.feed(text.slice(i, i + size)));
	return out;
}
function reduce(events: SseEvent[]) {
	const r = new AnthropicStreamReducer();
	events.forEach((e) => r.push(e));
	return r;
}

describe("SseParser", () => {
	it("yields identical events however the stream is chunked", () => {
		const whole = parseAll(fixture, fixture.length);
		expect(whole).toHaveLength(8);
		for (const size of [1, 3, 7, 50]) expect(parseAll(fixture, size)).toEqual(whole);
	});
	it("handles CRLF, multiple data lines and comments", () => {
		const text = ": keep-alive\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n";
		const expected = [{ event: "x", data: "a\nb" }];
		expect(parseAll(text, text.length)).toEqual(expected);
		expect(parseAll(text, 1)).toEqual(expected);
	});
});

describe("AnthropicStreamReducer", () => {
	it("collects text and the stop reason", () => {
		const r = reduce(parseAll(fixture, 7));
		expect(r.text).toBe("Ripples carry it.");
		expect(r.truncated).toBe(false);
		expect(r.error).toBeNull();
	});
	it("flags max_tokens as truncated", () => {
		const r = reduce(parseAll(fixture.replace("end_turn", "max_tokens"), 7));
		expect(r.truncated).toBe(true);
	});
	it("reports error events", () => {
		const text =
			'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
		expect(reduce(parseAll(text, 7)).error).toBe("Overloaded");
	});
	it("ignores thinking and tool-input deltas", () => {
		const r = new AnthropicStreamReducer();
		for (const delta of [
			{ type: "thinking_delta", thinking: "hm" },
			{ type: "signature_delta", signature: "s" },
			{ type: "input_json_delta", partial_json: "{" },
		]) {
			r.push({ event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", delta }) });
		}
		expect(r.text).toBe("");
	});
});
