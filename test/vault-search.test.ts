import { describe, expect, it } from "vitest";
import { formatSearch, MAX_HITS, PER_PAGE_HITS, scanLines, searchTerms, type Candidate } from "../src/vault-search";

function cand(path: string, raw: string, query: string, title = path): Candidate {
	return { path, title, body: raw, ...scanLines(raw, query, searchTerms(query)) };
}

describe("scanLines", () => {
	it("finds lines case-insensitively with line numbers", () => {
		const s = scanLines("one\nA Ripple here\nthree\nripple again", "ripple", ["ripple"]);
		expect(s.verbatim).toEqual([
			{ line: 2, text: "A Ripple here" },
			{ line: 4, text: "ripple again" },
		]);
		expect(s.loose).toEqual([]);
	});
	it("collects separate-word lines for multi-word queries", () => {
		const s = scanLines("wake the sleeper\nnothing\nthey sleep well", "wake sleeper", searchTerms("wake sleeper"));
		expect(s.verbatim).toEqual([]);
		expect(s.loose.map((h) => h.line)).toEqual([1]);
	});
});

describe("formatSearch", () => {
	it("says so when nothing matches", () => {
		expect(formatSearch("zebra", [cand("a.md", "nothing", "zebra")])).toBe("No note mentions “zebra”.");
	});
	it("falls back to the separate words and says so", () => {
		const out = formatSearch("wake sleeper", [cand("a.md", "the sleeper does not wake\nx", "wake sleeper")]);
		expect(out.startsWith("No line holds “wake sleeper” word for word; these hold some of its words.")).toBe(true);
		expect(out).toContain("a.md:1: the sleeper does not wake");
	});
	it("does not fall back when a verbatim line exists somewhere", () => {
		const out = formatSearch("wake sleeper", [
			cand("a.md", "to wake sleeper cells", "wake sleeper"),
			cand("b.md", "wake only", "wake sleeper"),
		]);
		expect(out).toContain("a.md:1:");
		expect(out).not.toContain("b.md");
		expect(out).not.toContain("No line holds");
	});
	it("gives every page a turn before any page a second, and caps the total", () => {
		const chatty = Array.from({ length: 100 }, (_, i) => `ripple line ${i}`).join("\n");
		const out = formatSearch("ripple", [
			cand("chatty.md", chatty, "ripple"),
			cand("quiet.md", "a ripple", "ripple"),
		]);
		const lines = out.split("\n").filter((l) => /^\S+\.md:\d+:/.test(l));
		expect(lines.length).toBe(MAX_HITS);
		expect(lines.filter((l) => l.startsWith("quiet.md")).length).toBe(1);
		// The quiet page appears within the first round, not after chatty's later lines.
		const firstQuiet = lines.findIndex((l) => l.startsWith("quiet.md"));
		expect(firstQuiet).toBeLessThanOrEqual(PER_PAGE_HITS);
		expect(out).toContain("more matching lines not shown");
	});
	it("puts the best page first", () => {
		const out = formatSearch("ripple", [
			cand("weak.md", "a ripple\n" + "filler words here\n".repeat(50), "ripple", "Misc"),
			cand("strong.md", "ripple ripple ripple\nripple", "ripple", "Ripple"),
		]);
		expect(out.indexOf("strong.md")).toBeLessThan(out.indexOf("weak.md"));
	});
	it("keeps pages the word ranking drops", () => {
		const out = formatSearch("sleep", [cand("a.md", "the sleeper", "sleep", "Other")]);
		expect(out).toContain("a.md:1: the sleeper");
	});
	it("keeps the given order when told to", () => {
		const out = formatSearch(
			"ripple",
			[cand("first.md", "a ripple", "ripple"), cand("second.md", "ripple ripple ripple", "ripple", "Ripple")],
			{ ordered: true },
		);
		expect(out.indexOf("first.md")).toBeLessThan(out.indexOf("second.md"));
	});
	it("flags a partial scan", () => {
		expect(formatSearch("ripple", [cand("a.md", "ripple", "ripple")], { partial: true })).toContain("More matching lines not shown");
	});
	it("clips very long lines", () => {
		const out = formatSearch("ripple", [cand("a.md", "ripple " + "x".repeat(500), "ripple")]);
		expect(out.length).toBeLessThan(300);
		expect(out.trimEnd().endsWith("…")).toBe(true);
	});
});
