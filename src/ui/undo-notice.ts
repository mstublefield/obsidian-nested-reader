import { Notice } from "obsidian";

/** A notice with an Undo button. Clicking it runs `undo` once and dismisses the notice. */
export function noticeWithUndo(message: string, undo: () => void): Notice {
	const frag = createFragment();
	frag.createSpan({ text: `${message} ` });
	const button = frag.createEl("button", { text: "Undo", cls: "nr-undo" });
	const notice = new Notice(frag, 8000);
	button.addEventListener("click", () => {
		undo();
		notice.hide();
	});
	return notice;
}
