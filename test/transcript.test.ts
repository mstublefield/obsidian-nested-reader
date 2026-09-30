import { describe, expect, it } from "vitest";
import { buildTranscript, splitSystem } from "../src/ai/transcript";

describe("buildTranscript", () => {
	it("sends a single message as is", () => {
		expect(buildTranscript([{ role: "user", content: "Hi" }])).toBe("Hi");
	});
	it("labels turns in a longer conversation", () => {
		expect(
			buildTranscript([
				{ role: "user", content: "A" },
				{ role: "assistant", content: "B" },
				{ role: "user", content: "C" },
			]),
		).toBe("Conversation so far; answer the last message.\n\nUser: A\n\nAssistant: B\n\nUser: C\n\n");
	});
});

describe("splitSystem", () => {
	it("folds system messages into the system prompt", () => {
		const r = splitSystem("Base", [
			{ role: "system", content: "Extra" },
			{ role: "user", content: "Q" },
		]);
		expect(r.system).toBe("Base\n\nExtra");
		expect(r.turns).toEqual([{ role: "user", content: "Q" }]);
	});
	it("leaves system undefined when there is none", () => {
		expect(splitSystem(undefined, [{ role: "user", content: "Q" }]).system).toBeUndefined();
	});
});
