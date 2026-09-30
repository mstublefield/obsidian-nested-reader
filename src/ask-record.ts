// Pure data for one inline ask card, kept plain so it can be saved later. Must not import "obsidian".
import type { StreamResult } from "./ai/transport";

/** Aligned with upstream `Ask` (src/platform/types.ts), with the note's path and the paragraph in place of block offsets. */
export type AskRecord = {
	id: string;
	filePath: string;
	/** The selected text, whitespace-collapsed. */
	text: string;
	paragraph: string;
	/** Finished question/answer pairs, oldest first. */
	thread: { question: string; answer: string }[];
	/** The question being asked now, or last asked. */
	question: string;
	answer: string;
	truncated?: boolean;
	error?: string;
};

export function newAskRecord(id: string, filePath: string, text: string, paragraph: string): AskRecord {
	return { id, filePath, text, paragraph, thread: [], question: "", answer: "" };
}

/**
 * Stores a finished answer. Upstream's rule: a cut-off answer is shown but not remembered as a
 * finished turn, so the model is never handed half an answer as history.
 */
export function commitTurn(record: AskRecord, result: StreamResult): void {
	record.answer = result.text;
	record.error = undefined;
	record.truncated = result.truncated ? true : undefined;
	if (!result.truncated) record.thread.push({ question: record.question, answer: result.text });
}
