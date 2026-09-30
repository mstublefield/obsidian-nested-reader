// Pure helpers for turning the highlighted words into a link to the new page. Must not import "obsidian".
import { locatePhrase } from "../reader/locate";

export type CanLink = { ok: true } | { ok: false; reason: string };
export type LinkPlan = { ok: true; from: number; to: number; text: string } | { ok: false; reason: string };

const no = (reason: string): CanLink => ({ ok: false, reason });

/** Spans `[from, to)` of each `[[...]]` and `[text](url)` on a line. */
function linkSpans(line: string): [number, number][] {
	const out: [number, number][] = [];
	for (const re of [/\[\[[^\]]*\]\]/g, /!?\[[^\]]*\]\([^)]*\)/g, /<[^>]+>/g]) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(line))) out.push([m.index, m.index + m[0].length]);
	}
	return out;
}

/** The end of a front matter block at the start of `doc`, or 0. */
function frontMatterEnd(doc: string): number {
	const m = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(doc);
	return m ? m[0].length : 0;
}

/**
 * Whether the words at `doc[from, to)` can become the alias of a link without breaking the note:
 * one line, no link or formatting characters of their own, not already inside a link, code or the
 * front matter.
 */
export function canLinkPhrase(doc: string, from: number, to: number): CanLink {
	const slice = doc.slice(from, to);
	if (!slice.trim()) return no("there is nothing to link");
	if (/[\r\n]/.test(slice)) return no("the phrase runs across more than one line");
	if (slice.includes("[[") || slice.includes("]]") || /[[\]]/.test(slice)) return no("the phrase already contains link brackets");
	if (/[*_`|]|==|~~/.test(slice)) return no("the phrase contains formatting or characters that would break a link");
	if (from < frontMatterEnd(doc)) return no("the phrase is in the note's properties");
	const lineStart = doc.lastIndexOf("\n", from - 1) + 1;
	const lineEndAt = doc.indexOf("\n", to);
	const line = doc.slice(lineStart, lineEndAt < 0 ? doc.length : lineEndAt);
	const a = from - lineStart;
	const b = to - lineStart;
	if (linkSpans(line).some(([s, e]) => a < e && b > s)) return no("the phrase is already part of a link");
	if ((line.slice(0, a).match(/`/g) ?? []).length % 2 === 1) return no("the phrase is inside code");
	return { ok: true };
}

/** `doc` with `[from, to)` replaced by `link`. */
export function linkPhraseAt(doc: string, from: number, to: number, link: string): string {
	return doc.slice(0, from) + link + doc.slice(to);
}

/** Finds the phrase (preferring its saved paragraph) and checks it can be linked. */
export function planPhraseLink(doc: string, phrase: string, paragraph: string): LinkPlan {
	const hit = locatePhrase(doc, phrase, paragraph);
	if (!hit) return { ok: false, reason: "the phrase is no longer in the note as written" };
	const can = canLinkPhrase(doc, hit.from, hit.to);
	return can.ok ? { ok: true, from: hit.from, to: hit.to, text: doc.slice(hit.from, hit.to) } : can;
}

/**
 * Makes sure a link built by Obsidian shows `phrase`: a wikilink that dropped its alias (because the
 * alias equalled the link text, or differed only in case) is rebuilt as `[[linktext|phrase]]`.
 */
export function withAlias(link: string, linktext: string, phrase: string): string {
	if (link.includes(phrase)) return link;
	return link.startsWith("[[") ? `[[${linktext}|${phrase}]]` : link;
}

/** The saved paragraph with the phrase's source text replaced by the link, so the saved answer still finds its place. */
export function paragraphWithLink(paragraph: string, sourceText: string, link: string): string {
	const i = paragraph.indexOf(sourceText);
	return i < 0 ? paragraph : linkPhraseAt(paragraph, i, i + sourceText.length, link);
}
