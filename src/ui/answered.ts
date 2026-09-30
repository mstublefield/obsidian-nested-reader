import { type Extension, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, type MarkdownPostProcessorContext } from "obsidian";
import { applyWraps, type Wrap } from "../lib/wraps";
import { dropOverlaps, locatePhrase, planReadingWrap } from "../reader/locate";
import type { SavedAsk } from "../store/answers-core";

export const ANSWERED_CLASS = "nr-answered";
export const ASK_ATTR = "data-nr-ask";

/** What the underlining needs from the plugin. */
export type AnsweredHost = {
	enabled(): boolean;
	list(path: string): readonly SavedAsk[];
	/** An ask with a card open is not underlined until the card closes. */
	isOpen(id: string): boolean;
};

/** Dispatched to every open editor when the saved asks or the setting changed. */
export const answersChanged = StateEffect.define<null>();

function build(host: AnsweredHost, view: ViewUpdate["view"]): DecorationSet {
	if (!host.enabled()) return Decoration.none;
	const path = view.state.field(editorInfoField, false)?.file?.path;
	if (!path) return Decoration.none;
	const asks = host.list(path).filter((a) => !host.isOpen(a.id));
	if (!asks.length) return Decoration.none;
	const doc = view.state.doc.toString();
	const spans: { start: number; end: number; ask: SavedAsk }[] = [];
	for (const ask of asks) {
		const hit = locatePhrase(doc, ask.text, ask.paragraph);
		if (hit) spans.push({ start: hit.from, end: hit.to, ask });
	}
	return Decoration.set(
		dropOverlaps(spans).map((s) =>
			Decoration.mark({ class: ANSWERED_CLASS, attributes: { [ASK_ATTR]: s.ask.id } }).range(s.start, s.end),
		),
		true,
	);
}

/**
 * Live Preview and source mode: marks each remembered phrase. The note's path comes from
 * Obsidian's `editorInfoField` in the editor state, so each view knows its own file.
 */
export function answeredExtension(host: AnsweredHost): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: ViewUpdate["view"]) {
				this.decorations = build(host, view);
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(answersChanged)))) {
					this.decorations = build(host, u.view);
				}
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

/** Reading view: wraps each remembered phrase found in this rendered section. */
export function markAnswered(host: AnsweredHost, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
	if (!host.enabled()) return;
	const asks = host.list(ctx.sourcePath).filter((a) => !host.isOpen(a.id));
	if (!asks.length) return;
	const info = ctx.getSectionInfo(el);
	const section = info ? { docText: info.text, lineStart: info.lineStart, lineEnd: info.lineEnd } : null;
	const text = el.textContent ?? "";
	const wraps: (Wrap & { ask: SavedAsk })[] = [];
	for (const ask of asks) {
		const hit = planReadingWrap(ask, text, section);
		if (hit) {
			wraps.push({ start: hit.from, end: hit.to, className: ANSWERED_CLASS, attrs: { [ASK_ATTR]: ask.id }, ask });
		}
	}
	// Offsets are over textContent, which wrapping does not change, so they all stay valid.
	applyWraps(el, dropOverlaps(wraps));
}
