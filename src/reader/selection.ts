// Pure helpers for selected text. Must not import "obsidian".

/** The longest selection that gets an Ask pill. */
export const MAX_PILL_SELECTION = 2000;

/** Collapses runs of whitespace (including newlines) to single spaces and trims. */
export function normalizeSelection(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Whether a selection is worth offering the Ask pill for. */
export function isPillSelection(raw: string): boolean {
	return raw.length <= MAX_PILL_SELECTION && normalizeSelection(raw) !== "";
}
