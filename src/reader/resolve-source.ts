import type { App, TFile } from "obsidian";
import { sourceFromFrontmatter } from "./source-link";

/** The vault note a front matter `source` value points at, as seen from `from`, or null when there is none. */
export function resolveSource(app: App, from: string, raw: unknown): TFile | null {
	const link = sourceFromFrontmatter(raw);
	return link ? app.metadataCache.getFirstLinkpathDest(link, from) : null;
}
