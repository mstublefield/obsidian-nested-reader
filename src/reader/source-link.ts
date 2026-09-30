// Pure: turns a `source` front matter value into a link path. Must not import "obsidian".

/**
 * `"[[Parent]]"`, `"[[Parent|alias]]"`, `"[[Parent#Heading]]"` or a plain path like `parent.md` → the
 * link path Obsidian can resolve (`Parent`, `parent.md`), or null when there is nothing usable.
 */
export function sourceLinkpath(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	let s = raw.trim();
	const wiki = /^\[\[([\s\S]*?)\]\]$/.exec(s);
	if (wiki) s = wiki[1];
	s = s.split("|")[0].split("#")[0].split("^")[0].trim();
	if (s === "" || /[\n\r]/.test(s) || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;
	return s;
}

/** YAML reads an unquoted `[[Parent]]` as a nested list, so look inside arrays for the first string. */
export function sourceFromFrontmatter(value: unknown): string | null {
	if (Array.isArray(value)) {
		for (const v of value as unknown[]) {
			const s = sourceFromFrontmatter(v);
			if (s) return s;
		}
		return null;
	}
	return sourceLinkpath(value);
}
