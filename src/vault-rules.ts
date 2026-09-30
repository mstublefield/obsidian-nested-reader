// Pure vault rules shared by settings, context and the vault tools. Must not import "obsidian".

/** One folder path as stored: vault-relative, forward slashes, no leading or trailing slash. */
export function normalizeFolder(raw: string): string {
	return raw
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^(\.\/)+/, "")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.trim();
}

/** Accepts a list or one newline-separated string; returns trimmed, non-empty, unique folders. */
export function normalizeFolders(input: unknown): string[] {
	const items = Array.isArray(input) ? input : typeof input === "string" ? input.split(/\r?\n/) : [];
	const out: string[] = [];
	for (const item of items) {
		if (typeof item !== "string") continue;
		const f = normalizeFolder(item);
		if (f && f !== "." && !out.includes(f)) out.push(f);
	}
	return out;
}

/**
 * Whether a vault-relative path is inside one of the excluded folders (or is one). Compared
 * without regard to case, because the usual Mac and Windows file systems ignore it.
 */
export function isExcluded(path: string, folders: readonly string[]): boolean {
	const p = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
	return folders.some((f) => {
		const e = f.toLowerCase();
		return p === e || p.startsWith(`${e}/`);
	});
}

export type PathCheck = { ok: true; path: string } | { ok: false; error: string };

/** What `read_page` may open: a vault-relative Markdown path outside hidden and excluded folders. */
export function checkReadPath(raw: string, excluded: readonly string[]): PathCheck {
	const path = raw.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "");
	if (!path) return { ok: false, error: "Give the note's path, as listed by list_pages or search_pages." };
	const notANote = { ok: false, error: `${path} is not a note in this vault.` } as const;
	if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return notANote;
	const parts = path.split("/");
	if (parts.some((p) => p === ".." || p === "." || p === "")) return notANote;
	if (!/\.md$/i.test(path)) return { ok: false, error: `Only Markdown notes can be read; ${path} is not one.` };
	if (parts.some((p) => p.startsWith("."))) return notANote;
	if (isExcluded(path, excluded)) return notANote;
	return { ok: true, path };
}

/** Whether a listed or searched file may be offered at all: Markdown, not hidden, not excluded. */
export function isVisibleNote(path: string, excluded: readonly string[]): boolean {
	return checkReadPath(path, excluded).ok;
}

export const MAX_PAGE_CHARS = 40_000;
export const LIST_CAP = 500;

export function clipPage(raw: string): string {
	const chars = [...raw];
	if (chars.length <= MAX_PAGE_CHARS) return raw;
	return `${chars.slice(0, MAX_PAGE_CHARS).join("")}\n\n[The note goes on; only the first ${MAX_PAGE_CHARS} characters are shown.]`;
}

export function clipText(s: string, max: number): string {
	const chars = [...s];
	return chars.length <= max ? s : `${chars.slice(0, max).join("")}…`;
}

/** The front-matter title, else the file name without its extension. */
export function titleOf(raw: string, path: string): string {
	const lines = raw.split(/\r?\n/);
	if (lines[0]?.trim() === "---") {
		for (const line of lines.slice(1)) {
			const t = line.trim();
			if (t === "---") break;
			if (t.startsWith("title:")) {
				let v = t.slice(6).trim();
				if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
				if (v) return v;
			}
		}
	}
	const base = path.split("/").pop() ?? path;
	return base.replace(/\.md$/i, "");
}

export type ListEntry = { path: string; title: string };

/** `entries` come in order of preference (most recent first); at most `LIST_CAP` are shown, sorted by path. */
export function formatList(entries: ListEntry[]): string {
	if (!entries.length) return "The vault has no notes it may list.";
	const shown = entries.slice(0, LIST_CAP).sort((a, b) => a.path.localeCompare(b.path));
	let out = shown.map((e) => `${e.path} — ${e.title}`).join("\n");
	if (entries.length > shown.length) {
		out += `\n\n[${entries.length - shown.length} more notes not shown; these are the ${shown.length} most recently modified. Use search_pages to find a note by what it says.]`;
	}
	return out;
}

export type ToolDef = { name: string; description: string; schema: Record<string, unknown> };

export const VAULT_TOOLS: ToolDef[] = [
	{
		name: "list_pages",
		description:
			"List the notes in the reader's vault: path and title, one per line. A large vault lists only the most recently modified notes; use search_pages to find others.",
		schema: { type: "object", properties: {}, additionalProperties: false },
	},
	{
		name: "read_page",
		description: "Read one note in full. Give its path exactly as listed by list_pages or search_pages.",
		schema: {
			type: "object",
			properties: { path: { type: "string", description: "Note path as listed, e.g. notes/replay.md" } },
			required: ["path"],
			additionalProperties: false,
		},
	},
	{
		name: "search_pages",
		description:
			"Find lines across the notes in the vault that contain the query, case-insensitively. Returns path, line number and the line.",
		schema: {
			type: "object",
			properties: { query: { type: "string", description: "Words to look for" } },
			required: ["query"],
			additionalProperties: false,
		},
	},
];

/** The short line the card shows while a tool runs, in the words upstream used. */
export function describeTool(name: string, input: unknown): string {
	const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
	if (name === "list_pages") return "Listing the pages";
	if (name === "read_page") {
		const path = typeof inp.path === "string" ? inp.path : "";
		const base = path.split("/").pop() ?? "";
		return base ? `Reading ${base}` : "Reading a page";
	}
	if (name === "search_pages") {
		const q = typeof inp.query === "string" ? inp.query.trim() : "";
		return q ? `Searching for “${clipText(q, 40)}”` : "Searching the pages";
	}
	return `Using ${name}`;
}
