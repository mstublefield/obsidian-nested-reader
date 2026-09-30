import { describe, expect, it } from "vitest";
import { promptSettings, systemAddendum } from "../src/ask-messages";
import { DEFAULT_SETTINGS, mergeSettings, type AnswerSettings } from "../src/settings-model";
import {
	checkReadPath,
	clipPage,
	describeTool,
	formatList,
	isExcluded,
	LIST_CAP,
	MAX_PAGE_CHARS,
	normalizeFolder,
	normalizeFolders,
	titleOf,
} from "../src/vault-rules";

const A = (over: Partial<AnswerSettings> = {}): AnswerSettings => ({
	ownKnowledge: false,
	vaultSearch: false,
	excludeFolders: [],
	webSearch: false,
	extraInstructions: "",
	...over,
});

describe("systemAddendum", () => {
	it("is empty when nothing applies", () => {
		expect(systemAddendum(A())).toBe("");
	});
	it("adds each part in order", () => {
		const out = systemAddendum(
			A({ ownKnowledge: true, vaultSearch: true, excludeFolders: ["Clients/Acme", "Private"], webSearch: true, extraInstructions: " Answer for a product manager. " }),
		);
		const own = out.indexOf("own knowledge");
		const vault = out.indexOf("Obsidian vault");
		const web = out.indexOf("search the web");
		const extra = out.indexOf("Answer for a product manager.");
		expect(own).toBeGreaterThan(-1);
		expect(vault).toBeGreaterThan(own);
		expect(web).toBeGreaterThan(vault);
		expect(extra).toBeGreaterThan(web);
		expect(out).toContain("Never read these folders: Clients/Acme, Private.");
		expect(out.endsWith("Answer for a product manager.")).toBe(true);
	});
	it("names no folders when none are excluded", () => {
		expect(systemAddendum(A({ vaultSearch: true }))).not.toContain("Never read");
	});
	it("does not mention the vault or web unless they are on", () => {
		const out = systemAddendum(A({ ownKnowledge: true }));
		expect(out).not.toContain("vault");
		expect(out).not.toContain("web");
	});
	it("passes extra instructions alone", () => {
		expect(systemAddendum(A({ extraInstructions: "Be brief." }))).toBe("Be brief.");
	});
});

describe("promptSettings", () => {
	it("turns upstream's tools sentence on with vault search", () => {
		expect(promptSettings(DEFAULT_SETTINGS.context, true).tools).toBe(true);
		expect(promptSettings(DEFAULT_SETTINGS.context).tools).toBe(false);
	});
});

describe("answers settings", () => {
	it("has the agreed defaults", () => {
		expect(DEFAULT_SETTINGS.answers).toEqual({
			ownKnowledge: true,
			vaultSearch: true,
			excludeFolders: [],
			webSearch: false,
			extraInstructions: "",
		});
	});
	it("fills in answers for settings saved before it existed", () => {
		expect(mergeSettings({ service: "xai" }).answers).toEqual(DEFAULT_SETTINGS.answers);
	});
	it("keeps saved values and cleans the folder list", () => {
		const s = mergeSettings({ answers: { webSearch: true, excludeFolders: [" /Clients/Acme/ ", "", "Clients/Acme", 4] } });
		expect(s.answers.webSearch).toBe(true);
		expect(s.answers.vaultSearch).toBe(true);
		expect(s.answers.excludeFolders).toEqual(["Clients/Acme"]);
	});
	it("ignores a folder list of the wrong type", () => {
		expect(mergeSettings({ answers: { excludeFolders: 5 } }).answers.excludeFolders).toEqual([]);
	});
});

describe("folders", () => {
	it("normalizes one path", () => {
		expect(normalizeFolder("  /Clients//Acme/  ")).toBe("Clients/Acme");
		expect(normalizeFolder("./a\\b/")).toBe("a/b");
		expect(normalizeFolder("/")).toBe("");
	});
	it("normalizes a textarea value", () => {
		expect(normalizeFolders("Clients/Acme\n\n  Private/ \r\nClients/Acme\n.")).toEqual(["Clients/Acme", "Private"]);
	});
	it("matches the folder and what is inside it, not a sibling with the same prefix", () => {
		const f = ["Clients/Acme"];
		expect(isExcluded("Clients/Acme", f)).toBe(true);
		expect(isExcluded("Clients/Acme/notes/a.md", f)).toBe(true);
		expect(isExcluded("clients/acme/A.md", f)).toBe(true);
		expect(isExcluded("Clients/Acme2/a.md", f)).toBe(false);
		expect(isExcluded("Clients/a.md", f)).toBe(false);
		expect(isExcluded("x.md", [])).toBe(false);
	});
});

describe("checkReadPath", () => {
	const ex = ["Clients/Acme"];
	it("accepts a vault-relative note", () => {
		expect(checkReadPath("notes/odour-cues.md", ex)).toEqual({ ok: true, path: "notes/odour-cues.md" });
		expect(checkReadPath("./a.md", ex)).toEqual({ ok: true, path: "a.md" });
	});
	it.each(["", "  ", "/etc/passwd.md", "../x.md", "a/../../x.md", "C:/x.md", "a//b.md", "notes/.hidden/a.md", ".obsidian/a.md", "a.txt", "a.png"])(
		"refuses %j",
		(p) => {
			expect(checkReadPath(p, ex).ok).toBe(false);
		},
	);
	it("refuses excluded folders without saying why", () => {
		const r = checkReadPath("Clients/Acme/plan.md", ex);
		expect(r).toEqual({ ok: false, error: "Clients/Acme/plan.md is not a note in this vault." });
	});
	it("says Markdown only for other file types", () => {
		const r = checkReadPath("a.txt", ex);
		expect(!r.ok && r.error).toContain("Only Markdown");
	});
});

describe("page helpers", () => {
	it("clips long pages", () => {
		expect(clipPage("short")).toBe("short");
		const big = clipPage("x".repeat(MAX_PAGE_CHARS + 10));
		expect(big.startsWith("x".repeat(MAX_PAGE_CHARS))).toBe(true);
		expect(big).toContain("only the first 40000 characters");
	});
	it("finds a title", () => {
		expect(titleOf('---\ntitle: "Replay"\n---\nbody', "a/replay.md")).toBe("Replay");
		expect(titleOf("# no front matter", "a/replay.md")).toBe("replay");
	});
	it("caps the list and says how many more", () => {
		const entries = Array.from({ length: LIST_CAP + 3 }, (_, i) => ({ path: `n${i}.md`, title: `T${i}` }));
		const out = formatList(entries);
		expect(out.split("\n").filter((l) => l.includes(" — ")).length).toBe(LIST_CAP);
		expect(out).toContain("[3 more notes not shown");
		expect(formatList([])).toContain("no notes");
	});
	it("describes tool calls in upstream's words", () => {
		expect(describeTool("list_pages", {})).toBe("Listing the pages");
		expect(describeTool("read_page", { path: "notes/replay.md" })).toBe("Reading replay.md");
		expect(describeTool("read_page", {})).toBe("Reading a page");
		expect(describeTool("search_pages", { query: "ripple" })).toBe("Searching for “ripple”");
		expect(describeTool("search_pages", { query: " " })).toBe("Searching the pages");
		expect(describeTool("other", {})).toBe("Using other");
	});
});
