import { type App, Component, MarkdownRenderer, setIcon } from "obsidian";
import type { StreamHandlers, StreamResult } from "../ai/transport";
import { type AskRecord, commitTurn } from "../ask-record";
import type { PageMode } from "../pages/compose";

export type AskRunner = (args: {
	record: AskRecord;
	question: string;
	handlers: StreamHandlers;
	signal: AbortSignal;
}) => Promise<StreamResult>;

export type CardDeps = {
	app: App;
	record: AskRecord;
	run: AskRunner;
	/** Called when the user closes the card; the owner removes it and calls `dispose`. */
	onClose: (card: AnswerCard) => void;
	/** Called after each turn that finished whole (not cut off, not failed), so the owner can remember it. */
	onTurn?: (record: AskRecord) => void;
	/**
	 * Called when the user picks New page or Deep dive. `followUp` is true when the card already holds
	 * an answer; the card stays open then, and is the owner's to close otherwise.
	 */
	onPage?: (mode: PageMode, question: string, followUp: boolean) => void;
};

const RENDER_MS = 100;

/**
 * One ask card: an input, then a streamed answer, then a follow-up thread. It owns a single stable
 * element so the editor (CodeMirror) or Reading view can place it once and streaming just mutates it.
 */
export class AnswerCard {
	readonly id: string;
	readonly el: HTMLElement;
	readonly record: AskRecord;
	private component = new Component();
	private abort: AbortController | null = null;
	private turnsEl: HTMLElement;
	private errorEl: HTMLElement;
	private inputRow: HTMLElement;
	private input: HTMLInputElement;
	private hintEl: HTMLElement;
	private answerEl: HTMLElement | null = null;
	private thinkingEl: HTMLElement | null = null;
	private turnComp: Component | null = null;
	private timer = 0;
	private seq = 0;
	private disposed = false;
	private busy = false;
	/** Off the page but still answering: finish, save, then release (see releaseWhenDone). */
	private detached = false;
	private onReleased: (() => void) | null = null;

