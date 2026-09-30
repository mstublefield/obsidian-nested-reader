// Pure state for pages the plugin wrote: which are unread, being written, or failed. Must not import "obsidian".

export type PageState = {
	/** Pages finished while nobody was looking at them, oldest first. */
	unread: string[];
	/** Pages being written now. */
	writing: string[];
	/** Pages whose last write failed, with the reason. */
	failed: Record<string, string>;
};

export function emptyPageState(): PageState {
	return { unread: [], writing: [], failed: {} };
}

const strings = (v: unknown): string[] =>
	Array.isArray(v) ? [...new Set((v as unknown[]).filter((x): x is string => typeof x === "string" && x !== ""))] : [];

/** State read from data.json. Anything that was being written when Obsidian closed is now failed. */
export function sanitizePageState(raw: unknown): PageState {
	const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const failed: Record<string, string> = {};
	if (o.failed && typeof o.failed === "object" && !Array.isArray(o.failed)) {
		for (const [k, v] of Object.entries(o.failed as Record<string, unknown>)) if (typeof v === "string") failed[k] = v;
	}
	for (const p of strings(o.writing)) failed[p] = "Writing was interrupted.";
	return { unread: strings(o.unread), writing: [], failed };
}

const without = (list: string[], path: string): string[] => list.filter((p) => p !== path);
const omit = (failed: Record<string, string>, path: string): Record<string, string> => {
	const out = { ...failed };
	delete out[path];
	return out;
};

export function markWriting(s: PageState, path: string): PageState {
	return { unread: s.unread, writing: s.writing.includes(path) ? s.writing : [...s.writing, path], failed: omit(s.failed, path) };
}

/** A write ended well (or stopped short). `unread` adds the page to the unread list. */
export function markDone(s: PageState, path: string, unread: boolean): PageState {
	return {
		unread: unread && !s.unread.includes(path) ? [...s.unread, path] : s.unread,
		writing: without(s.writing, path),
		failed: omit(s.failed, path),
	};
}

export function markFailed(s: PageState, path: string, message: string): PageState {
	return { unread: s.unread, writing: without(s.writing, path), failed: { ...s.failed, [path]: message } };
}

/** The page was opened, so it is no longer unread. */
export function markRead(s: PageState, path: string): PageState {
	return s.unread.includes(path) ? { ...s, unread: without(s.unread, path) } : s;
}

/** The key `path` becomes when `from` is renamed to `to`: itself, or a file inside a renamed folder. */
function rebase(path: string, from: string, to: string): string {
	if (path === from) return to;
	return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

export function renamePage(s: PageState, from: string, to: string): PageState {
	if (from === to) return s;
	const failed: Record<string, string> = {};
	for (const [k, v] of Object.entries(s.failed)) failed[rebase(k, from, to)] = v;
	return { unread: s.unread.map((p) => rebase(p, from, to)), writing: s.writing.map((p) => rebase(p, from, to)), failed };
}

const under = (path: string, gone: string): boolean => path === gone || path.startsWith(`${gone}/`);

/** A file, or a folder with everything in it, was deleted. */
export function deletePage(s: PageState, gone: string): PageState {
	const failed: Record<string, string> = {};
	for (const [k, v] of Object.entries(s.failed)) if (!under(k, gone)) failed[k] = v;
	return {
		unread: s.unread.filter((p) => !under(p, gone)),
		writing: s.writing.filter((p) => !under(p, gone)),
		failed,
	};
}

/** The text for the status bar, or "" when there is nothing to say. */
export function statusText(writingTitles: string[], unreadCount: number, detail = ""): string {
	if (writingTitles.length === 1) return detail ? `Writing ${writingTitles[0]}… ${detail}` : `Writing ${writingTitles[0]}…`;
	if (writingTitles.length > 1) return `Writing ${writingTitles.length} pages…`;
	if (unreadCount > 0) return unreadCount === 1 ? "1 unread page" : `${unreadCount} unread pages`;
	return "";
}
