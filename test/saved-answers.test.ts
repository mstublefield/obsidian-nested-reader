import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitTurn, newAskRecord } from "../src/ask-record";
import { AnswersStore, type AnswersIO, WRITE_DELAY_MS } from "../src/store/answers";
import {
	deletePath,
	parseAnswers,
	recordToSaved,
	renamePath,
	savedToRecord,
	shouldRemember,
	type SavedAsk,
	upsertAsk,
} from "../src/store/answers-core";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings-model";

const ask = (over: Partial<SavedAsk> = {}): SavedAsk => ({
	id: "a1",
	text: "tidal locking",
	paragraph: "The moon shows one face because of tidal locking.",
	question: "What is it?",
	answer: "When rotation matches orbit.",
	thread: [],
	created: 100,
	updated: 100,
	...over,
});

describe("upsertAsk", () => {
	it("appends a new phrase", () => {
		expect(upsertAsk([ask()], ask({ id: "b", text: "other" })).map((a) => a.id)).toEqual(["a1", "b"]);
	});
	it("replaces the entry with the same text, keeping its creation time", () => {
		const out = upsertAsk([ask()], ask({ id: "b", answer: "new", created: 500, updated: 500 }));
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ id: "b", answer: "new", created: 100, updated: 500 });
	});
	it("matches text regardless of whitespace runs", () => {
		expect(upsertAsk([ask({ text: "a  b" })], ask({ id: "b", text: "a b" }))).toHaveLength(1);
	});
	it("does not mutate its input", () => {
		const list = [ask()];
		upsertAsk(list, ask({ answer: "x" }));
		expect(list[0].answer).toBe("When rotation matches orbit.");
	});
});

describe("renamePath and deletePath", () => {
	const notes = { "A/one.md": [ask()], "A/sub/two.md": [ask({ id: "b", text: "x" })], "B/three.md": [ask({ id: "c", text: "y" })], "Aardvark.md": [ask({ id: "d", text: "z" })] };
	it("renames one note", () => {
		const r = renamePath(notes, "A/one.md", "A/uno.md");
		expect(Object.keys(r.notes).sort()).toEqual(["A/sub/two.md", "A/uno.md", "Aardvark.md", "B/three.md"]);
		expect(r.affected.sort()).toEqual(["A/one.md", "A/uno.md"]);
	});
	it("renames every note under a folder, not siblings that share a prefix", () => {
		const r = renamePath(notes, "A", "Z");
		expect(Object.keys(r.notes).sort()).toEqual(["Aardvark.md", "B/three.md", "Z/one.md", "Z/sub/two.md"]);
	});
	it("merges into an existing note by phrase", () => {
		const r = renamePath({ "a.md": [ask()], "b.md": [ask({ id: "n", text: "other" })] }, "a.md", "b.md");
		expect(r.notes["b.md"].map((x) => x.id).sort()).toEqual(["a1", "n"]);
	});
	it("does nothing for an unknown path", () => {
		expect(renamePath(notes, "nope", "x").affected).toEqual([]);
	});
	it("deletes a note", () => {
		const r = deletePath(notes, "B/three.md");
		expect(r.affected).toEqual(["B/three.md"]);
		expect(r.notes["B/three.md"]).toBeUndefined();
	});
	it("deletes a folder and everything in it", () => {
		const r = deletePath(notes, "A");
		expect(Object.keys(r.notes).sort()).toEqual(["Aardvark.md", "B/three.md"]);
		expect(r.affected.sort()).toEqual(["A/one.md", "A/sub/two.md"]);
	});
});

describe("parseAnswers", () => {
	it("starts empty for a missing or blank file", () => {
		expect(parseAnswers(null)).toEqual({ data: { version: 1, notes: {} }, corrupt: false });
		expect(parseAnswers("  ").corrupt).toBe(false);
	});
	it("flags unparseable or wrongly shaped files as corrupt", () => {
		expect(parseAnswers("{nope").corrupt).toBe(true);
		expect(parseAnswers("[]").corrupt).toBe(true);
		expect(parseAnswers('{"version":1,"notes":[]}').corrupt).toBe(true);
	});
	it("flags a newer version so it is backed up, not overwritten silently", () => {
		expect(parseAnswers('{"version":2,"notes":{}}').corrupt).toBe(true);
	});
	it("reads a file with no version as version 1", () => {
		const r = parseAnswers(JSON.stringify({ notes: { "n.md": [ask()] } }));
		expect(r.corrupt).toBe(false);
		expect(r.data.notes["n.md"]).toHaveLength(1);
	});
	it("drops unusable entries and fills missing fields", () => {
		const raw = JSON.stringify({
			version: 1,
			notes: { "n.md": [ask(), { id: "", text: "x", answer: "y" }, { id: "z", text: "t", answer: "a" }, 7], "bad.md": "x", "e.md": [] },
		});
		const r = parseAnswers(raw).data;
		expect(r.notes["n.md"].map((a) => a.id)).toEqual(["a1", "z"]);
		expect(r.notes["n.md"][1]).toMatchObject({ thread: [], question: "", paragraph: "" });
		expect(r.notes["bad.md"]).toBeUndefined();
		expect(r.notes["e.md"]).toBeUndefined();
	});
});

