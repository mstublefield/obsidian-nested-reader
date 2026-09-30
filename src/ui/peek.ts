import { type App, Component, MarkdownRenderer, setIcon } from "obsidian";
import type { SavedAsk } from "../store/answers-core";
import { ASK_ATTR, ANSWERED_CLASS } from "./answered";

/** What the hover popover and the click handler need from the plugin. */
export type PeekHost = {
	app: App;
	hoverEnabled(): boolean;
	clickEnabled(): boolean;
	/** The saved ask for an id, with the note it belongs to. */
	lookup(id: string): { path: string; ask: SavedAsk } | null;
	isOpen(id: string): boolean;
	/** Open the answer as a card (from the popover's Open button or a click). */
	open(el: Element, path: string, ask: SavedAsk): void;
	forget(path: string, ask: SavedAsk): void;
};

const SHOW_DELAY_MS = 250;
const HIDE_DELAY_MS = 300;
const PHRASE = `.${ANSWERED_CLASS}[${ASK_ATTR}]`;
const LINKY = "a, .cm-link, .cm-hmd-internal-link, .cm-url, .internal-link, .external-link";

type Shown = { el: HTMLElement; anchor: Element; comp: Component; id: string };

/** The answer popover over an underlined phrase, and the click that opens the card. One at a time. */
export class AnswerPeek {
	private shown: Shown | null = null;
	private showTimer = 0;
	private hideTimer = 0;
	private pending: Element | null = null;
	/** Bumped on every show/hide so a slow render cannot bring back a popover that was dismissed. */
	private seq = 0;

	constructor(private host: PeekHost) {}

	/** Listen on one document (the main window or a pop-out). Returns the removal function. */
	watch(doc: Document): () => void {
		const over = (e: MouseEvent) => this.over(e);
		const out = (e: MouseEvent) => this.out(e);
		const down = (e: MouseEvent) => {
			if (this.shown && !(e.target instanceof Element && this.inPeek(e.target))) this.hide();
		};
		const scroll = (e: Event) => {
			if (e.target instanceof Element && this.inPeek(e.target)) return;
			this.hide();
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") this.hide();
		};
		const click = (e: MouseEvent) => this.click(e, doc);
		doc.addEventListener("mouseover", over);
		doc.addEventListener("mouseout", out);
		doc.addEventListener("mousedown", down, true);
		doc.addEventListener("scroll", scroll, true);
		doc.addEventListener("keydown", key, true);
		doc.addEventListener("click", click);
		return () => {
			doc.removeEventListener("mouseover", over);
			doc.removeEventListener("mouseout", out);
			doc.removeEventListener("mousedown", down, true);
			doc.removeEventListener("scroll", scroll, true);
			doc.removeEventListener("keydown", key, true);
			doc.removeEventListener("click", click);
		};
	}

	hide(): void {
		this.seq++;
		window.clearTimeout(this.showTimer);
		window.clearTimeout(this.hideTimer);
		this.pending = null;
		if (!this.shown) return;
		const { el, comp } = this.shown;
		this.shown = null;
		comp.unload();
		el.remove();
	}

	private inPeek(el: Element): boolean {
		return !!this.shown && this.shown.el.contains(el);
	}

	private phraseOf(target: EventTarget | null): HTMLElement | null {
		return target instanceof Element ? target.closest<HTMLElement>(PHRASE) : null;
	}

	private over(e: MouseEvent): void {
		const t = e.target instanceof Element ? e.target : null;
		if (t && this.inPeek(t)) {
			window.clearTimeout(this.hideTimer);
			return;
		}
		const phrase = this.phraseOf(e.target);
		if (!phrase) return;
		window.clearTimeout(this.hideTimer);
		if (this.shown?.anchor === phrase || this.pending === phrase) return;
		if (!this.host.hoverEnabled()) return;
		window.clearTimeout(this.showTimer);
		this.pending = phrase;
		this.showTimer = window.setTimeout(() => {
			this.pending = null;
			if (phrase.isConnected) void this.show(phrase);
		}, SHOW_DELAY_MS);
	}

