import { type Editor, getLinkpath, MarkdownView, normalizePath, Notice, TFile } from "obsidian";
import { buildRequest } from "../ask";
import { buildAskContext } from "../context";
import { newPageMessages } from "../lib/prompts";
import { nowIso } from "../lib/time";
import type NestedReaderPlugin from "../main";
import { resolveSource } from "../reader/resolve-source";
import type { Opens } from "../settings-model";
import {
	bodyFromText,
	composeFrontMatter,
	type Ending,
	finishBody,
	firstH1,
	isGrownPage,
	type PageMode,
	placeholderBody,
	withBody,
} from "./compose";
import { linkPhraseAt, paragraphWithLink, planPhraseLink, withAlias } from "./link-phrase";
import { newPagePath, pageIdentity, baseName, titleRename } from "./names";
import {
	deletePage,
	markDone,
	markFailed,
	markRead,
	markUnread,
	markWriting,
	type PageState,
	renamePage,
	statusText,
} from "./page-state";

/** How long streamed text waits before it is written to the file. */
export const WRITE_MS = 750;
/** Deep dives get a longer budget than a page, up to this many tokens. */
export const DEEP_CAP = 32768;

export type GrowRequest = {
	parent: TFile;
	question: string;
	/** The highlighted words, whitespace-collapsed. */
	selection: string;
	paragraph: string;
	mode: PageMode;
};

type Run = { title: string; abort: AbortController; detail: string };

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Writes new pages: creates the file, links the phrase, opens it, and streams the model's text into it. */
export class PageGrower {
	private runs = new Map<TFile, Run>();
	private statusEl: HTMLElement | null = null;
	state: PageState;
	private listeners = new Set<() => void>();

	constructor(
		private plugin: NestedReaderPlugin,
		initial: PageState,
		private persist: () => void,
	) {
		this.state = initial;
	}

	/** Adds the status bar item. Call once from `onload`. */
	mountStatus(): void {
		const el = this.plugin.addStatusBarItem();
		el.addClass("nr-status-item");
		el.addEventListener("click", () => {
			if (!this.runs.size) void this.openNextUnread();
		});
		this.statusEl = el;
		this.refreshStatus();
	}

	unload(): void {
		for (const run of this.runs.values()) run.abort.abort();
		this.runs.clear();
	}

	private set(next: PageState): void {
		this.state = next;
		this.persist();
		this.refreshStatus();
		for (const cb of [...this.listeners]) cb();
	}

	/** Calls `cb` whenever unread, writing or failed pages change. Returns the unsubscribe function. */
	onChange(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	/** Marks a page read or unread by choice (the Nested pages panel's right-click menu). */
	setUnread(path: string, unread: boolean): void {
		const next = unread ? markUnread(this.state, path) : markRead(this.state, path);
		if (next !== this.state) this.set(next);
	}

	private refreshStatus(): void {
		if (!this.statusEl) return;
		const runs = [...this.runs.values()];
		const text = statusText(runs.map((r) => r.title), this.state.unread.length, runs.length === 1 ? runs[0].detail : "");
		this.statusEl.setText(text);
		this.statusEl.toggleClass("nr-hidden", !text);
		this.statusEl.toggleClass("is-clickable", !this.runs.size && this.state.unread.length > 0);
	}

	// Keeping the state in step with the vault.
	renamed(path: string, oldPath: string): void {
		const next = renamePage(this.state, oldPath, path);
		if (next !== this.state) this.set(next);
	}

	deleted(file: { path: string }): void {
		for (const [f, run] of [...this.runs]) {
			if (f.path === file.path || f.path.startsWith(`${file.path}/`)) {
				run.abort.abort();
				this.runs.delete(f);
			}
		}
		const next = deletePage(this.state, file.path);
		if (next.unread.length !== this.state.unread.length || Object.keys(next.failed).length !== Object.keys(this.state.failed).length || next.writing.length !== this.state.writing.length) {
			this.set(next);
		}
	}

	opened(file: TFile | null): void {
		if (file) {
			const next = markRead(this.state, file.path);
			if (next !== this.state) this.set(next);
		}
	}

	/** Drops unread and failed entries whose files were deleted while Obsidian was closed. */
	prune(): void {
		let next = this.state;
		for (const p of [...next.unread, ...Object.keys(next.failed)]) {
			if (!this.plugin.app.vault.getAbstractFileByPath(p)) next = deletePage(next, p);
		}
		if (next !== this.state) this.set(next);
	}

	async openNextUnread(): Promise<void> {
		for (const path of this.state.unread) {
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				await this.plugin.app.workspace.getLeaf(false).openFile(file);
				return;
			}
		}
		this.set({ ...this.state, unread: [] });
	}

