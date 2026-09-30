// Pure helpers for finding a saved phrase again. Must not import "obsidian".

export type Span = { from: number; to: number };

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A regex matching `text` with any run of whitespace standing for the gaps, or null for blank text. */
function tolerant(text: string): RegExp | null {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (!words.length) return null;
	return new RegExp(words.map(escapeRe).join("\\s+"), "g");
}

/** The first whitespace-tolerant occurrence of `text` in `doc` that lies within [from, to]. */
function findWithin(doc: string, text: string, from: number, to: number): Span | null {
	const re = tolerant(text);
	if (!re) return null;
	re.lastIndex = from;
	const m = re.exec(doc);
	if (!m || m.index + m[0].length > to) return null;
	return { from: m.index, to: m.index + m[0].length };
}

/**
 * Where a remembered phrase is in a document now. Prefers an occurrence inside the saved paragraph
 * when that paragraph still exists, else the first occurrence anywhere. Runs of whitespace match
 * each other, because the saved text was whitespace-collapsed.
 */
export function locatePhrase(doc: string, text: string, paragraph: string): Span | null {
	if (paragraph.trim()) {
		const para = findWithin(doc, paragraph, 0, doc.length);
		if (para) {
			const inside = findWithin(doc, text, para.from, para.to);
			if (inside) return inside;
		}
	}
	return findWithin(doc, text, 0, doc.length);
}

/** The document offsets covered by lines `lineStart`..`lineEnd` (inclusive, zero-based) of `text`. */
export function lineRangeOffsets(text: string, lineStart: number, lineEnd: number): Span {
	let from = 0;
	for (let i = 0; i < lineStart; i++) {
		const nl = text.indexOf("\n", from);
		if (nl < 0) return { from: text.length, to: text.length };
		from = nl + 1;
	}
	let to = from;
	for (let i = lineStart; i <= lineEnd; i++) {
		const nl = text.indexOf("\n", to);
		if (nl < 0) return { from, to: text.length };
		to = i === lineEnd ? nl : nl + 1;
	}
	return { from, to };
}

export type SectionSource = { docText: string; lineStart: number; lineEnd: number };

/**
 * Which characters of a Reading view section's text to underline for one saved phrase, as offsets
 * into the section's `textContent`, or null when the phrase is not in this section.
 *
 * With the section's source lines, the phrase is located in the whole note first, so it is marked
 * only in the section that holds that occurrence. When the phrase is not in the source as typed
 * (it spans formatting), the section is used only if it contains the saved paragraph.
 */
export function planReadingWrap(
	ask: { text: string; paragraph: string },
	elText: string,
	section?: SectionSource | null,
): Span | null {
	if (section) {
		const hit = locatePhrase(section.docText, ask.text, ask.paragraph);
		if (hit) {
			const range = lineRangeOffsets(section.docText, section.lineStart, section.lineEnd);
			if (hit.from < range.from || hit.to > range.to) return null;
			return locatePhrase(elText, ask.text, ask.paragraph);
		}
	}
	const para = ask.paragraph.trim() ? findWithin(elText, ask.paragraph, 0, elText.length) : null;
	if (!para) return null;
	return findWithin(elText, ask.text, para.from, para.to);
}

/** Drops ranges that overlap an earlier (by start) one, so spans never nest. */
export function dropOverlaps<T extends { start: number; end: number }>(ranges: T[]): T[] {
	const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
	const out: T[] = [];
	let edge = -1;
	for (const r of sorted) {
		if (r.start < edge) continue;
		out.push(r);
		edge = r.end;
	}
	return out;
}
