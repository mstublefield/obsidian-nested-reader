import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { addCardEffect, cardExtension, cardIds } from "../src/ui/card-host";
import type { AnswerCard } from "../src/ui/answer-card";

// A stand-in card: the field only needs its id (and the element the widget hands to CodeMirror).
const card = (id: string) => ({ id, el: null }) as unknown as AnswerCard;

function withCard(doc: string, pos: number, id: string): EditorState {
	const state = EditorState.create({ doc, extensions: cardExtension() });
	return state.update({ effects: addCardEffect.of({ pos, card: card(id) }) }).state;
}

describe("answer cards in the editor state", () => {
	it("holds a placed card", () => {
		expect([...cardIds(withCard("first paragraph\n\nsecond", 15, "a"))]).toEqual(["a"]);
	});

	it("keeps the card when text elsewhere changes", () => {
		const s = withCard("first paragraph\n\nsecond", 15, "a");
		const next = s.update({ changes: { from: s.doc.length, insert: " more" } }).state;
		expect(cardIds(next).has("a")).toBe(true);
	});

	// The leak: deleting text around the anchor drops the widget from the editor, but nothing told the
	// card manager, which kept the card (and its running stream) alive. cardIds lets it notice.
	it("loses the card when the text around its anchor is deleted", () => {
		const s = withCard("first paragraph\n\nsecond", 15, "a");
		const next = s.update({ changes: { from: 0, to: 20 } }).state;
		expect(cardIds(next).has("a")).toBe(false);
	});

	it("has no cards in a fresh state, as when the tab switches to another note", () => {
		const fresh = EditorState.create({ doc: "another note", extensions: cardExtension() });
		expect(cardIds(fresh).size).toBe(0);
	});
});
