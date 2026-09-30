import { type App, TFile } from "obsidian";
import { promptSettings } from "./ask-messages";
import { parseFrontMatter } from "./lib/frontmatter";
import type { AskContext, ContextPage } from "./lib/prompts";
import { sessionPages } from "./lib/tree";
import type { PageMeta } from "./platform/types";
import { sourceFromFrontmatter } from "./reader/source-link";
import type { NestedSettings } from "./settings-model";
import { isExcluded } from "./vault-rules";

const SESSION_CAP = 12;
const FOLDER_CAP = 40;

/** What `buildAskContext` needs to know about the ask. */
export type AskContextInput = {
	file: TFile;
	selection: string;
	paragraph: string;
	thread: { question: string; answer: string }[];
};

function iso(ms: number): string | undefined {
	return ms > 0 ? new Date(ms).toISOString() : undefined;
}

function metaFor(app: App, file: TFile): PageMeta {
	const cache = app.metadataCache.getFileCache(file);
	const fm: Record<string, unknown> | undefined = cache?.frontmatter;
	const h1 = cache?.headings?.find((h) => h.level === 1)?.heading;
	const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
	const link = sourceFromFrontmatter(fm?.source);
	const parent = link ? app.metadataCache.getFirstLinkpathDest(link, file.path) : null;
	const mode = fm?.mode === "deep-dive" || fm?.mode === "new-page" ? fm.mode : undefined;
	return {
		path: file.path,
		title: str(fm?.title) ?? h1 ?? file.basename,
		source: parent?.path,
		question: str(fm?.question),
		created: str(fm?.created) ?? iso(file.stat.ctime),
		modified: iso(file.stat.mtime),
		mode,
	};
}

async function pageFor(app: App, file: TFile, meta: PageMeta): Promise<ContextPage> {
	const raw = await app.vault.cachedRead(file);
	return { meta, body: parseFrontMatter(raw).body };
}

/** Pages connected to `file` through `source` front matter: its parent chain, children and siblings. */
async function sessionContext(app: App, file: TFile, excluded: readonly string[]): Promise<ContextPage[]> {
	const files = new Map<string, TFile>([[file.path, file]]);
	for (const f of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(f)?.frontmatter;
		const link = sourceFromFrontmatter(fm?.source);
		if (!link) continue;
		const target = app.metadataCache.getFirstLinkpathDest(link, f.path);
		if (!target) continue;
		files.set(f.path, f);
		files.set(target.path, target);
	}
	// Excluded notes are never sent; only the note being read is let through.
	for (const path of [...files.keys()]) if (path !== file.path && isExcluded(path, excluded)) files.delete(path);
	const metas: Record<string, PageMeta> = {};
	for (const f of files.values()) metas[f.path] = metaFor(app, f);
	const related = sessionPages(file.path, metas).slice(0, SESSION_CAP);
	const pages: Promise<ContextPage>[] = [];
	for (const m of related) {
		const f = files.get(m.path);
		if (f) pages.push(pageFor(app, f, m));
	}
	return Promise.all(pages);
}

async function folderContext(app: App, file: TFile, skip: Set<string>, excluded: readonly string[]): Promise<ContextPage[]> {
	const siblings = (file.parent?.children ?? []).filter(
		(c): c is TFile => c instanceof TFile && c.extension === "md" && c.path !== file.path && !skip.has(c.path) && !isExcluded(c.path, excluded),
	);
	return Promise.all(siblings.slice(0, FOLDER_CAP).map((f) => pageFor(app, f, metaFor(app, f))));
}

export async function buildAskContext(
	app: App,
	settings: NestedSettings,
	input: AskContextInput,
): Promise<AskContext> {
	const { file } = input;
	const excluded = settings.answers.excludeFolders;
	const page = await pageFor(app, file, metaFor(app, file));
	const session = settings.context.session ? await sessionContext(app, file, excluded) : [];
	const skip = new Set(session.map((p) => p.meta.path));
	const folder = settings.context.folder ? await folderContext(app, file, skip, excluded) : [];
	return {
		page,
		selection: input.selection,
		paragraph: input.paragraph,
		session,
		folder,
		mapPages: [],
		summaries: {},
		settings: promptSettings(settings.context, settings.answers.vaultSearch),
		thread: input.thread,
	};
}