	/** Creates the page, links the phrase, opens it as the settings say, and writes it. Reports its own failures. */
	async grow(req: GrowRequest): Promise<void> {
		const { app, settings } = this.plugin;
		const opts = settings.pages;
		try {
			const { question, title } = pageIdentity(req.question, req.selection, req.parent.basename);
			const taken = new Set(app.vault.getAllLoadedFiles().map((f) => f.path.toLowerCase()));
			const path = newPagePath({
				title,
				fileNames: opts.fileNames,
				location: opts.location,
				folder: opts.folder,
				parentPath: req.parent.path,
				exists: (p) => taken.has(p.toLowerCase()),
			});
			await this.ensureFolder(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
			const front = composeFrontMatter({
				title,
				sourceLink: app.metadataCache.fileToLinktext(req.parent, path),
				question,
				created: nowIso(),
				mode: req.mode,
			});
			const file = await app.vault.create(path, front + placeholderBody(title));
			if (opts.linkPhrase && req.selection) await this.linkPhrase(req, file);
			await this.open(file, req.mode === "deep-dive" ? opts.deepDiveOpens : opts.newPageOpens);
			await this.generate(file, { parent: req.parent, question, mode: req.mode, selection: req.selection, paragraph: req.paragraph, title, generatedName: file.basename });
		} catch (e) {
			new Notice(`Couldn't write the page: ${errorText(e)}`);
		}
	}

	/** Writes a grown page again from its front matter, keeping the front matter and replacing the body. */
	async regenerate(file: TFile): Promise<void> {
		const { app } = this.plugin;
		if (this.runs.has(file)) {
			new Notice("This page is already being written.");
			return;
		}
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		const parent = resolveSource(app, file.path, fm?.source);
		if (!isGrownPage(fm) || !parent) {
			new Notice("Couldn't find the note this page grew from.");
			return;
		}
		const title = typeof fm?.title === "string" && fm.title.trim() ? fm.title : file.basename;
		// The highlighted words are still in the parent as the link's text.
		const links = app.metadataCache.getFileCache(parent)?.links ?? [];
		const hit = links.find((l) => app.metadataCache.getFirstLinkpathDest(getLinkpath(l.link), parent.path) === file);
		// Only a file still named as the plugin named it is renamed again; a name the user chose stays.
		const { fileNames } = this.plugin.settings.pages;
		const asked = pageIdentity(String(fm?.question ?? ""), "", file.basename).title;
		const known = [title, asked].map((t) => baseName(t, fileNames));
		const generatedName = known.some((n) => n.toLowerCase() === file.basename.toLowerCase()) ? file.basename : "";
		try {
			await app.vault.process(file, (raw) => withBody(raw, "", placeholderBody(title)));
			await this.generate(file, {
				parent,
				question: String(fm?.question),
				mode: fm?.mode === "deep-dive" ? "deep-dive" : "new-page",
				selection: hit ? norm(hit.displayText ?? "") : "",
				paragraph: "",
				title,
				generatedName,
			});
		} catch (e) {
			new Notice(`Couldn't write the page: ${errorText(e)}`);
		}
	}

	private async ensureFolder(dir: string): Promise<void> {
		const { vault } = this.plugin.app;
		if (!dir) return;
		let built = "";
		for (const part of dir.split("/")) {
			built = built ? `${built}/${part}` : part;
			const at = normalizePath(built);
			if (!vault.getAbstractFileByPath(at)) await vault.createFolder(at);
		}
	}

	private async open(file: TFile, how: Opens): Promise<void> {
		if (how === "background") return;
		const { workspace } = this.plugin.app;
		const leaf = how === "split" ? workspace.getLeaf("split") : how === "tab" ? workspace.getLeaf("tab") : workspace.getLeaf(false);
		await leaf.openFile(file);
	}

	private isVisible(file: TFile): boolean {
		let seen = false;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file === file) seen = true;
		});
		return seen;
	}

	/** Rewrites the highlighted words in the parent as a link to the child. Says why when it cannot. */
	private async linkPhrase(req: GrowRequest, child: TFile): Promise<void> {
		const { app } = this.plugin;
		const parent = req.parent;
		const linktext = app.metadataCache.fileToLinktext(child, parent.path);
		const make = (words: string) => withAlias(app.fileManager.generateMarkdownLink(child, parent.path, undefined, words), linktext, words);
		let failure = "";
		const applied: { words?: string; link?: string } = {};

		const editor = this.sourceEditorFor(parent);
		if (editor) {
			const doc = editor.getValue();
			const plan = planPhraseLink(doc, req.selection, req.paragraph);
			if (plan.ok) {
				const link = make(plan.text);
				editor.replaceRange(link, editor.offsetToPos(plan.from), editor.offsetToPos(plan.to));
				applied.words = plan.text;
				applied.link = link;
			} else failure = plan.reason;
		} else {
			await app.vault.process(parent, (doc) => {
				const plan = planPhraseLink(doc, req.selection, req.paragraph);
				if (!plan.ok) {
					failure = plan.reason;
					return doc;
				}
				const link = make(plan.text);
				applied.words = plan.text;
				applied.link = link;
				return linkPhraseAt(doc, plan.from, plan.to, link);
			});
		}
		if (failure || applied.words === undefined || applied.link === undefined) {
			new Notice(`Couldn't link the phrase: ${failure || "it was not found"}.`);
			return;
		}
		// The saved answer for this phrase finds its paragraph by text, which now holds the link.
		const { words, link } = applied;
		const saved = this.plugin.answers.list(parent.path).find((a) => norm(a.text) === norm(req.selection));
		if (saved) this.plugin.answers.upsert(parent.path, { ...saved, paragraph: paragraphWithLink(saved.paragraph, words, link) });
	}

	/** The editor of a parent note open in Live Preview or source mode, if any. */
	private sourceEditorFor(file: TFile): Editor | null {
		let found: Editor | null = null;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			const v = leaf.view;
			if (!found && v instanceof MarkdownView && v.file === file && v.getMode() === "source") found = v.editor;
		});
		return found;
	}

	private async generate(
		file: TFile,
		opts: { parent: TFile; question: string; mode: PageMode; selection: string; paragraph: string; title: string; generatedName: string },
	): Promise<void> {
		const { app, settings } = this.plugin;
		const { title } = opts;
		const abort = new AbortController();
		const { signal } = abort;
		const run: Run = { title, abort, detail: "" };
		this.runs.set(file, run);
		this.set(markWriting(this.state, file.path));

		let text = "";
		let timer = 0;
		let chain: Promise<unknown> = Promise.resolve();
		const writeNow = (body: string) => {
			chain = chain.then(() => app.vault.process(file, (raw) => withBody(raw, "", body))).catch(() => undefined);
			return chain;
		};
		const schedule = () => {
			if (timer) return;
			timer = window.setTimeout(() => {
				timer = 0;
				void writeNow(bodyFromText(text, title));
			}, WRITE_MS);
		};

		let ending: Ending = { kind: "done" };
		try {
			const ctx = await buildAskContext(app, settings, {
				file: opts.parent,
				selection: opts.selection,
				paragraph: opts.paragraph,
				thread: [],
			});
			if (signal.aborted) return;
			const deep = opts.mode === "deep-dive";
			const { system, messages } = newPageMessages(ctx, opts.question, deep);
			const budget = this.plugin.maxTokens("pages");
			const maxTokens = deep ? Math.min(Math.round(budget * 1.5), Math.max(DEEP_CAP, budget)) : budget;
			const result = await this.plugin.transport().stream(buildRequest(this.plugin, system, messages, "pages", maxTokens), {
				onDelta: (t) => {
					if (signal.aborted) return;
					text += t;
					run.detail = "";
					schedule();
				},
				onTool: (detail) => {
					// Tool lines show in the status bar until the page's own text starts.
					if (signal.aborted || text) return;
					run.detail = detail;
					this.refreshStatus();
				},
				onReset: () => {
					if (signal.aborted) return;
					text = "";
					schedule();
				},
			}, signal);
			if (signal.aborted) return;
			text = result.text.trim() ? result.text : text;
			if (!text.trim()) throw new Error("The model returned no answer.");
			if (result.truncated) ending = { kind: "truncated" };
		} catch (e) {
			if (signal.aborted) return;
			ending = { kind: "error", message: errorText(e) };
		} finally {
			window.clearTimeout(timer);
			timer = 0;
		}
		if (signal.aborted) return;

		await writeNow(finishBody(text, title, ending));
		this.runs.delete(file);
		const heading = firstH1(text);
		if (heading && heading !== title) {
			try {
				await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					fm.title = heading;
				});
			} catch {
				// The title in the front matter is a convenience; the page itself is written.
			}
		}
		const shown = heading ?? title;
		if (ending.kind === "done" && settings.pages.renameToTitle) await this.renameToHeading(file, opts.generatedName, heading);
		const visible = this.isVisible(file);
		if (ending.kind === "error") {
			this.set(markFailed(this.state, file.path, ending.message));
			if (!visible) new Notice(`Couldn't write "${shown}": ${ending.message}`);
			return;
		}
		this.set(markDone(this.state, file.path, !visible));
		if (!visible) this.readyNotice(file, opts.mode === "deep-dive" ? "Deep dive ready" : "Page ready", shown);
	}

	/** Renames the finished page's file to its heading. Links and the plugin's saved state follow through the vault's rename event. */
	private async renameToHeading(file: TFile, generatedName: string, heading: string | null): Promise<void> {
		const { app, settings } = this.plugin;
		const dir = file.parent?.path ?? "";
		const inDir = (dir === "/" ? "" : dir);
		const taken = new Set<string>();
		for (const f of app.vault.getAllLoadedFiles()) {
			if (f !== file && f.parent === file.parent) taken.add(f.path.replace(/^.*\//, "").replace(/\.md$/i, "").toLowerCase());
		}
		const name = titleRename(file.basename, generatedName, heading, settings.pages.fileNames, taken);
		if (!name) return;
		try {
			await app.fileManager.renameFile(file, normalizePath(inDir ? `${inDir}/${name}.${file.extension}` : `${name}.${file.extension}`));
		} catch {
			// The page is written; keeping the question's file name is fine.
		}
	}

	/** A notice that opens the page when clicked. */
	private readyNotice(file: TFile, label: string, title: string): void {
		const notice = new Notice("", 10000);
		notice.messageEl.setText(`${label}: ${title}`);
		notice.messageEl.addClass("nr-notice-link");
		notice.messageEl.addEventListener("click", () => {
			void this.plugin.app.workspace.getLeaf(false).openFile(file);
			notice.hide();
		});
	}
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
