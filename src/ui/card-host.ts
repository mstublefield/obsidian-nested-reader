import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { Editor } from "obsidian";
import type { AnswerCard } from "./answer-card";

/** Holds the card's own element, so streaming updates mutate it and CodeMirror never rebuilds it. */
class CardWidget extends WidgetType {
	constructor(readonly card: AnswerCard) {
		super();
	}
	eq(other: CardWidget): boolean {
		return other.card.id === this.card.id;
	}
	toDOM(): HTMLElement {
		return this.card.el;
	}
	// The card handles its own keys and clicks; the editor must not see typing in the input.
	ignoreEvent(): boolean {
		return true;
	}
}

export const addCardEffect = StateEffect.define<{ pos: number; card: AnswerCard }>();
const addCard = addCardEffect;
const removeCard = StateEffect.define<string>();

/** Block decorations must come from a StateField (not a ViewPlugin). */
const cardField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decos, tr) {
		decos = decos.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(addCard)) {
				const widget = Decoration.widget({ widget: new CardWidget(e.value.card), block: true, side: 1 });
				decos = decos.update({ add: [widget.range(Math.min(e.value.pos, tr.state.doc.length))] });
			} else if (e.is(removeCard)) {
				const id = e.value;
				decos = decos.update({ filter: (_f, _t, v) => (v.spec as { widget?: CardWidget }).widget?.card.id !== id });
			}
		}
		return decos;
	},
	provide: (f) => EditorView.decorations.from(f),
});

/** Ids of the cards that are actually in this editor state. */
export function cardIds(state: EditorState): Set<string> {
	const ids = new Set<string>();
	const decos = state.field(cardField, false);
	decos?.between(0, state.doc.length, (_f, _t, v) => {
		const id = (v.spec as { widget?: CardWidget }).widget?.card.id;
		if (id) ids.add(id);
	});
	return ids;
}

/**
 * Register once with `plugin.registerEditorExtension`. Each editor view keeps its own cards.
 * `onDropped` hears about a card an edit removed (text around its anchor deleted), so the card
 * manager can close it instead of holding it, and its running stream, forever.
 */
export function cardExtension(onDropped?: () => void): Extension {
	if (!onDropped) return cardField;
	return [
		cardField,
		EditorView.updateListener.of((u) => {
			if (!u.docChanged) return;
			const before = cardIds(u.startState);
			if (!before.size) return;
			const after = cardIds(u.state);
			for (const id of before) if (!after.has(id)) return onDropped();
		}),
	];
}

/**
 * `editor.cm` is how plugins reach an Obsidian editor's CodeMirror 6 view. It is not in the typings
 * (`editorEditorField` only works from inside an extension), so it is read through this typed accessor.
 */
export function cmView(editor: Editor): EditorView | null {
	return (editor as unknown as { cm?: EditorView }).cm ?? null;
}

export function placeCard(view: EditorView, pos: number, card: AnswerCard): void {
	view.dispatch({ effects: addCard.of({ pos, card }) });
}

export function unplaceCard(view: EditorView, id: string): void {
	view.dispatch({ effects: removeCard.of(id) });
}
