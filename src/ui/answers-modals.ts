import { type App, Component, FuzzySuggestModal, MarkdownRenderer, Modal } from "obsidian";
import type { SavedAsk } from "../store/answers-core";

/** Lists a note's remembered answers by question; choosing one hands it to `onChoose`. */
export class AnswersPicker extends FuzzySuggestModal<SavedAsk> {
	constructor(
		app: App,
		private asks: SavedAsk[],
		private onChoose: (ask: SavedAsk) => void,
	) {
		super(app);
		this.setPlaceholder("Search answers in this note");
	}
	getItems(): SavedAsk[] {
		return this.asks;
	}
	getItemText(ask: SavedAsk): string {
		return `${ask.question || "Explain"} (${ask.text})`;
	}
	onChooseItem(ask: SavedAsk): void {
		this.onChoose(ask);
	}
}

/** Shows one remembered answer, for when its phrase can no longer be found in the note. */
export class AnswerModal extends Modal {
	private comp = new Component();
	constructor(
		app: App,
		private ask: SavedAsk,
		private path: string,
	) {
		super(app);
	}
	onOpen(): void {
		this.comp.load();
		this.setTitle(this.ask.text);
		this.contentEl.createDiv({ cls: "nr-peek-q", text: this.ask.question || "Explain" });
		const body = this.contentEl.createDiv({ cls: "nr-peek-answer markdown-rendered" });
		void MarkdownRenderer.render(this.app, this.ask.answer, body, this.path, this.comp);
	}
	onClose(): void {
		this.comp.unload();
		this.contentEl.empty();
	}
}
