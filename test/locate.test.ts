import { describe, expect, it } from "vitest";
import { dropOverlaps, lineRangeOffsets, locatePhrase, planReadingWrap } from "../src/reader/locate";

describe("locatePhrase", () => {
	const doc = "The cat sat.\n\nA cat is a cat.\n\nOther cat text";
	it("falls back to the first occurrence", () => {
		expect(locatePhrase(doc, "cat", "")).toEqual({ from: 4, to: 7 });
	});
	it("prefers an occurrence inside the saved paragraph", () => {
		const r = locatePhrase(doc, "cat", "A cat is a cat.");
		expect(r).toEqual({ from: 16, to: 19 });
		expect(doc.slice(r!.from, r!.to)).toBe("cat");
		expect(r!.from).toBeGreaterThan(doc.indexOf("A cat"));
	});
	it("falls back when the paragraph is gone", () => {
		expect(locatePhrase(doc, "cat", "A paragraph that was deleted")).toEqual({ from: 4, to: 7 });
	});
	it("falls back when the paragraph exists but no longer holds the phrase", () => {
		expect(locatePhrase(doc, "Other", "The cat sat.")).toEqual({ from: doc.indexOf("Other"), to: doc.indexOf("Other") + 5 });
	});
	it("tolerates whitespace differences in the text and the paragraph", () => {
		const d = "Line one\nline two is here\n\nnext";
		const r = locatePhrase(d, "one line two", "Line one line two is here");
		expect(d.slice(r!.from, r!.to)).toBe("one\nline two");
	});
	it("escapes regex characters", () => {
		const d = "cost (approx.) is $5+";
		const r = locatePhrase(d, "(approx.) is $5+", "");
		expect(d.slice(r!.from, r!.to)).toBe("(approx.) is $5+");
	});
	it("returns null when absent or blank", () => {
		expect(locatePhrase(doc, "dog", "")).toBeNull();
		expect(locatePhrase(doc, "  ", "")).toBeNull();
	});
});

describe("lineRangeOffsets", () => {
	const t = "aa\nbbb\ncc\n\nd";
	it("covers the lines without the final newline", () => {
		const r = lineRangeOffsets(t, 1, 2);
		expect(t.slice(r.from, r.to)).toBe("bbb\ncc");
	});
	it("handles the last line and out-of-range lines", () => {
		const r = lineRangeOffsets(t, 4, 4);
		expect(t.slice(r.from, r.to)).toBe("d");
		expect(lineRangeOffsets(t, 9, 9)).toEqual({ from: t.length, to: t.length });
	});
});

describe("planReadingWrap", () => {
	const docText = "# T\n\nFirst para about cats.\n\nSecond para about cats too.\n";
	const ask = { text: "cats", paragraph: "Second para about cats too." };
	it("marks the occurrence in the section that holds it", () => {
		const el = "Second para about cats too.";
		const hit = planReadingWrap(ask, el, { docText, lineStart: 4, lineEnd: 4 });
		expect(el.slice(hit!.from, hit!.to)).toBe("cats");
	});
	it("skips a section that holds only another occurrence", () => {
		expect(planReadingWrap(ask, "First para about cats.", { docText, lineStart: 2, lineEnd: 2 })).toBeNull();
	});
	it("uses the saved paragraph when there is no section info", () => {
		const el = "Second para about cats too.";
		expect(planReadingWrap(ask, el, null)).toEqual({ from: 18, to: 22 });
		expect(planReadingWrap(ask, "First para about cats.", null)).toBeNull();
	});
	it("falls back to the paragraph when the phrase spans formatting in the source", () => {
		const src = "Some **bold text** here";
		const a = { text: "bold text here", paragraph: "Some bold text here" };
		const el = "Some bold text here";
		const hit = planReadingWrap(a, el, { docText: src, lineStart: 0, lineEnd: 0 });
		expect(el.slice(hit!.from, hit!.to)).toBe("bold text here");
	});
	it("returns null when the phrase is nowhere", () => {
		expect(planReadingWrap({ text: "zebra", paragraph: "" }, "no stripes", null)).toBeNull();
	});
});

describe("dropOverlaps", () => {
	it("keeps the earlier of overlapping ranges and all disjoint ones", () => {
		const out = dropOverlaps([{ start: 10, end: 15 }, { start: 0, end: 5 }, { start: 3, end: 8 }, { start: 15, end: 20 }]);
		expect(out.map((r) => [r.start, r.end])).toEqual([[0, 5], [10, 15], [15, 20]]);
	});
});
