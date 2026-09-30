import type { EditorView } from "@codemirror/view";
import { newAskRecord } from "../ask-record";
import { quickAsk } from "../ask";
import type NestedReaderPlugin from "../main";
import type { AskTarget } from "../reader/target";
import { AnswerCard } from "./answer-card";
import { cmView, placeCard, unplaceCard } from "./card-host";

type Open = { card: AnswerCard; remove: () => void };

/** Creates cards, puts them under their paragraph, and tears them down on close or unload. */
export class CardManager {
	private open = new Map<string, Open>();

	constructor(private plugin: NestedReaderPlugin) {}

	ask(target: AskTarget): void {
		const record = newAskRecord(crypto.randomUUID(), target.file.path, target.text, target.paragraph);
		const card = new AnswerCard({
			app: this.plugin.app,
			record,
			run: ({ record: r, question, handlers, signal }) =>
				quickAsk(this.plugin, target, r, question, handlers, signal),
			onClose: (c) => this.close(c.id),
		});
		let remove: () => void;
		if (target.mode === "source") {
			const view: EditorView | null = cmView(target.editor);
			if (!view) {
				card.dispose();
				return;
			}
			placeCard(view, target.anchor, card);
			remove = () => unplaceCard(view, card.id);
		} else {
			target.block.insertAdjacentElement("afterend", card.el);
			remove = () => card.el.remove();
		}
		this.open.set(card.id, { card, remove });
		card.focusInput();
	}

	close(id: string): void {
		const entry = this.open.get(id);
		if (!entry) return;
		this.open.delete(id);
		entry.remove();
		entry.card.dispose();
	}

	closeAll(): void {
		for (const id of [...this.open.keys()]) this.close(id);
	}
}