	private out(e: MouseEvent): void {
		const from = e.target instanceof Element ? e.target : null;
		const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
		const leftPhrase = !!this.phraseOf(from) && this.phraseOf(from) !== this.phraseOf(to);
		const leftPeek = !!from && this.inPeek(from) && !(to && this.inPeek(to));
		if (!leftPhrase && !leftPeek) return;
		// Moving from the phrase into the popover, or back, is not leaving.
		if (to && (this.inPeek(to) || (this.shown && this.phraseOf(to) === this.shown.anchor))) return;
		window.clearTimeout(this.showTimer);
		this.pending = null;
		window.clearTimeout(this.hideTimer);
		this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY_MS);
	}

	private click(e: MouseEvent, doc: Document): void {
		if (e.button !== 0 || e.detail > 1 || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
		if (!this.host.clickEnabled()) return;
		const phrase = this.phraseOf(e.target);
		if (!phrase) return;
		// A link inside or around the phrase keeps its own behaviour.
		if (e.target instanceof Element && e.target.closest(LINKY)) return;
		if (phrase.closest(LINKY)) return;
		// A drag that selected text is for the Ask pill, not for this.
		if (!(doc.getSelection()?.isCollapsed ?? true)) return;
		const id = phrase.getAttribute(ASK_ATTR) ?? "";
		const found = this.host.lookup(id);
		if (!found) return;
		this.hide();
		this.host.open(phrase, found.path, found.ask);
	}

	private async show(anchor: HTMLElement): Promise<void> {
		const id = anchor.getAttribute(ASK_ATTR) ?? "";
		const found = this.host.lookup(id);
		if (!found || this.host.isOpen(id)) return;
		this.hide();
		const seq = ++this.seq;
		const { path, ask } = found;
		const doc = anchor.ownerDocument;
		const comp = new Component();
		comp.load();
		const el = doc.body.createDiv({ cls: "nr-peek" });
		const bar = el.createDiv({ cls: "nr-peek-bar" });
		const q = bar.createDiv({ cls: "nr-peek-q", text: ask.question || "Explain" });
		q.setAttribute("title", ask.question || "Explain");
		const actions = bar.createDiv({ cls: "nr-peek-actions" });
		const open = actions.createEl("button", { cls: "clickable-icon nr-peek-btn", attr: { "aria-label": "Open" } });
		setIcon(open, "maximize-2");
		open.addEventListener("click", () => {
			this.hide();
			this.host.open(anchor, path, ask);
		});
		const forget = actions.createEl("button", { cls: "clickable-icon nr-peek-btn", attr: { "aria-label": "Forget" } });
		setIcon(forget, "trash-2");
		forget.addEventListener("click", () => {
			this.hide();
			this.host.forget(path, ask);
		});
		const body = el.createDiv({ cls: "nr-peek-answer markdown-rendered" });
		const n = ask.thread.length;
		if (n) el.createDiv({ cls: "nr-peek-earlier", text: `${n} earlier ${n === 1 ? "question" : "questions"}` });
		this.shown = { el, anchor, comp, id };
		await MarkdownRenderer.render(this.host.app, ask.answer, body, path, comp);
		if (seq !== this.seq) return;
		this.place(el, anchor);
	}

	/** Below the phrase, or above it when there is no room; kept inside the window. */
	private place(el: HTMLElement, anchor: Element): void {
		const win = anchor.ownerDocument.defaultView;
		const rects = anchor.getClientRects();
		const rect = rects.length ? rects[0] : anchor.getBoundingClientRect();
		const vw = win?.innerWidth ?? 800;
		const vh = win?.innerHeight ?? 600;
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const x = Math.max(8, Math.min(rect.left, vw - w - 8));
		let y = rect.bottom + 6;
		if (y + h > vh - 8 && rect.top - h - 6 >= 8) y = rect.top - h - 6;
		el.setCssProps({ "--nr-x": `${x}px`, "--nr-y": `${Math.max(8, y)}px` });
		el.addClass("is-ready");
	}
}
