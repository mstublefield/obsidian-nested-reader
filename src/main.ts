import { Notice, Plugin } from "obsidian";
import { AnthropicApiTransport } from "./ai/anthropic-api";
import { ClaudeCliTransport } from "./ai/claude-cli";
import { CodexCliTransport } from "./ai/codex-cli";
import { PROVIDERS } from "./ai/providers";
import { ResponsesApiTransport } from "./ai/responses-api";
import type { Transport } from "./ai/transport";
import { NestedSettingTab } from "./settings";
import { accessFor, mergeSettings, type NestedSettings, type Slot } from "./settings-model";

export default class NestedReaderPlugin extends Plugin {
	settings!: NestedSettings;

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

		// Temporary: lets the user check streaming end to end before the reader UI exists.
		this.addCommand({
			id: "dev-test-stream",
			name: "Ask a test question",
			callback: async () => {
				const notice = new Notice("Asking…", 0);
				let sofar = "";
				try {
					const { text } = await this.transport().stream(
						{
							messages: [{ role: "user", content: "In one sentence, what is a sharp-wave ripple?" }],
							model: this.model("quick"),
							maxTokens: this.maxTokens("quick"),
						},
						// Shown as it arrives, so streaming is visible, not just the final answer.
						{ onDelta: (t) => notice.setMessage((sofar += t)) },
					);
					notice.hide();
					new Notice(text, 8000);
				} catch (e) {
					notice.hide();
					new Notice(errorText(e));
				}
			},
		});
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
