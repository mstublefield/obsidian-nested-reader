// Pure helpers for finding the block a selection sits in. Must not import "obsidian".

const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const FENCE = /^\s{0,3}(```|~~~)/;
const ITEM = /^\s*([-*+]|\d+[.)])\s/;

function isBlank(s: string): boolean {
	return s.trim() === "";
}

/** The [from, to] line ranges of fenced code blocks, fences included. An unclosed fence runs to the end. */
function fenceRanges(lines: string[]): [number, number][] {
	const out: [number, number][] = [];
	let open: { from: number; mark: string } | null = null;
	lines.forEach((line, i) => {
		const m = FENCE.exec(line);
		if (!m) return;
		if (!open) open = { from: i, mark: m[1] };
		else if (m[1] === open.mark) {
			out.push([open.from, i]);
			open = null;
		}
	});
	if (open) out.push([(open as { from: number }).from, lines.length - 1]);
	return out;
}

/**
 * The lines of the block around `line`: a paragraph, one list item (with its wrapped lines), a whole
 * fenced code block, or a single heading. Blocks end at a blank line, a heading or a fence. Inclusive.
 */
export function paragraphAround(lines: string[], line: number): { from: number; to: number } {
	if (lines.length === 0) return { from: 0, to: 0 };
	const at = Math.min(Math.max(line, 0), lines.length - 1);
	const fences = fenceRanges(lines);
	const fenced = fences.find(([a, b]) => at >= a && at <= b);
	if (fenced) return { from: fenced[0], to: fenced[1] };
	if (isBlank(lines[at]) || HEADING.test(lines[at])) return { from: at, to: at };
	const inFence = (i: number) => fences.some(([a, b]) => i >= a && i <= b);
	const edge = (i: number) => isBlank(lines[i]) || HEADING.test(lines[i]) || inFence(i);
	let from = at;
	while (from > 0 && !ITEM.test(lines[from]) && !edge(from - 1)) from--;
	let to = at;
	while (to + 1 < lines.length && !edge(to + 1) && !ITEM.test(lines[to + 1])) to++;
	return { from, to };
}
