import { describe, expect, it } from "vitest";
import { parseFrontMatter } from "../src/lib/frontmatter";
import {
	bodyFromText,
	composeFrontMatter,
	finishBody,
	firstH1,
	frontMatterBlock,
	isGrownPage,
	placeholderBody,
	withBody,
} from "../src/pages/compose";
import { canLinkPhrase, linkPhraseAt, paragraphWithLink, planPhraseLink, withAlias } from "../src/pages/link-phrase";
import { baseName, cleanFolder, newPagePath, pageDir, pageIdentity, readableName, uniquePath } from "../src/pages/names";
import {
	deletePage,
	emptyPageState,
	markDone,
	markFailed,
	markRead,
	markWriting,
	type PageState,
	renamePage,
	sanitizePageState,
	statusText,
} from "../src/pages/page-state";
import { sourceFromFrontmatter, sourceLinkpath } from "../src/reader/source-link";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings-model";

describe("file names", () => {
	it("makes readable names from questions", () => {
		expect(readableName("What is a sharp-wave ripple?")).toBe("What is a sharp-wave ripple");
		expect(readableName(`Why: a/b "c" <d> e|f #g ^h [i] j\\k`)).toBe("Why a b c d e f g h i j k");
		expect(readableName("  lots   of    space  ")).toBe("lots of space");
		expect(readableName("Ends with dots...")).toBe("Ends with dots");
		expect(readableName("...hidden")).toBe("hidden");
		expect(readableName("???")).toBe("Untitled");
		expect(readableName("tab\tand\nnewline")).toBe("tab and newline");
	});
	it("caps names at 80 characters, at a word boundary when it can", () => {
		const long = "word ".repeat(40).trim();
		const n = readableName(long);
		expect(n.length).toBeLessThanOrEqual(80);
		expect(n.endsWith("word")).toBe(true);
		expect(readableName("x".repeat(200))).toHaveLength(80);
	});
	it("makes slugs with upstream slugify", () => {
		expect(baseName("What is a sharp-wave ripple?", "slug")).toBe("what-is-a-sharp-wave-ripple");
		expect(baseName("What is a sharp-wave ripple?", "readable")).toBe("What is a sharp-wave ripple");
	});
	it("de-duplicates", () => {
		const taken = new Set(["A/q.md", "A/q 2.md", "A/s.md"]);
		const exists = (p: string) => taken.has(p);
		expect(uniquePath("A", "q", "readable", exists)).toBe("A/q 3.md");
		expect(uniquePath("A", "s", "slug", exists)).toBe("A/s-2.md");
		expect(uniquePath("A", "new", "slug", exists)).toBe("A/new.md");
		expect(uniquePath("", "x", "readable", () => false)).toBe("x.md");
	});
});

describe("locations", () => {
	it("goes beside the parent, or to the vault root for a root-level parent", () => {
		expect(pageDir("beside", "Nested", "Notes/Sleep/replay.md")).toBe("Notes/Sleep");
		expect(pageDir("beside", "Nested", "replay.md")).toBe("");
	});
	it("goes to the chosen folder, cleaned", () => {
		expect(pageDir("folder", "Nested", "Notes/replay.md")).toBe("Nested");
		expect(pageDir("folder", " /Nested//Deep\\ ", "a.md")).toBe("Nested/Deep");
		expect(pageDir("folder", "", "a/b.md")).toBe("");
		expect(cleanFolder("../x/./y")).toBe("x/y");
	});
	it("builds the whole path", () => {
		const taken = new Set(["n/What is it.md"]);
		expect(
			newPagePath({
				title: "What is it?",
				fileNames: "readable",
				location: "beside",
				folder: "",
				parentPath: "n/parent.md",
				exists: (p) => taken.has(p),
			}),
		).toBe("n/What is it 2.md");
	});
	it("compares existing names without regard to case when the caller does", () => {
		const taken = new Set(["n/what is it.md"]);
		const p = newPagePath({
			title: "What is it?",
			fileNames: "readable",
			location: "beside",
			folder: "",
			parentPath: "n/parent.md",
			exists: (x) => taken.has(x.toLowerCase()),
		});
		expect(p).toBe("n/What is it 2.md");
	});
});

