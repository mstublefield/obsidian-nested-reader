import { debounce, type Debouncer, type Editor, MarkdownView, type MarkdownFileInfo, normalizePath, Notice, Plugin, type TFile, type WorkspaceLeaf } from "obsidian";
import { AnthropicApiTransport } from "./ai/anthropic-api";
import { ClaudeCliTransport } from "./ai/claude-cli";
import { CodexCliTransport } from "./ai/codex-cli";
import { PROVIDERS } from "./ai/providers";
import { ResponsesApiTransport } from "./ai/responses-api";
import type { Transport } from "./ai/transport";
import { isGrownPage, type PageMode } from "./pages/compose";
import { PageGrower } from "./pages/grow";
import { emptyPageState, sanitizePageState, type PageState } from "./pages/page-state";
import { locatePhrase } from "./reader/locate";
import {
	previewRange,
	targetForSavedPreview,
	targetForSavedSource,
	targetFromEditor,
	targetFromPreview,
	type AskTarget,
} from "./reader/target";
import { AnswersStore } from "./store/answers";
import { savedToRecord, type SavedAsk } from "./store/answers-core";
import { ANSWERED_CLASS, answeredExtension, answersChanged, ASK_ATTR, markAnswered, type AnsweredHost } from "./ui/answered";
import { AnswerModal, AnswersPicker } from "./ui/answers-modals";
import { AskPill } from "./ui/ask-pill";
import { CardManager } from "./ui/card-manager";
import { cardExtension, cmView } from "./ui/card-host";
import { AnswerPeek } from "./ui/peek";
import { noticeWithUndo } from "./ui/undo-notice";
import { SourceTracker } from "./tree/tracker";
import { NestedTreeView, TREE_VIEW_TYPE } from "./views/tree-view";
import { NestedSettingTab } from "./settings";
import { accessFor, mergeSettings, type NestedSettings, type Slot } from "./settings-model";

export default class NestedReaderPlugin extends Plugin {
	settings!: NestedSettings;
	cards!: CardManager;
	answers!: AnswersStore;
	pages!: PageGrower;
	private loadedPageState: PageState = emptyPageState();
	private pill!: AskPill;
	private peek!: AnswerPeek;
	tracker!: SourceTracker;
	private active: TFile | null = null;
	private ribbonEl: HTMLElement | null = null;
	private refreshTreeSoon!: Debouncer<[], void>;

