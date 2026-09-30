import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ResponsesStreamReducer } from "../src/ai/responses-stream";
import { SseParser } from "../src/ai/sse";

function run(text: string, chunk = text.length) {
	const parser = new SseParser();
	const r = new ResponsesStreamReducer();
	const deltas: string[] = [];
	for (let i = 0; i < text.length; i += chunk) {
		for (const ev of parser.feed(text.slice(i, i + chunk))) {
			const d = r.push(ev);
			if (d) deltas.push(d);
		}
	}
	return { r, deltas };
}
const fixture = (n: string) => readFileSync(`test/fixtures/${n}.txt`, "utf8");

describe("ResponsesStreamReducer", () => {
	it("collects deltas and completes", () => {
		const { r, deltas } = run(fixture("responses-complete"));
		expect(deltas).toEqual(["Ripples ", "carry it."]);
		expect(r.text).toBe("Ripples carry it.");
		expect(r.done).toBe(true);
		expect(r.truncated).toBe(false);
		expect(r.failure).toBeNull();
	});

	it("survives arbitrary chunk boundaries", () => {
		expect(run(fixture("responses-complete"), 7).r.text).toBe("Ripples carry it.");
	});

	it("flags truncation on response.incomplete", () => {
		const { r } = run(fixture("responses-incomplete"));
		expect(r.text).toBe("Ripples car");
		expect(r.truncated).toBe(true);
		expect(r.done).toBe(true);
	});

	it("flags truncation from completed with incomplete status", () => {
		const { r } = run(
			'data: {"type":"response.completed","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
		);
		expect(r.truncated).toBe(true);
	});

	it("reports response.failed", () => {
		const { r } = run(fixture("responses-failed"));
		expect(r.failure).toBe("The model is overloaded");
	});

	it("reports a bare error event", () => {
		const { r } = run('event: error\ndata: {"type":"error","error":{"message":"Bad key"}}\n\n');
		expect(r.failure).toBe("Bad key");
		const top = run('data: {"type":"error","message":"Top level"}\n\n').r;
		expect(top.failure).toBe("Top level");
	});

	it("treats [DONE] as the end", () => {
		const { r, deltas } = run(fixture("responses-done-sentinel"));
		expect(deltas).toEqual(["Hi"]);
		expect(r.done).toBe(true);
	});

	it("uses the event line when the JSON has no type", () => {
		const { deltas } = run('event: response.output_text.delta\ndata: {"delta":"x"}\n\n');
		expect(deltas).toEqual(["x"]);
	});

	it("ignores unrelated events", () => {
		const { r } = run('data: {"type":"response.reasoning_summary_text.delta","delta":"hmm"}\n\n');
		expect(r.text).toBe("");
		expect(r.done).toBe(false);
	});
});