describe("shouldRemember", () => {
	it("remembers a finished answer", () => {
		expect(shouldRemember({ answer: "yes" })).toBe(true);
	});
	it("does not remember a cut-off answer", () => {
		expect(shouldRemember({ answer: "yes", truncated: true })).toBe(false);
	});
	it("does not remember an errored or empty one", () => {
		expect(shouldRemember({ answer: "yes", error: "boom" })).toBe(false);
		expect(shouldRemember({ answer: "  " })).toBe(false);
	});
	it("agrees with commitTurn on a truncated result", () => {
		const r = newAskRecord("i", "n.md", "t", "p");
		r.question = "q";
		commitTurn(r, { text: "half", truncated: true });
		expect(shouldRemember(r)).toBe(false);
	});
});

describe("record <-> saved", () => {
	it("keeps earlier turns in thread and the latest in question/answer", () => {
		const r = newAskRecord("i", "n.md", "t", "p");
		r.question = "one";
		commitTurn(r, { text: "A1", truncated: false });
		r.question = "two";
		commitTurn(r, { text: "A2", truncated: false });
		const saved = recordToSaved(r, 9);
		expect(saved).toMatchObject({ question: "two", answer: "A2", thread: [{ question: "one", answer: "A1" }], created: 9 });
	});
	it("round-trips through savedToRecord with every turn in the thread", () => {
		const s = ask({ thread: [{ question: "one", answer: "A1" }], question: "two", answer: "A2" });
		const r = savedToRecord(s, "n.md");
		expect(r.thread).toEqual([{ question: "one", answer: "A1" }, { question: "two", answer: "A2" }]);
		expect(recordToSaved(r, 1).thread).toEqual(s.thread);
	});
});

describe("AnswersStore", () => {
	let files: Map<string, string>;
	let io: AnswersIO;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", globalThis);
		files = new Map();
		io = {
			exists: async (p) => files.has(p),
			read: async (p) => files.get(p) ?? "",
			write: async (p, d) => void files.set(p, d),
		};
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("upserts, lists, finds and removes", async () => {
		const s = new AnswersStore(io, "answers.json");
		await s.load();
		s.upsert("n.md", ask());
		expect(s.list("n.md")).toHaveLength(1);
		expect(s.find("a1")?.path).toBe("n.md");
		expect(s.remove("n.md", "a1")?.id).toBe("a1");
		expect(s.list("n.md")).toEqual([]);
		expect(s.remove("n.md", "a1")).toBeNull();
	});

	it("debounces writes and flushes on demand", async () => {
		const s = new AnswersStore(io, "answers.json");
		await s.load();
		s.upsert("n.md", ask());
		s.upsert("n.md", ask({ answer: "later" }));
		expect(files.has("answers.json")).toBe(false);
		await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS + 10);
		expect(JSON.parse(files.get("answers.json") ?? "{}").notes["n.md"][0].answer).toBe("later");
		s.upsert("m.md", ask({ id: "z" }));
		await s.flush();
		expect(JSON.parse(files.get("answers.json") ?? "{}").notes["m.md"]).toHaveLength(1);
	});

	it("reloads what it wrote", async () => {
		const a = new AnswersStore(io, "answers.json");
		await a.load();
		a.upsert("n.md", ask());
		await a.flush();
		const b = new AnswersStore(io, "answers.json");
		await b.load();
		expect(b.list("n.md")[0].text).toBe("tidal locking");
	});

	it("backs up a corrupt file and starts empty", async () => {
		files.set("answers.json", "{broken");
		const s = new AnswersStore(io, "answers.json");
		await s.load();
		expect(files.get("answers.json.bak")).toBe("{broken");
		expect(s.list("n.md")).toEqual([]);
	});

	it("reports the paths a change touched", async () => {
		const s = new AnswersStore(io, "answers.json");
		await s.load();
		const seen: string[][] = [];
		const off = s.onChange((p) => seen.push(p));
		s.upsert("a/n.md", ask());
		s.rename("a", "b");
		s.deleteNote("b");
		off();
		s.upsert("x.md", ask({ id: "q", text: "q" }));
		expect(seen[0]).toEqual(["a/n.md"]);
		expect(seen[1].sort()).toEqual(["a/n.md", "b/n.md"]);
		expect(seen[2]).toEqual(["b/n.md"]);
		expect(seen).toHaveLength(3);
	});

	it("clears a note and returns what it held", async () => {
		const s = new AnswersStore(io, "answers.json");
		await s.load();
		s.upsert("n.md", ask());
		expect(s.clearNote("n.md")).toHaveLength(1);
		expect(s.count("n.md")).toBe(0);
		expect(s.clearNote("n.md")).toEqual([]);
	});
});

describe("answer settings defaults", () => {
	it("default to on and survive a merge with old data", () => {
		for (const k of ["rememberAnswers", "underlineAnswers", "hoverAnswers", "clickOpensAnswers"] as const) {
			expect(DEFAULT_SETTINGS[k]).toBe(true);
			expect(mergeSettings({ service: "openai" })[k]).toBe(true);
			expect(mergeSettings({ [k]: false })[k]).toBe(false);
		}
	});
});
