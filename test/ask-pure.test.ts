import { describe, expect, it } from "vitest";
import { commitTurn, newAskRecord } from "../src/ask-record";
import { promptSettings } from "../src/ask-messages";
import { quickAnswerMessages, type AskContext } from "../src/lib/prompts";
import { paragraphAround } from "../src/reader/paragraph";
import { isPillSelection, normalizeSelection } from "../src/reader/selection";
import { sourceFromFrontmatter, sourceLinkpath } from "../src/reader/source-link";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings-model";

describe("paragraphAround", () => {
	const doc = [
		"# Title", // 0
		"", // 1
		"First line of a paragraph", // 2
		"second line", // 3
		"", // 4
		"- item one", // 5
		"  wrapped", // 6
		"- item two", // 7
		"", // 8
		"```js", // 9
		"const a = 1;", // 10
		"", // 11
		"const b = 2;", // 12
		"```", // 13
		"Text right after the fence", // 14
		"## Next", // 15
		"Last line", // 16
	];
	it("stops at blank lines", () => {
		expect(paragraphAround(doc, 2)).toEqual({ from: 2, to: 3 });
		expect(paragraphAround(doc, 3)).toEqual({ from: 2, to: 3 });
	});
	it("treats a heading as its own block", () => {
		expect(paragraphAround(doc, 0)).toEqual({ from: 0, to: 0 });
		expect(paragraphAround(doc, 15)).toEqual({ from: 15, to: 15 });
	});
	it("takes a list item with its wrapped lines", () => {
		expect(paragraphAround(doc, 6)).toEqual({ from: 5, to: 6 });
		expect(paragraphAround(doc, 5)).toEqual({ from: 5, to: 6 });
		expect(paragraphAround(doc, 7)).toEqual({ from: 7, to: 7 });
	});
	it("returns a whole fenced block, blank lines inside included", () => {
		expect(paragraphAround(doc, 11)).toEqual({ from: 9, to: 13 });
		expect(paragraphAround(doc, 9)).toEqual({ from: 9, to: 13 });
	});
	it("does not run a paragraph into a fence or heading", () => {
		expect(paragraphAround(doc, 14)).toEqual({ from: 14, to: 14 });
		expect(paragraphAround(["text", "```", "x", "```"], 0)).toEqual({ from: 0, to: 0 });
	});
	it("handles first line, last line and bad input", () => {
		expect(paragraphAround(["only"], 0)).toEqual({ from: 0, to: 0 });
		expect(paragraphAround(doc, 16)).toEqual({ from: 16, to: 16 });
		expect(paragraphAround(doc, 99)).toEqual({ from: 16, to: 16 });
		expect(paragraphAround([], 0)).toEqual({ from: 0, to: 0 });
		expect(paragraphAround(["a", "b"], -3)).toEqual({ from: 0, to: 1 });
	});
	it("runs an unclosed fence to the end", () => {
		expect(paragraphAround(["```", "a", "b"], 1)).toEqual({ from: 0, to: 2 });
	});
});

describe("sourceLinkpath", () => {
	it("reads wikilinks, aliases and headings", () => {
		expect(sourceLinkpath("[[Parent]]")).toBe("Parent");
		expect(sourceLinkpath("[[Parent|alias]]")).toBe("Parent");
		expect(sourceLinkpath("[[Parent#Heading]]")).toBe("Parent");
		expect(sourceLinkpath("[[folder/Parent#H|alias]]")).toBe("folder/Parent");
		expect(sourceLinkpath("  [[ Parent ]] ")).toBe("Parent");
	});
	it("passes plain paths through", () => {
		expect(sourceLinkpath("parent.md")).toBe("parent.md");
		expect(sourceLinkpath("../notes/parent.md")).toBe("../notes/parent.md");
	});
	it("returns null for empty or unusable values", () => {
		for (const v of ["", "   ", "[[]]", "[[|alias]]", "#heading", "https://example.com/x", 42, null, undefined, {}]) {
			expect(sourceLinkpath(v)).toBeNull();
		}
	});
	it("finds a link inside the nested list YAML makes of an unquoted wikilink", () => {
		expect(sourceFromFrontmatter([["Parent"]])).toBe("Parent");
		expect(sourceFromFrontmatter([])).toBeNull();
	});
});

