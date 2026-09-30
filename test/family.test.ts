import { describe, expect, it } from "vitest";
import { emptyPageState, markDone, markFailed, markUnread, markWriting, markRead } from "../src/pages/page-state";
import type { PageMeta } from "../src/platform/types";
import { answerCountText, familyOf, familyRows, rowState, SourceIndex } from "../src/tree/family";

function idx(pairs: [string, string | null][]): SourceIndex {
	const i = new SourceIndex();
	for (const [c, p] of pairs) i.set(c, p);
	return i;
}

const meta = (path: string, created: string, source?: string): PageMeta => ({ path, title: path, created, source });

describe("SourceIndex", () => {
	it("tracks parents and children, and forgets on set(null)", () => {
		const i = idx([["b", "a"], ["c", "a"]]);
		expect(i.parentOf("b")).toBe("a");
		expect(i.childrenOf("a")).toEqual(["b", "c"]);
		i.set("b", null);
		expect(i.parentOf("b")).toBeUndefined();
		expect(i.childrenOf("a")).toEqual(["c"]);
		expect(i.size).toBe(1);
	});
	it("ignores a self source", () => {
		const i = idx([["a", "a"]]);
		expect(i.size).toBe(0);
	});
	it("moves a child to a new parent", () => {
		const i = idx([["b", "a"]]);
		i.set("b", "x");
		expect(i.childrenOf("a")).toEqual([]);
		expect(i.childrenOf("x")).toEqual(["b"]);
	});
	it("rename rewrites keys and values, including inside folders", () => {
		const i = idx([["dir/b.md", "dir/a.md"], ["c.md", "dir/a.md"]]);
		i.rename("dir", "moved");
		expect(i.parentOf("moved/b.md")).toBe("moved/a.md");
		expect(i.parentOf("c.md")).toBe("moved/a.md");
		expect([...i.childrenOf("moved/a.md")].sort()).toEqual(["c.md", "moved/b.md"]);
		i.rename("moved/a.md", "moved/z.md");
		expect(i.parentOf("c.md")).toBe("moved/z.md");
	});
	it("remove drops the note and orphans its children, folder or file", () => {
		const i = idx([["b", "a"], ["c", "b"], ["d/e", "a"]]);
		i.remove("b");
		expect(i.parentOf("b")).toBeUndefined();
		expect(i.parentOf("c")).toBeUndefined();
		expect(i.childrenOf("a")).toEqual(["d/e"]);
		i.remove("d");
		expect(i.size).toBe(0);
	});
});

describe("familyOf", () => {
	const i = idx([["b", "a"], ["c", "a"], ["d", "b"], ["z", "y"]]);
	it("finds the root from any member and lists all descendants", () => {
		for (const p of ["a", "b", "d", "c"]) {
			const f = familyOf(i, p);
			expect(f.root).toBe("a");
			expect(f.members.sort()).toEqual(["a", "b", "c", "d"]);
		}
	});
	it("a note with no family is its own root", () => {
		expect(familyOf(i, "solo")).toEqual({ root: "solo", members: ["solo"] });
	});
	it("a missing parent makes the child the root of its own family", () => {
		const f = familyOf(idx([["b", null]]), "b");
		expect(f).toEqual({ root: "b", members: ["b"] });
	});
	it("separate roots stay separate families", () => {
		expect(familyOf(i, "z").members.sort()).toEqual(["y", "z"]);
	});
	it("survives cycles", () => {
		const c = idx([["a", "b"], ["b", "c"], ["c", "a"]]);
		const f = familyOf(c, "a");
		expect(f.members.sort()).toEqual(["a", "b", "c"]);
		expect(new Set(f.members).size).toBe(3);
	});
});

describe("familyRows", () => {
	const st = emptyPageState();
	const metas: Record<string, PageMeta> = {
		a: meta("a", "2026-01-01T00:00:00Z"),
		b: meta("b", "2026-01-03T00:00:00Z", "a"),
		c: meta("c", "2026-01-02T00:00:00Z", "a"),
		d: meta("d", "2026-01-04T00:00:00Z", "b"),
	};
	const family = { root: "a", members: ["a", "b", "c", "d"] };

	it("puts children oldest first and indents by depth", () => {
		const rows = familyRows(family, metas, st, false);
		expect(rows.map((r) => [r.path, r.depth])).toEqual([["a", 0], ["c", 1], ["b", 1], ["d", 2]]);
		expect(rows[0].hasChildren).toBe(true);
	});
	it("handles a cycle by dropping the root's source", () => {
		const cyc = { a: meta("a", "2026-01-01T00:00:00Z", "b"), b: meta("b", "2026-01-02T00:00:00Z", "a") };
		const rows = familyRows({ root: "b", members: ["b", "a"] }, cyc, st, false);
		expect(rows.map((r) => [r.path, r.depth])).toEqual([["b", 0], ["a", 1]]);
	});
	it("ignores a source outside the family", () => {
		const rows = familyRows({ root: "a", members: ["a"] }, { a: meta("a", "2026-01-01T00:00:00Z", "gone") }, st, false);
		expect(rows).toHaveLength(1);
		expect(rows[0].depth).toBe(0);
	});
	it("skips members with no meta", () => {
		expect(familyRows({ root: "a", members: ["a", "q"] }, { a: metas.a }, st, false).map((r) => r.path)).toEqual(["a"]);
	});
	it("carries state and the failure reason", () => {
		let s = markUnread(st, "c");
		s = markWriting(s, "b");
		s = markFailed(s, "d", "No key");
		const rows = familyRows(family, metas, s, false);
		const by = Object.fromEntries(rows.map((r) => [r.path, r]));
		expect(by.c.state).toBe("unread");
		expect(by.b.state).toBe("writing");
		expect(by.d.state).toBe("failed");
		expect(by.d.error).toBe("No key");
		expect(by.a.state).toBe("none");
	});
	it("unread-only keeps matching rows and their ancestors, drops the rest", () => {
		const rows = familyRows(family, metas, markDone(st, "d", true), true);
		expect(rows.map((r) => r.path)).toEqual(["a", "b", "d"]);
	});
	it("unread-only is empty when nothing is unread", () => {
		expect(familyRows(family, metas, markRead(markDone(st, "d", true), "d"), true)).toEqual([]);
	});
});

describe("row state and counts", () => {
	it("writing beats failed beats unread", () => {
		const s = { unread: ["x"], writing: ["x"], failed: { x: "e" } };
		expect(rowState("x", s)).toBe("writing");
		expect(rowState("x", { ...s, writing: [] })).toBe("failed");
		expect(rowState("x", { ...s, writing: [], failed: {} })).toBe("unread");
		expect(rowState("y", s)).toBe("none");
	});
	it("answer count text", () => {
		expect(answerCountText(0)).toBe("");
		expect(answerCountText(1)).toBe("1 answer");
		expect(answerCountText(2)).toBe("2 answers");
	});
});
