// Pure model of the saved answers. Must not import "obsidian".
import type { AskRecord } from "../ask-record";

export type Turn = { question: string; answer: string };

/** One remembered Quick answer. `question`/`answer` are the latest turn; `thread` holds the earlier ones. */
export type SavedAsk = {
	id: string;
	/** The asked-about phrase, whitespace-collapsed. The key: one saved ask per phrase per note. */
	text: string;
	paragraph: string;
	question: string;
	answer: string;
	thread: Turn[];
	/** Epoch milliseconds. */
	created: number;
	updated: number;
};

export type AnswersData = { version: 1; notes: Record<string, SavedAsk[]> };

export const ANSWERS_VERSION = 1;

export function emptyAnswers(): AnswersData {
	return { version: ANSWERS_VERSION, notes: {} };
}

function isPlain(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function sanitizeTurns(v: unknown): Turn[] {
	if (!Array.isArray(v)) return [];
	const out: Turn[] = [];
	for (const t of v as unknown[]) {
		if (isPlain(t) && typeof t.answer === "string") out.push({ question: str(t.question), answer: t.answer });
	}
	return out;
}

/** One entry from disk, or null when it is unusable (no id, phrase or answer). */
export function sanitizeAsk(v: unknown): SavedAsk | null {
	if (!isPlain(v) || typeof v.id !== "string" || v.id === "" || typeof v.text !== "string" || v.text.trim() === "") return null;
	if (typeof v.answer !== "string" || v.answer.trim() === "") return null;
	const created = num(v.created, 0);
	return {
		id: v.id,
		text: v.text,
		paragraph: str(v.paragraph),
		question: str(v.question),
		answer: v.answer,
		thread: sanitizeTurns(v.thread),
		created,
		updated: num(v.updated, created),
	};
}

export type ParsedAnswers = { data: AnswersData; corrupt: boolean };

/**
 * Reads the sidecar's text. Empty or missing is a fresh start; unparseable, not an object, or a
 * version newer than this plugin understands is `corrupt` so the caller keeps a backup before overwriting.
 * A file with no `version` but a `notes` object is read as version 1.
 */
export function parseAnswers(raw: string | null | undefined): ParsedAnswers {
	if (raw == null || raw.trim() === "") return { data: emptyAnswers(), corrupt: false };
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return { data: emptyAnswers(), corrupt: true };
	}
	if (!isPlain(json) || !isPlain(json.notes)) return { data: emptyAnswers(), corrupt: true };
	if (json.version !== undefined && (typeof json.version !== "number" || json.version > ANSWERS_VERSION)) {
		return { data: emptyAnswers(), corrupt: true };
	}
	const data = emptyAnswers();
	for (const [path, list] of Object.entries(json.notes)) {
		if (!Array.isArray(list)) continue;
		let asks: SavedAsk[] = [];
		for (const item of list as unknown[]) {
			const ask = sanitizeAsk(item);
			if (ask) asks = upsertAsk(asks, ask);
		}
		if (asks.length) data.notes[path] = asks;
	}
	return { data, corrupt: false };
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Replaces the entry with the same phrase (keeping when it was first asked), else appends. */
export function upsertAsk(list: readonly SavedAsk[], ask: SavedAsk): SavedAsk[] {
	const key = norm(ask.text);
	const at = list.findIndex((a) => norm(a.text) === key);
	if (at < 0) return [...list, ask];
	const next = [...list];
	next[at] = { ...ask, created: list[at].created || ask.created };
	return next;
}

export type Moved = { notes: Record<string, SavedAsk[]>; affected: string[] };

/** The key `path` becomes when `from` is renamed to `to`: itself, or a note inside the renamed folder. */
function rebase(path: string, from: string, to: string): string | null {
	if (path === from) return to;
	if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
	return null;
}

/** Moves the note at `from`, or every note under it when it is a folder, to `to`. */
export function renamePath(notes: Record<string, SavedAsk[]>, from: string, to: string): Moved {
	if (from === to) return { notes, affected: [] };
	const out: Record<string, SavedAsk[]> = {};
	const affected: string[] = [];
	for (const [path, list] of Object.entries(notes)) {
		const moved = rebase(path, from, to);
		if (moved === null) {
			if (!(path in out)) out[path] = list;
			continue;
		}
		affected.push(path, moved);
		let merged = out[moved] ?? notes[moved] ?? [];
		for (const ask of list) merged = upsertAsk(merged, ask);
		out[moved] = merged;
	}
	return { notes: out, affected };
}

/** Drops the note at `path`, or every note under it when it is a folder. */
export function deletePath(notes: Record<string, SavedAsk[]>, path: string): Moved {
	const out: Record<string, SavedAsk[]> = {};
	const affected: string[] = [];
	for (const [p, list] of Object.entries(notes)) {
		if (p === path || p.startsWith(`${path}/`)) affected.push(p);
		else out[p] = list;
	}
	return { notes: out, affected };
}

/** Upstream's rule: a cut-off or failed answer is shown but never remembered. */
export function shouldRemember(r: { truncated?: boolean; error?: string; answer: string }): boolean {
	return !r.truncated && !r.error && r.answer.trim() !== "";
}

/** The finished record as a saved entry. Call after `commitTurn`, which has put the latest turn last in `thread`. */
export function recordToSaved(r: AskRecord, now: number): SavedAsk {
	return {
		id: r.id,
		text: r.text,
		paragraph: r.paragraph,
		question: r.question,
		answer: r.answer,
		thread: r.thread.slice(0, -1).map((t) => ({ ...t })),
		created: now,
		updated: now,
	};
}

/** A saved ask as an open card's record, with every turn (latest last) in `thread` so follow-ups continue it. */
export function savedToRecord(a: SavedAsk, filePath: string): AskRecord {
	return {
		id: a.id,
		filePath,
		text: a.text,
		paragraph: a.paragraph,
		thread: [...a.thread.map((t) => ({ ...t })), { question: a.question, answer: a.answer }],
		question: a.question,
		answer: a.answer,
	};
}