describe("page identity", () => {
	it("uses the question", () => {
		expect(pageIdentity("what is a ripple?", "ripples", "P")).toEqual({ question: "what is a ripple?", title: "What is a ripple?" });
	});
	it("falls back to 'Go deeper on'", () => {
		expect(pageIdentity("  ", "sharp  wave\nripples", "P")).toEqual({
			question: "Go deeper on: sharp wave ripples",
			title: "Go deeper on sharp wave ripples",
		});
		expect(pageIdentity("", "", "Parent").question).toBe("Go deeper on: Parent");
	});
	it("caps a long derived title", () => {
		expect(pageIdentity("", "x".repeat(300), "P").title.length).toBeLessThanOrEqual(120);
	});
});

describe("front matter", () => {
	const meta = {
		title: "What is a ripple?",
		sourceLink: "Notes/Replay",
		question: 'Why "ripples": really?',
		created: "2026-09-30T10:00:00.000Z",
		mode: "new-page" as const,
	};
	it("writes keys in order with a quoted source", () => {
		const fm = composeFrontMatter(meta);
		expect(fm.split("\n").slice(1, 6).map((l) => l.split(":")[0])).toEqual(["title", "source", "question", "created", "mode"]);
		expect(fm).toContain('source: "[[Notes/Replay]]"');
		expect(fm.startsWith("---\n")).toBe(true);
		expect(fm.endsWith("---\n\n")).toBe(true);
	});
	it("round-trips through parseFrontMatter and sourceLinkpath", () => {
		const { meta: m, body } = parseFrontMatter(composeFrontMatter(meta) + "# T\n");
		expect(m.title).toBe(meta.title);
		expect(m.question).toBe(meta.question);
		expect(m.source).toBe("[[Notes/Replay]]");
		expect(m.mode).toBe("new-page");
		expect(m.created).toBe(meta.created);
		expect(sourceLinkpath(m.source)).toBe("Notes/Replay");
		expect(sourceFromFrontmatter([["Notes/Replay"]])).toBe("Notes/Replay");
		expect(body.trim()).toBe("# T");
	});
	it("keeps the existing block when the body is replaced", () => {
		const raw = composeFrontMatter(meta) + placeholderBody("T");
		expect(frontMatterBlock(raw)).toBe(composeFrontMatter(meta));
		expect(withBody(raw, "", "# New\n")).toBe(composeFrontMatter(meta) + "# New\n");
		expect(withBody("no front matter", "---\na: b\n---\n\n", "x")).toBe("---\na: b\n---\n\nx");
	});
	it("knows a grown page", () => {
		expect(isGrownPage({ question: "q", source: "[[a]]", mode: "deep-dive" })).toBe(true);
		expect(isGrownPage({ question: "q", source: [["a"]], mode: "new-page" })).toBe(true);
		expect(isGrownPage({ question: "q", mode: "new-page" })).toBe(false);
		expect(isGrownPage({ question: "", source: "[[a]]", mode: "new-page" })).toBe(false);
		expect(isGrownPage(undefined)).toBe(false);
	});
});

describe("streamed body", () => {
	it("finds an H1 on the first line only", () => {
		expect(firstH1("# A title\n\ntext")).toBe("A title");
		expect(firstH1("\n\n# A title  \ntext")).toBe("A title");
		expect(firstH1("## Not it\n")).toBeNull();
		expect(firstH1("text\n# later")).toBeNull();
		expect(firstH1("#nospace")).toBeNull();
		expect(firstH1("# Only")).toBe("Only");
	});
	it("shows the placeholder until text arrives", () => {
		expect(bodyFromText("", "T")).toBe("# T\n\n*Writing…*\n");
		expect(bodyFromText("  \n", "T")).toBe("# T\n\n*Writing…*\n");
	});
	it("uses the model's own H1, or puts text under the title", () => {
		expect(bodyFromText("# Mine\n\npara", "T")).toBe("# Mine\n\npara");
		expect(bodyFromText("\n\npara", "T")).toBe("# T\n\npara");
	});
});

