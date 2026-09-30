// Pure helpers for what goes in a new page's file. Must not import "obsidian".

export type PageMode = "new-page" | "deep-dive";

export type PageMeta = {
	title: string;
	/** What to put inside the `[[ ]]` of the `source` property: the parent's link text. */
	sourceLink: string;
	question: string;
	created: string;
	mode: PageMode;
};

/** A double-quoted YAML scalar. JSON strings are valid YAML, and `parseFrontMatter` reads them back. */
function quote(v: string): string {
	return JSON.stringify(v);
}

/**
 * The front matter block, keys in upstream's order. Text values are always quoted, so `[[Parent]]`
 * stays a string instead of being read as a nested list.
 */
export function composeFrontMatter(meta: PageMeta): string {
	const lines = [
		`title: ${quote(meta.title)}`,
		`source: ${quote(`[[${meta.sourceLink}]]`)}`,
		`question: ${quote(meta.question)}`,
		`created: ${meta.created}`,
		`mode: ${meta.mode}`,
	];
	return `---\n${lines.join("\n")}\n---\n\n`;
}

/** The heading of the first line of `text`, when that line is a level-1 heading. */
export function firstH1(text: string): string | null {
	const m = /^\s*#[ \t]+(\S[^\n]*?)[ \t]*(?:\n|$)/.exec(text);
	return m ? m[1].replace(/\s+#+$/, "").trim() || null : null;
}

export const WRITING_NOTE = "*Writing…*";

/** The body before anything has arrived. */
export function placeholderBody(title: string): string {
	return `# ${title}\n\n${WRITING_NOTE}\n`;
}

/** A streamed body: the model's own heading stands in for the placeholder; text without one goes under the title. */
export function bodyFromText(text: string, title: string): string {
	if (!text.trim()) return placeholderBody(title);
	return firstH1(text) ? `${text.replace(/^\s+/, "")}` : `# ${title}\n\n${text.replace(/^\s+/, "")}`;
}

export type Ending = { kind: "done" } | { kind: "truncated" } | { kind: "error"; message: string };

function callout(type: string, title: string, lines: string[]): string {
	return [`> [!${type}] ${title}`, ...lines.flatMap((l) => l.split(/\r?\n/)).map((l) => (l ? `> ${l}` : ">"))].join("\n");
}

export const TRUNCATED_LINES = [`The answer hit its length limit. Run "Regenerate this page" or raise the length in settings.`];

/** The finished body: the text, plus a callout saying why it stops short or why it failed. */
export function finishBody(text: string, title: string, ending: Ending): string {
	const body = bodyFromText(text, title).replace(/\s+$/, "");
	const hasText = !!text.trim();
	const base = hasText ? body : `# ${title}`;
	if (ending.kind === "done") return `${base}\n`;
	if (ending.kind === "truncated") return `${base}\n\n${callout("warning", "This page stopped early", TRUNCATED_LINES)}\n`;
	const msg = ending.message.trim() || "Something went wrong.";
	return `${base}\n\n${callout("failure", "This page failed to generate", [msg, `Run "Regenerate this page" to try again.`])}\n`;
}

/** The front matter block of a file's text, exactly as written ("" when there is none). */
export function frontMatterBlock(raw: string): string {
	const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?(?:\r?\n)?/.exec(raw);
	return m ? m[0] : "";
}

/** The next text for a page file: its current front matter kept as it is, with a new body. */
export function withBody(raw: string, fallbackFrontMatter: string, body: string): string {
	const block = frontMatterBlock(raw) || fallbackFrontMatter;
	return block + body;
}

/** The question-and-mode check for "Regenerate this page": true when the front matter says how the page was made. */
export function isGrownPage(fm: Record<string, unknown> | undefined): boolean {
	if (!fm) return false;
	const q = fm.question;
	return typeof q === "string" && q.trim() !== "" && fm.source != null && (fm.mode === "new-page" || fm.mode === "deep-dive");
}
