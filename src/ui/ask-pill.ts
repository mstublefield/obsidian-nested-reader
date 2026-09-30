import { setIcon } from "obsidian";
import { isPillSelection } from "../reader/selection";
import type { AskTarget } from "../reader/target";

/** What the watcher needs from the plugin; keeps this file free of plugin internals. */
export type PillHost = {
	enabled(): boolean;
	/** The ask target for the current selection, or null when the selection is not inside a note's content. */
	capture(doc: Document): { target: AskTarget; raw: string } | null;
	onAsk(target: AskTarget): void;
};

const OWN = ".nr-card, .nr-pill";

/** The floating "Ask" button shown under a finished mouse selection. One per plugin, moved between windows. */
export class AskPill {
	private el: HTMLElement | null = null;
	private dragging = false;
	private shownFor = "";

	constructor(private host: PillHost) {}

	/** Attach listeners for one document (the main window or a pop-out). Returns the removal function. */
	watch(doc: Document): () => void {
		const inOwn = (e: Event) => e.target instanceof Element && !!e.target.closest(OWN);
		const down = (e: MouseEvent) => {
			if (inOwn(e)) return;
			this.dragging = e.button === 0;
			this.hide();
		};
		const up = (e: MouseEvent) => {
			this.dragging = false;
			if (inOwn(e) || e.button !== 0) return;
			// Let the browser finish updating the selection before reading it.
			doc.defaultView?.setTimeout(() => this.evaluate(doc), 10);
		};
		const change = () => {
			if (!this.el || this.dragging) return;
			const sel = doc.getSelection()?.toString() ?? "";
			if (sel !== this.shownFor) this.hide();
		};
		const hide = () => this.hide();
		const key = (e: KeyboardEvent) => {
			if (e.target instanceof Element && e.target.closest(OWN)) return;
			this.hide();
		};
		doc.addEventListener("mousedown", down, true);
		doc.addEventListener("mouseup", up, true);
		doc.addEventListener("selectionchange", change);
		doc.addEventListener("scroll", hide, true);
		doc.addEventListener("keydown", key, true);
		return () => {
			doc.removeEventListener("mousedown", down, true);
			doc.removeEventListener("mouseup", up, true);
			doc.removeEventListener("selectionchange", change);
			doc.removeEventListener("scroll", hide, true);
			doc.removeEventListener("keydown", key, true);
		};
	}

	hide(): void {
		this.el?.remove();
		this.el = null;
		this.shownFor = "";
	}

	private evaluate(doc: Document): void {
		if (this.dragging || !this.host.enabled()) return;
		const sel = doc.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
		const captured = this.host.capture(doc);
		if (!captured || !isPillSelection(captured.raw)) return;
		const rects = sel.getRangeAt(0).getClientRects();
		const rect = rects.length ? rects[rects.length - 1] : sel.getRangeAt(0).getBoundingClientRect();
		if (!rect.width && !rect.height) return;
		this.show(doc, captured.target, sel.toString(), rect);
	}

	private show(doc: Document, target: AskTarget, shownFor: string, rect: DOMRect): void {
		this.hide();
		const win = doc.defaultView;
		const pill = doc.body.createEl("button", { cls: "nr-pill", attr: { "aria-label": "Ask about selection" } });
		setIcon(pill.createSpan({ cls: "nr-pill-icon" }), "message-circle-question");
		pill.createSpan({ text: "Ask" });
		// Keep the selection alive while the button is pressed.
		pill.addEventListener("mousedown", (e) => e.preventDefault());
		pill.addEventListener("click", () => {
			this.hide();
			this.host.onAsk(target);
		});
		const maxX = (win?.innerWidth ?? 800) - 80;
		const maxY = (win?.innerHeight ?? 600) - 40;
		pill.setCssProps({
			"--nr-x": `${Math.max(8, Math.min(rect.right, maxX))}px`,
			"--nr-y": `${Math.max(8, Math.min(rect.bottom + 6, maxY))}px`,
		});
		this.el = pill;
		this.shownFor = shownFor;
	}
}
