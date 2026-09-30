import { type App, type TAbstractFile, TFile } from "obsidian";
import { sourceFromFrontmatter } from "../reader/source-link";
import { SourceIndex } from "./family";

/**
 * Keeps a `SourceIndex` in step with the vault without rescanning it: one pass over the cached front matter
 * at start, then single-note updates on metadata changes, renames and deletes.
 */
export class SourceTracker {
	readonly index = new SourceIndex();
	/** The raw link text of each note that has a `source`, so parents can be looked up again later. */
	private links = new Map<string, string>();

	constructor(private app: App) {}

	/** One pass over every note's cached front matter. */
	build(): void {
		this.index.clear();
		this.links.clear();
		for (const file of this.app.vault.getMarkdownFiles()) this.update(file);
	}

	/** Re-reads one note's `source`. */
	update(file: TFile): void {
		if (file.extension !== "md") return;
		const link = sourceFromFrontmatter(this.app.metadataCache.getFileCache(file)?.frontmatter?.source);
		if (link === null) {
			this.links.delete(file.path);
			this.index.set(file.path, null);
			return;
		}
		this.links.set(file.path, link);
		this.index.set(file.path, this.resolve(link, file.path));
	}

	/** Looks every recorded link up again, for when notes were created, renamed or deleted elsewhere. */
	resolveAll(): void {
		for (const [path, link] of this.links) this.index.set(path, this.resolve(link, path));
	}

	renamed(file: TAbstractFile, oldPath: string): void {
		this.index.rename(oldPath, file.path);
		const moved = new Map<string, string>();
		for (const [path, link] of this.links) {
			const at = path === oldPath || path.startsWith(`${oldPath}/`) ? file.path + path.slice(oldPath.length) : path;
			moved.set(at, link);
		}
		this.links = moved;
	}

	deleted(file: TAbstractFile): void {
		this.index.remove(file.path);
		for (const path of [...this.links.keys()]) if (path === file.path || path.startsWith(`${file.path}/`)) this.links.delete(path);
	}

	private resolve(link: string, from: string): string | null {
		return this.app.metadataCache.getFirstLinkpathDest(link, from)?.path ?? null;
	}
}