describe("endings", () => {
	it("finishes cleanly", () => {
		expect(finishBody("# Mine\n\npara\n\n", "T", { kind: "done" })).toBe("# Mine\n\npara\n");
	});
	it("adds a warning callout when truncated", () => {
		const out = finishBody("# Mine\n\npara", "T", { kind: "truncated" });
		expect(out).toContain("para\n\n> [!warning] This page stopped early\n> The answer hit its length limit.");
		expect(out).toContain('Run "Regenerate this page"');
	});
	it("keeps heading and explains a failure with no text", () => {
		const out = finishBody("", "T", { kind: "error", message: "Bad key\nsecond line" });
		expect(out).toBe(
			'# T\n\n> [!failure] This page failed to generate\n> Bad key\n> second line\n> Run "Regenerate this page" to try again.\n',
		);
	});
	it("keeps what arrived when it fails part way", () => {
		const out = finishBody("# Mine\n\nhalf", "T", { kind: "error", message: "" });
		expect(out.startsWith("# Mine\n\nhalf\n\n> [!failure]")).toBe(true);
		expect(out).toContain("Something went wrong.");
	});
});

describe("linking the phrase", () => {
	const doc = "---\ntitle: x\n---\n\nThe sharp-wave ripples replay days.\n\nSecond line has sharp-wave ripples too.\n";
	it("links a plain phrase", () => {
		const p = planPhraseLink(doc, "sharp-wave ripples", "The sharp-wave ripples replay days.");
		expect(p.ok).toBe(true);
		if (!p.ok) return;
		expect(p.text).toBe("sharp-wave ripples");
		expect(linkPhraseAt(doc, p.from, p.to, "[[Ripples|sharp-wave ripples]]")).toContain("The [[Ripples|sharp-wave ripples]] replay days.");
	});
	it("prefers the saved paragraph", () => {
		const p = planPhraseLink(doc, "sharp-wave ripples", "Second line has sharp-wave ripples too.");
		expect(p.ok && doc.slice(0, p.from).endsWith("Second line has ")).toBe(true);
	});
	it("matches across a line wrap tolerance but refuses multi-line", () => {
		const wrapped = "A phrase that\nwraps here.";
		const p = planPhraseLink(wrapped, "phrase that wraps", "");
		expect(p).toEqual({ ok: false, reason: "the phrase runs across more than one line" });
	});
	it("fails when the phrase is gone", () => {
		expect(planPhraseLink("nothing here", "missing", "")).toEqual({ ok: false, reason: "the phrase is no longer in the note as written" });
	});
	const can = (d: string, w: string) => {
		const i = d.indexOf(w);
		return canLinkPhrase(d, i, i + w.length);
	};
	it("refuses phrases that would break", () => {
		expect(can("a [[x]] b", "[[x]]").ok).toBe(false);
		expect(can("a **bold** b", "**bold**").ok).toBe(false);
		expect(can("a *it* b", "a *it").ok).toBe(false);
		expect(can("snake_case here", "snake_case").ok).toBe(false);
		expect(can("a ==hl== b", "==hl==").ok).toBe(false);
		expect(can("a b | c", "b | c").ok).toBe(false);
		expect(can("see [text](url) now", "text](url").ok).toBe(false);
	});
	it("refuses phrases already inside a link, code or the front matter", () => {
		expect(can("a [[Page|some words]] b", "some words")).toEqual({ ok: false, reason: "the phrase is already part of a link" });
		expect(can("a [some words](u) b", "some words").ok).toBe(false);
		expect(can("a [[Some words]] b", "Some words").ok).toBe(false);
		expect(can("call `some words` now", "some words")).toEqual({ ok: false, reason: "the phrase is inside code" });
		expect(can("---\ntitle: some words\n---\nbody", "some words")).toEqual({ ok: false, reason: "the phrase is in the note's properties" });
		expect(can('a <a title="some words">x</a>', "some words").ok).toBe(false);
	});
	it("allows a phrase beside a link and with ordinary punctuation", () => {
		expect(can("see [[Page]] and some words, then more", "some words").ok).toBe(true);
		expect(can("it's (really) fine", "it's (really) fine").ok).toBe(true);
	});
	it("keeps the alias Obsidian dropped", () => {
		expect(withAlias("[[Ripples|words]]", "Ripples", "words")).toBe("[[Ripples|words]]");
		expect(withAlias("[[Ripples]]", "Ripples", "ripples")).toBe("[[Ripples|ripples]]");
		expect(withAlias("[words](Ripples.md)", "Ripples", "words")).toBe("[words](Ripples.md)");
	});
	it("updates a saved paragraph so the answer still finds it", () => {
		expect(paragraphWithLink("The sharp ripples replay.", "sharp ripples", "[[R|sharp ripples]]")).toBe("The [[R|sharp ripples]] replay.");
		expect(paragraphWithLink("Nothing here", "absent", "[[R]]")).toBe("Nothing here");
	});
});

