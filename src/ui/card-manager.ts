import type { EditorView } from "@codemirror/view";
import type { MarkdownView } from "obsidian";
import { newAskRecord, type AskRecord } from "../ask-record";
import { quickAsk } from "../ask";
import type NestedReaderPlugin from "../main";
import type { AskTarget } from "../reader/target";
import { recordToSaved, shouldRemember } from "../store/answers-core";
import { AnswerCard } from "./answer-card";
import { cardIds, cmView, placeCard, unplaceCard } from "./card-host";

type Open = {
	card: AnswerCard;
	remove: () => void;
	path: string;
	/** Where the card lives, so a dropped host can be noticed. */
	alive: () => boolean;
	/** The Reading view element the card sits in, for telling which view holds it. */
	previewEl: HTMLElement | null;
};

const SWEEP_MS = 300;

/** Creates cards, puts them under their paragraph, and tears them down on close, unload or loss of their host. */
export class CardManager {
	private open = new Map<string, Open>();
	private sweepTimer = 0;
	/** Cards whose place on the page is gone but whose answer is still streaming; see AnswerCard.releaseWhenDone. */
	private background = new Set<AnswerCard>();

	constructor(private plugin: NestedReaderPlugin) {}

	/** Opens a card for `target`: a new ask, or (with `seed`) a saved one continued from its thread. */
	ask(target: AskTarget, seed?: AskRecord): void {
		const record = seed ?? newAskRecord(crypto.randomUUID(), target.file.path, target.text, target.paragraph);
		if (seed) seed.paragraph = target.paragraph;
		const path = target.file.path;
		const card = new AnswerCard({
			app: this.plugin.app,
			record,
			run: ({ record: r, question, handlers, signal }) =>
				quickAsk(this.plugin, target, r, question, handlers, signal),
			onClose: (c) => this.close(c.id),
			onPage: (mode, question, followUp) => {
				void this.plugin.pages.grow({
					parent: target.file,
					question,
					selection: target.text,
					paragraph: target.paragraph,
					mode,
				});
				// A page from the ask box closes it; a follow-up page leaves the card and its answers.
				if (!followUp) this.close(record.id);
			},
			onTurn: (r) => {
				if (this.plugin.settings.rememberAnswers && shouldRemember(r)) {
					this.plugin.answers.upsert(path, recordToSaved(r, Date.now()));
				}
			},
		});
		let entry: Open;
		if (target.mode === "source") {
			const view: EditorView | null = cmView(target.editor);
			if (!view) {
				card.dispose();
				return;
			}
			placeCard(view, target.anchor, card);
			// The widget's element leaves the page when scrolled out of the viewport, so watch the editor itself,
			// and the editor's state: an edit across the anchor, or the tab switching notes, drops the card from it.
			entry = {
				card,
				path,
				remove: () => unplaceCard(view, card.id),
				alive: () => view.dom.isConnected && cardIds(view.state).has(card.id),
				previewEl: null,
			};
		} else {
			target.block.insertAdjacentElement("afterend", card.el);
			entry = { card, path, remove: () => card.el.remove(), alive: () => card.el.isConnected, previewEl: card.el };
		}
		this.open.set(card.id, entry);
		card.focusInput();
	}

	has(id: string): boolean {
		return this.open.has(id);
	}

	/** Moves the caret into an open card's input. */
	focus(id: string): void {
		this.open.get(id)?.card.focusInput();
	}

	/** Ids of the asks that have a card open, so their phrases are not underlined meanwhile. */
	isOpen(id: string): boolean {
		return this.open.has(id);
	}

	/** Whether a Reading view holds an open card, which a re-render would drop. */
	hasPreviewCardIn(view: MarkdownView): boolean {
		for (const e of this.open.values()) if (e.previewEl && view.contentEl.contains(e.previewEl)) return true;
		return false;
	}

	close(id: string): void {
		const entry = this.open.get(id);
		if (!entry) return;
		this.open.delete(id);
		entry.remove();
		entry.card.dispose();
		// The phrase is underlined again now that its card is gone.
		this.plugin.refreshAnswers([entry.path]);
	}

	closeAll(): void {
		for (const id of [...this.open.keys()]) this.close(id);
		for (const card of this.background) card.dispose();
		this.background.clear();
	}

	/** A card that left the page: let a running answer finish and be saved before letting go of it. */
	private release(id: string): void {
		const entry = this.open.get(id);
		if (!entry) return;
		this.open.delete(id);
		entry.remove();
		this.background.add(entry.card);
		entry.card.releaseWhenDone(() => this.background.delete(entry.card));
		this.plugin.refreshAnswers([entry.path]);
	}

	/** Lets go of cards whose host is gone (a closed editor, a note switch, a re-rendered Reading view). */
	sweep(): void {
		for (const [id, e] of [...this.open]) if (!e.alive()) this.release(id);
	}

	/** `sweep` a moment from now, once a re-render has settled. Repeated calls share one timer. */
	scheduleSweep(): void {
		if (this.sweepTimer) return;
		this.sweepTimer = window.setTimeout(() => {
			this.sweepTimer = 0;
			this.sweep();
		}, SWEEP_MS);
	}
}
