import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CliStreamReducer, NOT_SIGNED_IN } from "../src/ai/cli-stream";

function run(lines: unknown[]) {
	const r = new CliStreamReducer();
	const texts: string[] = [];
	const tools: string[] = [];
	for (const l of lines) {
		const s = r.push(l);
		texts.push(...s.texts);
		tools.push(...s.tools);
	}
	return { r, text: texts.join(""), tools };
}
const assistant = (content: unknown[], stop_reason: string | null = null) => ({
	type: "assistant",
	message: { content, stop_reason },
});

describe("CliStreamReducer", () => {
	it("emits the recorded stream's text once", () => {
		const lines = readFileSync("test/fixtures/claude-cli-stream.jsonl", "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));
		const { r, text } = run(lines);
		expect(text).toBe("Ripples carry it.");
		expect(r.truncated).toBe(false);
		expect(r.failure).toBeNull();
	});
	it("falls back to assistant text when nothing streamed", () => {
		expect(run([assistant([{ type: "text", text: "Hello." }])]).text).toBe("Hello.");
	});
	it("describes tool use", () => {
		const { tools } = run([
			assistant([
				{ type: "tool_use", name: "Read", input: { file_path: "/x/replay.md" } },
				{ type: "tool_use", name: "Grep", input: { pattern: "ripple" } },
				{ type: "tool_use", name: "Glob", input: {} },
				{ type: "tool_use", name: "Bash", input: {} },
			]),
		]);
		expect(tools).toEqual(["Reading replay.md", "Searching for “ripple”", "Listing the pages", "Using Bash"]);
	});
	it("maps a logged-out error to the sign-in message", () => {
		const { r } = run([{ type: "result", is_error: true, result: "Not logged in · Please run /login" }]);
		expect(r.failure).toBe(NOT_SIGNED_IN);
		expect(r.done).toBe(true);
	});
	it("keeps other error text", () => {
		const { r } = run([{ type: "result", is_error: true, result: "Boom" }]);
		expect(r.failure).toBe("Boom");
	});
	it("flags max_tokens as truncated", () => {
		const { r } = run([{ type: "stream_event", event: { delta: { stop_reason: "max_tokens" } } }]);
		expect(r.truncated).toBe(true);
	});
});
