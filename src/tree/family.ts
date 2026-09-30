// Pure: the family of a note (its `source` ancestors and every descendant of the root) and the rows the
// Nested pages panel shows. Must not import "obsidian".
import { buildTree, type TreeItem } from "../lib/tree";
import type { PageMeta } from "../platform/types";
import type { PageState } from "../pages/page-state";

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

/** The path `path` becomes when `from` is renamed to `to`: itself, or a file inside a renamed folder. */
function rebase(path: string, from: string, to: string): string {
	return under(path, from) ? to + path.slice(from.length) : path;
}

/**
 * Which notes have a `source`, and which note each resolves to. Only notes with a source are held, so the
 * index stays small in a large vault and can be updated one note at a time.
 */
export class SourceIndex {
	private parents = new Map<string, string>();
	private kids = new Map<string, Set<string>>();

	get size(): number {
		return this.parents.size;
	}

	parentOf(path: string): string | undefined {
		return this.parents.get(path);
	}

	childrenOf(path: string): readonly string[] {
		return [...(this.kids.get(path) ?? [])];
	}

	/** Records that `path` grew from `parent`, or (null) that it has no usable source. */
	set(path: string, parent: string | null): void {
		const old = this.parents.get(path);
		if (old === (parent ?? undefined)) return;
		if (old !== undefined) this.unlink(path, old);
		if (parent === null || parent === path) return;
		this.parents.set(path, parent);
		const set = this.kids.get(parent) ?? new Set<string>();
		set.add(path);
		this.kids.set(parent, set);
	}

	/** A file, or a folder with everything in it, is gone. Notes that grew from it lose their parent. */
	remove(gone: string): void {
		for (const path of [...this.parents.keys()]) {
			const parent = this.parents.get(path) as string;
			if (under(path, gone) || under(parent, gone)) this.unlink(path, parent);
		}
		for (const key of [...this.kids.keys()]) if (under(key, gone)) this.kids.delete(key);
	}

	/** A file, or a folder with everything in it, moved. */
	rename(from: string, to: string): void {
		if (from === to) return;
		const entries = [...this.parents];
		this.parents.clear();
		this.kids.clear();
		for (const [path, parent] of entries) this.set(rebase(path, from, to), rebase(parent, from, to));
	}

	clear(): void {
		this.parents.clear();
		this.kids.clear();
	}

	private unlink(path: string, parent: string): void {
		this.parents.delete(path);
		const set = this.kids.get(parent);
		set?.delete(path);
		if (set && !set.size) this.kids.delete(parent);
	}
}

export type Lookup = {
	parentOf(path: string): string | undefined;
	childrenOf(path: string): readonly string[];
};

export type Family = {
	root: string;
	/** The root first, then every descendant once. */
	members: string[];
};

/** Walks `source` links up to the root (stopping at a cycle), then collects everything grown from that root. */
export function familyOf(index: Lookup, path: string): Family {
	const seen = new Set<string>();
	let root = path;
	for (;;) {
		seen.add(root);
		const parent = index.parentOf(root);
		if (parent === undefined || seen.has(parent)) break;
		root = parent;
	}
	const members = [root];
	const found = new Set(members);
	for (let i = 0; i < members.length; i++) {
		for (const kid of index.childrenOf(members[i])) {
			if (found.has(kid)) continue;
			found.add(kid);
			members.push(kid);
		}
	}
	return { root, members };
}

export type RowState = "writing" | "failed" | "unread" | "none";

export function rowState(path: string, state: PageState): RowState {
	if (state.writing.includes(path)) return "writing";
	if (path in state.failed) return "failed";
	if (state.unread.includes(path)) return "unread";
	return "none";
}

export type FamilyRow = TreeItem & {
	state: RowState;
	/** The failure reason, when `state` is "failed". */
	error?: string;
};

/**
 * The rows for a family, in upstream's order (roots newest first, children oldest first). `metas` must hold
 * every member; a `source` outside the family, a note's own path, or the one that closes a cycle is ignored.
 * With `unreadOnly`, only unread, writing and failed rows stay, plus the ancestors that lead to them.
 */
export function familyRows(family: Family, metas: Record<string, PageMeta>, state: PageState, unreadOnly: boolean): FamilyRow[] {
	const scoped: Record<string, PageMeta> = {};
	for (const path of family.members) {
		const meta = metas[path];
		if (!meta) continue;
		const source = meta.source && meta.source !== path && metas[meta.source] && path !== family.root ? meta.source : undefined;
		scoped[path] = { ...meta, source };
	}
	const rows: FamilyRow[] = buildTree(scoped).map((item) => ({
		...item,
		state: rowState(item.path, state),
		error: state.failed[item.path],
	}));
	if (!unreadOnly) return rows;
	const keep = rows.map((r) => r.state !== "none");
	for (let i = 0; i < rows.length; i++) {
		if (!keep[i]) continue;
		let depth = rows[i].depth;
		for (let j = i - 1; j >= 0 && depth > 0; j--) {
			if (rows[j].depth < depth) {
				keep[j] = true;
				depth = rows[j].depth;
			}
		}
	}
	return rows.filter((_, i) => keep[i]);
}

/** The count text for a row, or "" when there is nothing to say ("1 answer", "2 answers"). */
export function answerCountText(count: number): string {
	return count > 0 ? `${count} ${count === 1 ? "answer" : "answers"}` : "";
}
