import { type Editor, MarkdownView, type MarkdownFileInfo, normalizePath, Notice, Plugin } from "obsidian";
import { AnthropicApiTransport } from "./ai/anthropic-api";
import { ClaudeCliTransport } from "./ai/claude-cli";
import { CodexCliTransport } from "./ai/codex-cli";
import { PROVIDERS } from "./ai/providers";
import { ResponsesApiTransport } from "./ai/responses-api";
import type { Transport } from "./ai/transport";
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
import { NestedSettingTab } from "./settings";
import { accessFor, mergeSettings, type NestedSettings, type Slot } from "./settings-model";

export default class NestedReaderPlugin extends Plugin {
	settings!: NestedSettings;
	cards!: CardManager;
	answers!: AnswersStore;
	private pill!: AskPill;
	private peek!: AnswerPeek;

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

		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.answers.rename(oldPath, file.path)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.answers.deleteNote(file.path)));

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
		this.settings = mergeSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
