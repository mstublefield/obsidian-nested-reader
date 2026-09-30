// The saved-answers store: one JSON sidecar, written through a small IO interface so it can be tested
// without Obsidian. Must not import "obsidian".
import {
	type AnswersData,
	deletePath,
	parseAnswers,
	renamePath,
	type SavedAsk,
	upsertAsk,
} from "./answers-core";

/** The slice of `app.vault.adapter` the store needs. */
export type AnswersIO = {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
};

export const WRITE_DELAY_MS = 500;

export class AnswersStore {
	private data: AnswersData = { version: 1, notes: {} };
	private listeners = new Set<(paths: string[]) => void>();
	private timer: number | null = null;
	private dirty = false;
	private chain: Promise<void> = Promise.resolve();

	constructor(
		private io: AnswersIO,
		private file: string,
		private now: () => number = Date.now,
	) {}

	/** Reads the sidecar. A corrupt one is copied to `.bak` and the store starts empty. */
	async load(): Promise<void> {
		let raw: string | null = null;
		try {
			if (await this.io.exists(this.file)) raw = await this.io.read(this.file);
		} catch {
			raw = null;
		}
		const parsed = parseAnswers(raw);
		if (parsed.corrupt && raw !== null) {
			try {
				await this.io.write(`${this.file}.bak`, raw);
			} catch {
				// A failed backup must not stop the plugin loading.
			}
		}
		this.data = parsed.data;
	}

	list(path: string): SavedAsk[] {
		return this.data.notes[path] ?? [];
	}

	/** Finds an ask by id in any note. */
	find(id: string): { path: string; ask: SavedAsk } | null {
		for (const [path, list] of Object.entries(this.data.notes)) {
			const ask = list.find((a) => a.id === id);
			if (ask) return { path, ask };
		}
		return null;
	}

	count(path: string): number {
		return this.list(path).length;
	}

	upsert(path: string, ask: SavedAsk): void {
		this.data.notes[path] = upsertAsk(this.list(path), { ...ask, updated: ask.updated || this.now() });
		this.changed([path]);
	}

	/** Removes one ask and returns it (for undo), or null when it was not there. */
	remove(path: string, id: string): SavedAsk | null {
		const list = this.list(path);
		const ask = list.find((a) => a.id === id);
		if (!ask) return null;
		const rest = list.filter((a) => a.id !== id);
		if (rest.length) this.data.notes[path] = rest;
		else delete this.data.notes[path];
		this.changed([path]);
		return ask;
	}

	/** Removes every ask of a note and returns them. */
	clearNote(path: string): SavedAsk[] {
		const list = this.list(path);
		if (!list.length) return [];
		delete this.data.notes[path];
		this.changed([path]);
		return list;
	}

	rename(oldPath: string, newPath: string): void {
		const { notes, affected } = renamePath(this.data.notes, oldPath, newPath);
		if (!affected.length) return;
		this.data.notes = notes;
		this.changed(affected);
	}

	deleteNote(path: string): void {
		const { notes, affected } = deletePath(this.data.notes, path);
		if (!affected.length) return;
		this.data.notes = notes;
		this.changed(affected);
	}

	/** Calls `cb` with the note paths a change touched. Returns the unsubscribe function. */
	onChange(cb: (paths: string[]) => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	/** Writes now if anything is waiting. Safe to call repeatedly; resolves when the write finishes. */
	flush(): Promise<void> {
		if (this.timer) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.dirty) {
			this.dirty = false;
			const json = JSON.stringify(this.data, null, "\t");
			this.chain = this.chain
				.then(() => this.io.write(this.file, json))
				.catch((e: unknown) => {
					this.dirty = true;
					console.error("Nested Reader: could not save answers", e);
				});
		}
		return this.chain;
	}

	private changed(paths: string[]): void {
		this.dirty = true;
		if (this.timer) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => void this.flush(), WRITE_DELAY_MS);
		for (const cb of [...this.listeners]) cb([...new Set(paths)]);
	}
}