	constructor(private deps: CardDeps) {
		this.record = deps.record;
		this.id = deps.record.id;
		this.component.load();

		this.el = createDiv({ cls: "nr-card" });
		const close = this.el.createEl("button", { cls: "nr-card-close clickable-icon", attr: { "aria-label": "Close" } });
		setIcon(close, "x");
		close.addEventListener("click", () => this.requestClose());

		this.turnsEl = this.el.createDiv({ cls: "nr-turns" });
		this.errorEl = this.el.createDiv({ cls: "nr-card-error" });
		this.inputRow = this.el.createDiv({ cls: "nr-ask-row" });
		this.input = this.inputRow.createEl("input", {
			cls: "nr-input",
			type: "text",
			attr: { placeholder: "Ask something…", spellcheck: "false" },
		});
		this.hintEl = this.inputRow.createDiv({ cls: "nr-hint" });
		this.renderHint("Quick answer");
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				this.requestClose();
			} else if (e.key === "Enter" && !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey) {
				// Only plain Enter: Obsidian's own hotkeys claim the modified Enters, so the page verbs are buttons.
				e.preventDefault();
				e.stopPropagation();
				void this.ask(this.input.value.trim());
			}
		});
		// Esc also closes while an answer is streaming and the input is hidden.
		this.el.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && e.target !== this.input) {
				e.stopPropagation();
				this.requestClose();
			}
		});
		// A card reopened from a saved answer starts finished, with its earlier turns shown.
		if (deps.record.thread.length) void this.showSaved();
	}

	/** The verb row under the input: Enter asks; New page and Deep dive are buttons (no key shortcuts). */
	private renderHint(first: string): void {
		this.hintEl.empty();
		const verbs: [string, string, () => void, boolean][] = [
			[first, "Enter", () => void this.ask(this.input.value.trim()), true],
			["New page", "", () => this.page("new-page"), false],
			["Deep dive", "", () => this.page("deep-dive"), false],
		];
		for (const [label, key, run, primary] of verbs) {
			const btn = this.hintEl.createEl("button", { cls: primary ? "nr-verb mod-cta" : "nr-verb", text: label });
			if (key) btn.createSpan({ cls: "nr-verb-key", text: "↵" });
			// Keep focus in the input, so the question typed there is the one the button uses.
			btn.addEventListener("mousedown", (e) => e.preventDefault());
			btn.addEventListener("click", run);
		}
		this.hintEl.createSpan({ cls: "nr-verb-esc", text: "Esc closes" });
	}

	private page(mode: PageMode): void {
		if (this.busy) return;
		const followUp = this.turnsEl.childElementCount > 0;
		const question = this.input.value.trim();
		this.input.value = "";
		this.deps.onPage?.(mode, question, followUp);
	}

	/** Renders the turns already in the record (a reopened answer) and leaves the card ready for a follow-up. */
	private async showSaved(): Promise<void> {
		const turns = this.record.thread.map((t) => {
			const turn = this.turnsEl.createDiv({ cls: "nr-turn" });
			turn.createDiv({ cls: "nr-q", text: t.question || "Explain" });
			return { t, body: turn.createDiv({ cls: "nr-answer markdown-rendered" }) };
		});
		this.input.placeholder = "Follow up…";
		this.renderHint("Ask");
		for (const { t, body } of turns) {
			if (this.disposed) return;
			const comp = new Component();
			this.component.addChild(comp);
			await MarkdownRenderer.render(this.deps.app, t.answer, body, this.record.filePath, comp);
		}
	}

	/** Moves the caret into the input once the card is in the document. */
	focusInput(): void {
		window.setTimeout(() => {
			if (!this.disposed && this.inputRow.isShown()) this.input.focus({ preventScroll: true });
		}, 60);
	}

	requestClose(): void {
		this.deps.onClose(this);
	}

	/**
	 * The card's place on the page is gone (a note switch, an edit across its anchor, a re-render). An answer
	 * still streaming keeps going without being drawn, is saved by onTurn when it ends, and only then is the
	 * card released, so leaving a note doesn't throw the answer away. An idle card is released at once.
	 */
	releaseWhenDone(onReleased: () => void): void {
		if (!this.busy) {
			this.dispose();
			onReleased();
			return;
		}
		this.detached = true;
		this.onReleased = onReleased;
		window.clearTimeout(this.timer);
		this.timer = 0;
		this.el.remove();
	}

	private release(): void {
		this.dispose();
		const done = this.onReleased;
		this.onReleased = null;
		done?.();
	}

	/** Aborts any stream and releases everything; the owner has already taken the element out. */
	dispose(): void {
		this.disposed = true;
		this.abort?.abort();
		window.clearTimeout(this.timer);
		this.component.unload();
		this.el.remove();
	}

	private async ask(question: string): Promise<void> {
		if (this.busy) return;
		this.record.question = question;
		this.input.value = "";
		const turn = this.turnsEl.createDiv({ cls: "nr-turn" });
		turn.createDiv({ cls: "nr-q", text: question || "Explain" });
		this.answerEl = turn.createDiv({ cls: "nr-answer markdown-rendered" });
		this.thinkingEl = turn.createDiv({ cls: "nr-thinking", text: "Thinking…" });
		this.turnComp = null;
		await this.run();
	}

	private async run(): Promise<void> {
		const { record } = this;
		this.busy = true;
		record.answer = "";
		record.error = undefined;
		record.truncated = undefined;
		this.answerEl?.empty();
		this.errorEl.empty();
		this.thinkingEl?.setText("Thinking…");
		this.thinkingEl?.show();
		this.inputRow.addClass("nr-hidden");
		this.el.addClass("is-streaming");
		this.abort = new AbortController();
		const { signal } = this.abort;
		try {
			const result = await this.deps.run({
				record,
				question: record.question,
				signal,
				handlers: {
					onDelta: (t) => {
						if (signal.aborted) return;
						record.answer += t;
						if (this.detached) return;
						this.thinkingEl?.hide();
						this.scheduleRender();
					},
					onTool: (detail) => {
						// Successive tool lines replace each other until the answer's text starts.
						if (signal.aborted || record.answer) return;
						this.thinkingEl?.setText(detail);
						this.thinkingEl?.show();
					},
					onReset: () => {
						// Text from a turn that went on to call tools was the model thinking aloud.
						if (signal.aborted) return;
						record.answer = "";
						this.seq++; // a render still in flight must not bring the dropped text back
						this.answerEl?.empty();
						this.thinkingEl?.setText("Thinking…");
						this.thinkingEl?.show();
					},
				},
			});
			if (signal.aborted || this.disposed) return;
			if (!result.text.trim()) throw new Error("The model returned no answer.");
			commitTurn(record, result);
			this.deps.onTurn?.(record);
			if (this.detached) return this.release();
			this.thinkingEl?.hide();
			window.clearTimeout(this.timer);
			this.timer = 0;
			await this.renderNow();
			if (record.truncated) this.answerEl?.parentElement?.createDiv({ cls: "nr-note", text: "The answer was cut off before it finished." });
			this.finish();
		} catch (e) {
			if (signal.aborted || this.disposed) return;
			if (this.detached) return this.release();
			record.error = e instanceof Error ? e.message : String(e);
			this.thinkingEl?.hide();
			window.clearTimeout(this.timer);
			this.timer = 0;
			if (record.answer) await this.renderNow();
			this.errorEl.createDiv({ cls: "nr-error-text", text: record.error });
			const retry = this.errorEl.createEl("button", { cls: "nr-retry", text: "Try again" });
			retry.addEventListener("click", () => void this.run());
			this.el.removeClass("is-streaming");
			this.busy = false;
		}
	}

	private finish(): void {
		this.busy = false;
		this.el.removeClass("is-streaming");
		this.input.placeholder = "Follow up…";
		this.renderHint("Ask");
		this.inputRow.removeClass("nr-hidden");
		this.input.focus({ preventScroll: true });
	}

	private scheduleRender(): void {
		if (this.timer) return;
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			void this.renderNow();
		}, RENDER_MS);
	}

	/** Renders the answer so far. Renders go to a detached element and swap in, so a slow one never shows stale text. */
	private async renderNow(): Promise<void> {
		const target = this.answerEl;
		if (!target || this.disposed || this.detached) return;
		const seq = ++this.seq;
		const tmp = createDiv();
		const comp = new Component();
		this.component.addChild(comp);
		await MarkdownRenderer.render(this.deps.app, this.record.answer, tmp, this.record.filePath, comp);
		if (seq !== this.seq || this.disposed) {
			this.component.removeChild(comp);
			return;
		}
		target.replaceChildren(...Array.from(tmp.childNodes));
		if (this.turnComp) this.component.removeChild(this.turnComp);
		this.turnComp = comp;
	}
}
