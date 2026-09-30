import type { Editor, MarkdownView, TFile } from "obsidian";
import { paragraphAround } from "./paragraph";
import { normalizeSelection } from "./selection";

type Base = {
	file: TFile;
	/** The selection, whitespace-collapsed and trimmed. */
	text: string;
	paragraph: string;
};
export type SourceTarget = Base & {
	mode: "source";
	editor: Editor;
	/** Document offset of the end of the paragraph's last line, where the card goes. */
	anchor: number;
};
export type PreviewTarget = Base & {
	mode: "preview";
	/** The block element the card goes after. */
	block: HTMLElement;
};
export type AskTarget = SourceTarget | PreviewTarget;

const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, pre";

/** Live Preview and source mode: the selection comes from the editor, the paragraph from its lines. */
export function targetFromEditor(view: MarkdownView, editor: Editor): SourceTarget | null {
	const file = view.file;
	const text = normalizeSelection(editor.getSelection());
	if (!file || !text) return null;
	const lines = editor.getValue().split("\n");
	const { from, to } = paragraphAround(lines, editor.getCursor("from").line);
	return {
		mode: "source",
		file,
		editor,
		text,
		paragraph: lines.slice(from, to + 1).join("\n"),
		anchor: editor.posToOffset({ line: to, ch: lines[to].length }),
	};
}

function elementOf(node: Node): Element | null {
	return node.instanceOf(Element) ? node : node.parentElement;
}

/** The block a node sits in: the nearest block-level element, else the child of the preview section. */
function blockOf(node: Node, root: HTMLElement): HTMLElement | null {
	const el = elementOf(node);
	if (!el || !root.contains(el) || el.closest(".nr-card")) return null;
	const near = el.closest<HTMLElement>(BLOCK);
	if (near && root.contains(near)) return near;
	let cur: HTMLElement | null = el as HTMLElement;
	while (cur && cur.parentElement && !cur.parentElement.classList.contains("markdown-preview-section")) {
		cur = cur.parentElement;
	}
	return cur && cur.parentElement ? cur : null;
}

/** The selection's range when it lies inside this view's Reading view content. */
export function previewRange(view: MarkdownView): Range | null {
	const root = view.contentEl.querySelector<HTMLElement>(".markdown-preview-view");
	const sel = view.containerEl.ownerDocument.getSelection();
	if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
	const range = sel.getRangeAt(0);
	if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
	if (elementOf(range.startContainer)?.closest(".nr-card")) return null;
	return range;
}

/**
 * Reading view: the card goes after the block holding the end of the selection. A selection that
 * spans blocks is clamped to that last block (as upstream's Page.tsx does on mouse up).
 */
export function targetFromPreview(view: MarkdownView): PreviewTarget | null {
	const file = view.file;
	const root = view.contentEl.querySelector<HTMLElement>(".markdown-preview-view");
	const range = previewRange(view);
	if (!file || !root || !range) return null;
	let endNode = range.endContainer;
	const startBlock = blockOf(range.startContainer, root);
	// A triple-click ends at offset 0 of the next block; that block was not selected.
	if (range.endOffset === 0 && startBlock && !startBlock.contains(endNode)) endNode = range.startContainer;
	const block = blockOf(endNode, root);
	if (!block) return null;
	let text = range.toString();
	if (!block.contains(range.startContainer)) {
		const clamped = block.ownerDocument.createRange();
		clamped.selectNodeContents(block);
		if (block.contains(endNode)) clamped.setEnd(range.endContainer, range.endOffset);
		text = clamped.toString();
	}
	text = normalizeSelection(text);
	if (!text) return null;
	return { mode: "preview", file, block, text, paragraph: block.textContent ?? "" };
}