describe("page state", () => {
	it("tracks writing, done, unread and read", () => {
		let s = markWriting(emptyPageState(), "a.md");
		expect(s.writing).toEqual(["a.md"]);
		s = markDone(s, "a.md", true);
		expect(s).toEqual({ unread: ["a.md"], writing: [], failed: {} });
		expect(markDone(s, "a.md", true).unread).toEqual(["a.md"]);
		s = markRead(s, "a.md");
		expect(s.unread).toEqual([]);
		expect(markRead(s, "a.md")).toBe(s);
	});
	it("marks failed and clears it on a new write", () => {
		let s = markFailed(markWriting(emptyPageState(), "a.md"), "a.md", "boom");
		expect(s).toEqual({ unread: [], writing: [], failed: { "a.md": "boom" } });
		s = markWriting(s, "a.md");
		expect(s.failed).toEqual({});
		expect(markDone(markFailed(s, "a.md", "x"), "a.md", false).failed).toEqual({});
	});
	it("follows renames, of files and folders", () => {
		let s: PageState = { unread: ["A/x.md", "B/y.md"], writing: ["A/w.md"], failed: { "A/f.md": "e" } };
		s = renamePage(s, "A", "C");
		expect(s).toEqual({ unread: ["C/x.md", "B/y.md"], writing: ["C/w.md"], failed: { "C/f.md": "e" } });
		s = renamePage(s, "B/y.md", "B/z.md");
		expect(s.unread).toEqual(["C/x.md", "B/z.md"]);
		expect(renamePage(s, "q", "q")).toBe(s);
		expect(renamePage(s, "AA", "D").unread).toEqual(s.unread);
	});
	it("drops deleted files and folders", () => {
		const s = { unread: ["A/x.md", "B/y.md", "AA.md"], writing: ["A/w.md"], failed: { "A/f.md": "e", "B/g.md": "e" } };
		expect(deletePage(s, "A")).toEqual({ unread: ["B/y.md", "AA.md"], writing: [], failed: { "B/g.md": "e" } });
		expect(deletePage(s, "B/y.md").unread).toEqual(["A/x.md", "AA.md"]);
	});
	it("reads saved data and fails what was being written", () => {
		expect(sanitizePageState(undefined)).toEqual(emptyPageState());
		expect(sanitizePageState("junk")).toEqual(emptyPageState());
		const s = sanitizePageState({ unread: ["a.md", "a.md", 3], writing: ["w.md"], failed: { "f.md": "e", "g.md": 4 } });
		expect(s.unread).toEqual(["a.md"]);
		expect(s.writing).toEqual([]);
		expect(s.failed).toEqual({ "f.md": "e", "w.md": "Writing was interrupted." });
	});
	it("words the status bar", () => {
		expect(statusText([], 0)).toBe("");
		expect(statusText(["Why"], 2)).toBe("Writing Why…");
		expect(statusText(["Why"], 0, "Reading a.md")).toBe("Writing Why… Reading a.md");
		expect(statusText(["a", "b"], 0, "x")).toBe("Writing 2 pages…");
		expect(statusText([], 1)).toBe("1 unread page");
		expect(statusText([], 3)).toBe("3 unread pages");
	});
});

describe("page settings", () => {
	it("has defaults", () => {
		expect(DEFAULT_SETTINGS.pages).toEqual({
			location: "beside",
			folder: "Nested",
			fileNames: "readable",
			linkPhrase: true,
			newPageOpens: "split",
			deepDiveOpens: "background",
		});
		expect(mergeSettings({}).pages).toEqual(DEFAULT_SETTINGS.pages);
	});
	it("keeps good saved values and repairs bad ones", () => {
		const s = mergeSettings({ pages: { location: "folder", folder: "/Out//Here/", fileNames: "slug", linkPhrase: false, newPageOpens: "tab", deepDiveOpens: "nope" } });
		expect(s.pages).toEqual({
			location: "folder",
			folder: "Out/Here",
			fileNames: "slug",
			linkPhrase: false,
			newPageOpens: "tab",
			deepDiveOpens: "background",
		});
		expect(mergeSettings({ pages: { location: "elsewhere", fileNames: "x" } }).pages.location).toBe("beside");
		expect(mergeSettings({ pages: { location: "elsewhere", fileNames: "x" } }).pages.fileNames).toBe("readable");
	});
});
