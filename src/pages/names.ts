// Pure helpers for where a new page goes and what it is called. Must not import "obsidian".
import { slugify, titleFromQuestion } from "../lib/slug";

export type FileNames = "readable" | "slug";
export type PageLocation = "beside" | "folder";

/** The longest readable file name, without the extension. */
export const MAX_NAME = 80;

/** Characters that are illegal in file names on some system, or that mean something inside a link. */
const UNSAFE = /[\\/:*?"<>|#^[\]]/g;

/** A file name from a title: readable words, nothing that breaks a path or a wikilink, at most `MAX_NAME` characters. */
export function readableName(title: string): string {
	let name = [...title].map((c) => (c.charCodeAt(0) < 32 ? " " : c)).join("").replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
	if (name.length > MAX_NAME) {
		const cut = name.slice(0, MAX_NAME);
		const space = cut.lastIndexOf(" ");
		// Cut at a word boundary unless that would throw most of the name away.
		name = name[MAX_NAME] === " " || space < MAX_NAME / 2 ? cut : cut.slice(0, space);
	}
	name = name.replace(/^[. ]+|[. ]+$/g, "");
	return name || "Untitled";
}

/** The base name (no extension) for a page, in the chosen style. */
export function baseName(title: string, style: FileNames): string {
	return style === "slug" ? slugify(title) : readableName(title);
}

/** Vault-relative folder a new page goes in: beside its parent, or in the chosen folder ("" = vault root). */
export function pageDir(location: PageLocation, folder: string, parentPath: string): string {
	if (location === "folder") return cleanFolder(folder);
	const i = parentPath.lastIndexOf("/");
	return i < 0 ? "" : parentPath.slice(0, i);
}

/** A vault-relative folder with stray slashes, backslashes and dots removed; "" for the vault root. */
export function cleanFolder(folder: string): string {
	return folder
		.replace(/\\/g, "/")
		.split("/")
		.map((s) => s.trim())
		.filter((s) => s !== "" && s !== "." && s !== "..")
		.join("/");
}

/**
 * `dir/base.md`, or with " 2", " 3" (readable names) or "-2", "-3" (slugs) until `exists` says the
 * path is free. `exists` should ignore case, as the usual file systems do.
 */
export function uniquePath(dir: string, base: string, style: FileNames, exists: (path: string) => boolean): string {
	const prefix = dir ? `${dir}/` : "";
	const sep = style === "slug" ? "-" : " ";
	let candidate = `${prefix}${base}.md`;
	for (let i = 2; exists(candidate); i++) candidate = `${prefix}${base}${sep}${i}.md`;
	return candidate;
}

/** The whole path for a new page. */
export function newPagePath(opts: {
	title: string;
	fileNames: FileNames;
	location: PageLocation;
	folder: string;
	parentPath: string;
	exists: (path: string) => boolean;
}): string {
	const dir = pageDir(opts.location, opts.folder, opts.parentPath);
	return uniquePath(dir, baseName(opts.title, opts.fileNames), opts.fileNames, opts.exists);
}

/**
 * The question and title for a new page. A blank question becomes upstream's "Go deeper on: <selection>".
 * The title is the question, capitalised, and is capped so a long selection does not make a long title.
 */
export function pageIdentity(question: string, selection: string, fallbackTitle: string): { question: string; title: string } {
	const q = question.trim();
	const sel = selection.replace(/\s+/g, " ").trim();
	const asked = q || (sel ? `Go deeper on: ${sel}` : `Go deeper on: ${fallbackTitle}`);
	const shown = q ? q : asked.replace(/^Go deeper on: /, "Go deeper on ");
	const title = titleFromQuestion(shown);
	return { question: asked, title: title.length > 120 ? `${title.slice(0, 119).trimEnd()}…` : title };
}