describe("selection helpers", () => {
	it("collapses whitespace", () => {
		expect(normalizeSelection("  a \n\n b\t c  ")).toBe("a b c");
	});
	it("offers the pill only for real, reasonably short selections", () => {
		expect(isPillSelection("hello")).toBe(true);
		expect(isPillSelection(" \n\t ")).toBe(false);
		expect(isPillSelection("x".repeat(2000))).toBe(true);
		expect(isPillSelection("x".repeat(2001))).toBe(false);
	});
});

describe("quickAnswerMessages with the settings adapter", () => {
	const base = (context = DEFAULT_SETTINGS.context): AskContext => ({
		page: { meta: { path: "a.md", title: "Page A" }, body: "Body of the page." },
		selection: "sharp-wave ripple",
		paragraph: "A paragraph about a sharp-wave ripple in the hippocampus.",
		session: [],
		folder: [],
		mapPages: [],
		summaries: {},
		settings: promptSettings(context),
		thread: [],
	});
	it("puts the highlight, paragraph and question in the user message", () => {
		const { messages, system } = quickAnswerMessages(base(), "Why does it matter?");
		const text = messages[0].content as string;
		expect(text).toContain("Highlighted text:\nsharp-wave ripple");
		expect(text).toContain("Paragraph containing the highlight:");
		expect(text).toContain("A paragraph about a sharp-wave ripple");
		expect(text).toContain("Question: Why does it matter?");
		expect(system).not.toContain("tools provided");
	});
	it("asks to explain the selection when the question is empty", () => {
		const text = quickAnswerMessages(base(), "").messages[0].content as string;
		expect(text).toContain("Question: Explain: sharp-wave ripple");
	});
	it("drops the paragraph when the highlight toggle is off", () => {
		const ctx = base({ ...DEFAULT_SETTINGS.context, highlight: false });
		const text = quickAnswerMessages(ctx, "Why?").messages[0].content as string;
		expect(text).not.toContain("Paragraph containing the highlight");
		expect(text).not.toContain("A paragraph about a sharp-wave ripple");
		expect(text).toContain("Question: Why?");
	});
	it("replays the thread for follow-ups", () => {
		const ctx = { ...base(), thread: [{ question: "First?", answer: "One." }] };
		const { messages } = quickAnswerMessages(ctx, "Second?");
		expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
		expect(messages[2].content).toBe("Question: Second?");
	});
});

describe("ask record", () => {
	it("remembers a finished answer in the thread", () => {
		const r = newAskRecord("1", "a.md", "x", "para");
		r.question = "Why?";
		commitTurn(r, { text: "Because.", truncated: false });
		expect(r.thread).toEqual([{ question: "Why?", answer: "Because." }]);
		expect(r.answer).toBe("Because.");
		expect(r.truncated).toBeUndefined();
	});
	it("shows but does not remember a cut-off answer", () => {
		const r = newAskRecord("1", "a.md", "x", "para");
		r.question = "Why?";
		commitTurn(r, { text: "Because", truncated: true });
		expect(r.thread).toEqual([]);
		expect(r.answer).toBe("Because");
		expect(r.truncated).toBe(true);
	});
});

describe("showAskButton setting", () => {
	it("defaults on and survives old saved data", () => {
		expect(mergeSettings({}).showAskButton).toBe(true);
		expect(mergeSettings({ service: "openai" }).showAskButton).toBe(true);
		expect(mergeSettings({ showAskButton: false }).showAskButton).toBe(false);
	});
});
