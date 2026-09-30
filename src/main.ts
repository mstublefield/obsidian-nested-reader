import { Notice, Plugin } from "obsidian";
import { AnthropicApiTransport } from "./ai/anthropic-api";
import { ClaudeCliTransport } from "./ai/claude-cli";
import type { Transport } from "./ai/transport";
import { mergeSettings, NestedSettingTab, type NestedSettings } from "./settings";

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
			name: "Ask Claude a test question",
			callback: async () => {
				const notice = new Notice("Asking…", 0);
				let sofar = "";
				try {
					const { text } = await this.transport().stream(
						{
							messages: [{ role: "user", content: "In one sentence, what is a sharp-wave ripple?" }],
							model: this.settings.models[this.settings.transport].quick,
							maxTokens: this.settings.maxTokens.quick,
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

	/** Picks the route to Claude each time, so settings changes apply without a reload. */
	transport(): Transport {
		if (this.settings.transport === "api") {
			return new AnthropicApiTransport(() => this.app.secretStorage.getSecret(this.settings.apiKeySecret));
		}
		return new ClaudeCliTransport(() => this.settings.cliPath);
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