	async onload() {
		await this.loadSettings();
		const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		const adapter = this.app.vault.adapter;
		this.answers = new AnswersStore(
			{
				exists: (p) => adapter.exists(p),
				read: (p) => adapter.read(p),
				write: (p, d) => adapter.write(p, d),
			},
			normalizePath(`${dir}/answers.json`),
		);
		await this.answers.load();
		this.register(() => void this.answers.flush());
		this.register(this.answers.onChange((paths) => this.refreshAnswers(paths)));
		this.addSettingTab(new NestedSettingTab(this.app, this));

		this.addCommand({
			id: "test-connection",
			name: "Test connection",
			callback: async () => {
				try {
					new Notice(await this.transport().test());
				} catch (e) {
					new Notice(errorText(e));
				}
			},
		});

		this.pages = new PageGrower(this, this.loadedPageState, () => void this.saveSettings());
		this.pages.mountStatus();
		this.register(() => this.pages.unload());
		this.app.workspace.onLayoutReady(() => this.pages.prune());
		this.setupTree();
		this.cards = new CardManager(this);
		this.pill = new AskPill({
			enabled: () => this.settings.showAskButton,
			capture: (doc) => this.captureSelection(doc),
			onAsk: (target) => this.cards.ask(target),
		});
		const answered: AnsweredHost = {
			enabled: () => this.settings.underlineAnswers,
			list: (path) => this.answers.list(path),
			isOpen: (id) => this.cards.isOpen(id),
		};
		this.registerEditorExtension([cardExtension(), answeredExtension(answered)]);
		this.registerMarkdownPostProcessor((el, ctx) => {
			markAnswered(answered, el, ctx);
			// A re-render may have dropped a card that was open in this view.
			this.cards.scheduleSweep();
		});
		this.peek = new AnswerPeek({
			app: this.app,
			hoverEnabled: () => this.settings.hoverAnswers,
			clickEnabled: () => this.settings.clickOpensAnswers,
			lookup: (id) => this.answers.find(id),
			isOpen: (id) => this.cards.isOpen(id),
			open: (el, path, ask) => this.openFromElement(el, path, ask),
			forget: (path, ask) => this.forgetAsk(path, ask),
		});
		this.register(() => {
			this.pill.hide();
			this.peek.hide();
			this.cards.closeAll();
		});

		// The main window plus any pop-out window, now and later.
		const watch = (doc: Document) => {
			this.register(this.pill.watch(doc));
			this.register(this.peek.watch(doc));
		};
		watch(document);
		this.registerEvent(this.app.workspace.on("window-open", (_w, win) => watch(win.document)));

		// Cards whose editor or Reading view is gone must not keep streaming into nothing.
		const sweep = () => this.cards.scheduleSweep();
		this.registerEvent(this.app.workspace.on("layout-change", sweep));
		this.registerEvent(this.app.workspace.on("active-leaf-change", sweep));
		this.registerEvent(this.app.workspace.on("file-open", () => this.refreshAnswers(undefined, false)));

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.answers.rename(oldPath, file.path);
				this.pages.renamed(file.path, oldPath);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.answers.deleteNote(file.path);
				this.pages.deleted(file);
			}),
		);
		this.registerEvent(this.app.workspace.on("file-open", (file) => this.pages.opened(file)));

		this.addCommand({
			id: "regenerate-page",
			name: "Regenerate this page",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!isGrownPage(this.app.metadataCache.getFileCache(file)?.frontmatter)) return false;
				if (!checking) void this.pages.regenerate(file);
				return true;
			},
		});
		this.addCommand({
			id: "open-unread-page",
			name: "Open next unread page",
			checkCallback: (checking) => {
				if (!this.pages.state.unread.length) return false;
				if (!checking) void this.pages.openNextUnread();
				return true;
			},
		});
		this.addPageCommand("new-page-from-selection", "New page from selection", "new-page");
		this.addPageCommand("deep-dive-from-selection", "Deep dive from selection", "deep-dive");

		this.addCommand({
			id: "forget-note-answers",
			name: "Forget answers in this note",
			checkCallback: (checking) => {
				const path = this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
				if (!path || !this.answers.count(path)) return false;
				if (!checking) {
					const removed = this.answers.clearNote(path);
					const n = removed.length;
					noticeWithUndo(`Forgot ${n} ${n === 1 ? "answer" : "answers"}.`, () => {
						for (const ask of removed) this.answers.upsert(path, ask);
					});
				}
				return true;
			},
		});
		this.addCommand({
			id: "show-note-answers",
			name: "Show answers in this note",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const path = view?.file?.path;
				if (!view || !path || !this.answers.count(path)) return false;
				if (!checking) new AnswersPicker(this.app, [...this.answers.list(path)], (ask) => this.showAsk(view, ask)).open();
				return true;
			},
		});

		// One command for both modes: an editor callback is never offered in Reading view, so this
		// checks the active view itself.
		this.addCommand({
			id: "ask-about-selection",
			name: "Ask about selection",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (view.getMode() === "preview") {
					if (!previewRange(view)) return false;
					if (!checking) {
						const target = targetFromPreview(view);
						if (target) this.cards.ask(target);
					}
					return true;
				}
				if (!view.editor.getSelection().trim()) return false;
				if (!checking) this.askFromEditor(view.editor, view);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				if (!editor.getSelection().trim()) return;
				menu.addItem((item) =>
					item
						.setTitle("Ask about selection")
						.setIcon("message-circle-question")
						.onClick(() => this.askFromEditor(editor, info)),
				);
			}),
		);
	}

	/** The Nested pages panel: the view, its index of `source` links, the events that keep it current, and ways to open it. */
	private setupTree(): void {
		const { app } = this;
		this.tracker = new SourceTracker(app);
		this.registerView(TREE_VIEW_TYPE, (leaf) => new NestedTreeView(leaf, this));
		this.refreshTreeSoon = debounce(() => this.renderTree(), 150, true);
		const refresh = () => this.refreshTree();

		this.addCommand({ id: "show-nested-pages", name: "Show nested pages", callback: () => void this.showTree() });
		this.ribbonEl = this.addRibbonIcon("git-fork", "Show nested pages", () => void this.showTree());
		this.applyRibbon();

		const syncActive = () => {
			const leaf = app.workspace.getMostRecentLeaf();
			// The panel itself, or any other non-note view, leaves the last note in place.
			if (leaf?.view instanceof MarkdownView && leaf.view.file) this.active = leaf.view.file;
			refresh();
		};
		this.registerEvent(app.workspace.on("active-leaf-change", syncActive));
		this.registerEvent(app.workspace.on("file-open", syncActive));
		this.registerEvent(
			app.metadataCache.on("changed", (file) => {
				this.tracker.update(file);
				refresh();
			}),
		);
		let first = true;
		this.registerEvent(
			app.metadataCache.on("resolved", () => {
				// The cache may not have been complete when the index was built at start.
				if (first) this.tracker.build();
				else this.tracker.resolveAll();
				first = false;
				refresh();
			}),
		);
		this.registerEvent(app.vault.on("create", refresh));
		this.registerEvent(
			app.vault.on("delete", (file) => {
				this.tracker.deleted(file);
				refresh();
			}),
		);
		this.registerEvent(
			app.vault.on("rename", (file, oldPath) => {
				this.tracker.renamed(file, oldPath);
				refresh();
			}),
		);
		this.register(this.pages.onChange(refresh));
		this.register(this.answers.onChange(refresh));

		app.workspace.onLayoutReady(() => {
			this.tracker.build();
			const file = app.workspace.getActiveFile();
			if (file?.extension === "md") this.active = file;
			refresh();
			if (this.settings.tree.openOnStartup) void this.showTree(false);
		});
	}

	/** The note whose family the panel shows: the last note the reader looked at. */
	activeNote(): TFile | null {
		const file = this.active;
		return file && this.app.vault.getFileByPath(file.path) === file ? file : null;
	}

	/** Redraws the open Nested pages panels, once for a burst of events. */
	refreshTree(): void {
		this.refreshTreeSoon?.();
	}

	private renderTree(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TREE_VIEW_TYPE)) {
			if (leaf.view instanceof NestedTreeView) leaf.view.render();
		}
	}

	/** Shows or hides the ribbon icon to match the setting. */
	applyRibbon(): void {
		this.ribbonEl?.toggleClass("nr-hidden", !this.settings.tree.ribbonIcon);
	}

	/** Opens the Nested pages panel in the right sidebar, or (`reveal` false) only makes sure it exists. */
	async showTree(reveal = true): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(TREE_VIEW_TYPE)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: TREE_VIEW_TYPE, active: reveal });
		}
		if (reveal) await workspace.revealLeaf(leaf);
	}

	/** A command that writes a page about the current selection, with no question ("Go deeper on: ..."). */
	private addPageCommand(id: string, name: string, mode: PageMode): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				const preview = view.getMode() === "preview";
				if (preview ? !previewRange(view) : !view.editor.getSelection().trim()) return false;
				if (!checking) {
					const target = preview ? targetFromPreview(view) : targetFromEditor(view, view.editor);
					if (target) void this.pages.grow({ parent: target.file, question: "", selection: target.text, paragraph: target.paragraph, mode });
				}
				return true;
			},
		});
	}

	/** The note view that contains `el`, if any. */
	private viewFor(el: Element): MarkdownView | null {
		let found: MarkdownView | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!found && leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(el)) found = leaf.view;
		});
		return found;
	}

	/**
	 * Re-draws the underlines. Editors are told to recompute; Reading views re-render unless one holds
	 * an open card, which a re-render would drop (the card's close refreshes it again).
	 */
	refreshAnswers(paths?: string[], reading = true): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) return;
			if (paths && !paths.includes(view.file.path)) return;
			cmView(view.editor)?.dispatch({ effects: answersChanged.of(null) });
			if (reading && view.getMode() === "preview" && !this.cards.hasPreviewCardIn(view)) view.previewMode.rerender(true);
		});
	}

	/** Reopens a saved answer as a card under its paragraph, continuing its thread. */
	private openFromElement(el: Element, path: string, ask: SavedAsk): void {
		const view = this.viewFor(el);
		if (!view || view.file?.path !== path) {
			// An embed or hover preview has no place to put a card; show the answer instead.
			new AnswerModal(this.app, ask, path).open();
			return;
		}
		this.openSavedAsk(view, ask, el);
	}

	private openSavedAsk(view: MarkdownView, ask: SavedAsk, el?: Element): void {
		const file = view.file;
		if (!file) return;
		if (this.cards.has(ask.id)) {
			this.cards.focus(ask.id);
			return;
		}
		const preview = view.getMode() === "preview";
		const target = preview ? (el ? targetForSavedPreview(view, el, ask) : null) : targetForSavedSource(view, ask);
		if (!target) {
			new AnswerModal(this.app, ask, file.path).open();
			return;
		}
		this.cards.ask(target, savedToRecord(ask, file.path));
		// The phrase is not underlined while its card is open.
		if (preview) el?.removeClass(ANSWERED_CLASS);
		else this.refreshAnswers([file.path]);
	}

	/** Scrolls to a saved answer's phrase and opens its card; shows the answer in a dialog when the phrase is gone. */
	private showAsk(view: MarkdownView, ask: SavedAsk): void {
		const file = view.file;
		if (!file) return;
		if (view.getMode() === "preview") {
			const el = view.contentEl.querySelector<HTMLElement>(`.${ANSWERED_CLASS}[${ASK_ATTR}="${CSS.escape(ask.id)}"]`);
			if (el) {
				el.scrollIntoView({ block: "center" });
				this.openSavedAsk(view, ask, el);
				return;
			}
		} else {
			const hit = locatePhrase(view.editor.getValue(), ask.text, ask.paragraph);
			if (hit) {
				const from = view.editor.offsetToPos(hit.from);
				const to = view.editor.offsetToPos(hit.to);
				view.editor.setCursor(to);
				view.editor.scrollIntoView({ from, to }, true);
				this.openSavedAsk(view, ask);
				return;
			}
		}
		new AnswerModal(this.app, ask, file.path).open();
	}

	private forgetAsk(path: string, ask: SavedAsk): void {
		const removed = this.answers.remove(path, ask.id);
		if (!removed) return;
		noticeWithUndo("Answer forgotten.", () => this.answers.upsert(path, removed));
	}

	private askFromEditor(editor: Editor, ctx: MarkdownView | MarkdownFileInfo) {
		const view = ctx instanceof MarkdownView ? ctx : this.app.workspace.getActiveViewOfType(MarkdownView);
		const target = view && targetFromEditor(view, editor);
		if (target) this.cards.ask(target);
	}

	/** The ask target for the current selection in `doc`, when it is inside a note's editor or Reading view. */
	private captureSelection(doc: Document): { target: AskTarget; raw: string } | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.containerEl.ownerDocument !== doc) return null;
		if (view.getMode() === "preview") {
			const range = previewRange(view);
			const target = range && targetFromPreview(view);
			return range && target ? { target, raw: range.toString() } : null;
		}
		const anchor = doc.getSelection()?.anchorNode;
		const host = anchor instanceof Element ? anchor : anchor?.parentElement;
		if (!host || !view.contentEl.contains(host) || !host.closest(".cm-content") || host.closest(".nr-card")) return null;
		const target = targetFromEditor(view, view.editor);
		return target ? { target, raw: view.editor.getSelection() } : null;
	}

	/** Picks the route to the chosen service each time, so settings changes apply without a reload. */
	transport(): Transport {
		const st = this.settings;
		const svc = st.service;
		const key = () => this.app.secretStorage.getSecret(st.apiKeySecret[svc]);
		if (svc === "anthropic") {
			return accessFor(st, svc) === "plan"
				? new ClaudeCliTransport(() => st.cliPath.anthropic)
				: new AnthropicApiTransport(key);
		}
		if (svc === "openai" && accessFor(st, svc) === "plan") {
			return new CodexCliTransport(() => st.cliPath.openai);
		}
		return new ResponsesApiTransport(PROVIDERS[svc], key);
	}

	/** Whether the chosen service is reached through a command-line tool, which reads the vault by path. */
	usesCli(): boolean {
		const { service } = this.settings;
		return (service === "anthropic" || service === "openai") && accessFor(this.settings, service) === "plan";
	}

	/** The exact model ID to send for a slot, for the current service. */
	model(slot: Slot): string {
		return this.settings.models[this.settings.service][slot];
	}

	maxTokens(slot: Slot): number {
		return this.settings.maxTokens[slot];
	}

	async loadSettings() {
		const raw: unknown = await this.loadData();
		this.settings = mergeSettings(raw);
		this.loadedPageState = sanitizePageState((raw as { pageState?: unknown } | null)?.pageState);
	}

	/** Settings and the small page state (unread, writing, failed) share data.json. */
	async saveSettings() {
		await this.saveData({ ...this.settings, pageState: this.pages?.state ?? this.loadedPageState });
	}
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
