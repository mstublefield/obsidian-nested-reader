import { type Editor, MarkdownView, type MarkdownFileInfo, Notice, Plugin } from "obsidian";
import { AnthropicApiTransport } from "./ai/anthropic-api";
import { ClaudeCliTransport } from "./ai/claude-cli";
import { CodexCliTransport } from "./ai/codex-cli";
import { PROVIDERS } from "./ai/providers";
import { ResponsesApiTransport } from "./ai/responses-api";
import type { Transport } from "./ai/transport";
import { previewRange, targetFromEditor, targetFromPreview, type AskTarget } from "./reader/target";
import { AskPill } from "./ui/ask-pill";
import { CardManager } from "./ui/card-manager";
import { cardExtension } from "./ui/card-host";
import { NestedSettingTab } from "./settings";
import { accessFor, mergeSettings, type NestedSettings, type Slot } from "./settings-model";

export default class NestedReaderPlugin extends Plugin {
	settings!: NestedSettings;
	cards!: CardManager;
	private pill!: AskPill;

	async onload() {
		await this.loadSettings();
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
		this.registerEditorExtension(cardExtension());
		this.register(() => {
			this.pill.hide();
			this.cards.closeAll();
		});

		// The main window plus any pop-out window, now and later.
		this.register(this.pill.watch(document));
		this.registerEvent(this.app.workspace.on("window-open", (_w, win) => this.register(this.pill.watch(win.document))));

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
