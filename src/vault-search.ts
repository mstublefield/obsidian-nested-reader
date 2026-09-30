// Pure line search over notes, ported from upstream's tools.rs. Must not import "obsidian".
import { queryTerms, rankByRelevance } from "./lib/rank";
import { clipText } from "./vault-rules";

export const MAX_HITS = 60;
export const PER_PAGE_HITS = 6;
export const MAX_LINE_CHARS = 240;
/** Enough matches to stop scanning: the answer shows at most `MAX_HITS`. */
export const ENOUGH_LINES = 300;
export const ENOUGH_FILES = 80;

export type Hit = { line: number; text: string };
export type Scan = { verbatim: Hit[]; loose: Hit[] };

/** Lines holding the whole query, and, for a multi-word query, lines holding any of its words. */
export function scanLines(raw: string, query: string, terms: string[]): Scan {
	const q = query.trim().toLowerCase();
	const scan: Scan = { verbatim: [], loose: [] };
	if (!q) return scan;
	const lines = raw.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const lower = lines[i].toLowerCase();
		if (lower.includes(q)) scan.verbatim.push({ line: i + 1, text: lines[i] });
		if (terms.length > 1 && terms.some((t) => lower.includes(t))) scan.loose.push({ line: i + 1, text: lines[i] });
	}
	return scan;
}

export function searchTerms(query: string): string[] {
	return queryTerms(query.trim().toLowerCase());
}

export type Candidate = { path: string; title: string; body: string } & Scan;

export type FormatOptions = {
	/** Candidates are already in the order to show (for example, by Omnisearch's score). */
	ordered?: boolean;
	/** The scan stopped early, so there may be more matches than were counted. */
	partial?: boolean;
};

/**
 * Builds the `search_pages` answer. A line holding the query as typed counts; a multi-word query
 * nobody wrote down verbatim falls back to its separate words and says so. Lines come back a few
 * per page before any page gets a second turn, best pages first.
 */
export function formatSearch(query: string, candidates: Candidate[], opts: FormatOptions = {}): string {
	const shown = query.trim();
	const terms = searchTerms(query);
	const anyVerbatim = candidates.some((c) => c.verbatim.length > 0);
	const loose = !anyVerbatim && terms.length > 1;
	const hitsOf = (c: Candidate) => (loose ? c.loose : c.verbatim);
	const withHits = candidates.filter((c) => hitsOf(c).length > 0);
	if (!withHits.length) return `No note mentions “${shown}”.`;

	let order = withHits;
	if (!opts.ordered) {
		const ranked = rankByRelevance(terms, withHits, (c) => c.body, (c) => c.title);
		// Ranking drops pages with no stemmed-word overlap (a substring hit such as "sleep" in
		// "sleeper"); they still matched, so they follow the ranked ones in their original order.
		const seen = new Set(ranked);
		order = [...ranked, ...withHits.filter((c) => !seen.has(c))];
	}

	const total = order.reduce((n, c) => n + hitsOf(c).length, 0);
	const taken = new Map<Candidate, number>();
	const hits: string[] = [];
	for (const cap of [PER_PAGE_HITS, Infinity]) {
		for (const c of order) {
			const list = hitsOf(c);
			let n = taken.get(c) ?? 0;
			while (n < cap && n < list.length && hits.length < MAX_HITS) {
				hits.push(`${c.path}:${list[n].line}: ${clipText(list[n].text.trim(), MAX_LINE_CHARS)}`);
				n++;
			}
			taken.set(c, n);
		}
	}

	let out = "";
	if (loose) out += `No line holds “${shown}” word for word; these hold some of its words.\n\n`;
	out += hits.join("\n");
	if (total > hits.length || opts.partial) {
		out += `\n\n[${opts.partial ? "More" : `${total - hits.length} more`} matching lines not shown; narrow the query.]`;
	}
	return out;
}
