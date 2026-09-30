import { describe, expect, it } from "vitest";
import { CodexStreamReducer } from "../src/ai/codex-stream";

describe("CodexStreamReducer", () => {
	it("emits an agent message whole and finishes on turn.completed", () => {
		const r = new CodexStreamReducer();
		expect(r.push({ type: "thread.started", thread_id: "t" })).toEqual({ texts: [], tools: [] });
		const step = r.push({ type: "item.completed", item: { type: "agent_message", text: "Ripples carry it." } });
		expect(step.texts).toEqual(["Ripples carry it."]);
		r.push({ type: "turn.completed", usage: {} });
		expect(r.done).toBe(true);
		expect(r.failure).toBeNull();
		expect(r.truncated).toBe(false);
	});

	it("turns a started command into a short tool line", () => {
		const r = new CodexStreamReducer();
		const long = "x".repeat(100);
		const step = r.push({ type: "item.started", item: { type: "command_execution", command: `cat\n${long}` } });
		expect(step.tools).toHaveLength(1);
		expect(step.tools[0].startsWith("Running `cat x")).toBe(true);
		expect(step.tools[0]).toBe(`Running \`cat ${"x".repeat(56)}\``);
		expect(r.push({ type: "item.started", item: { type: "command_execution" } }).tools).toEqual(["Running a command"]);
	});

	it("reports turn.failed and error", () => {
		const a = new CodexStreamReducer();
		a.push({ type: "turn.failed", error: { message: "Rate limited" } });
		expect(a.failure).toBe("Rate limited");
		const b = new CodexStreamReducer();
		b.push({ type: "error", message: "Boom" });
		expect(b.failure).toBe("Boom");
		const c = new CodexStreamReducer();
		c.push({ type: "error" });
		expect(c.failure).toBe("Codex returned an error");
	});
});
