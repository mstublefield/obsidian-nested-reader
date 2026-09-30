import { type App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import { findClaudeBin } from "./ai/claude-cli";
import type NestedReaderPlugin from "./main";

export type TransportKind = "cli" | "api";
export type ModelSlots = { quick: string; pages: string };
export type NestedSettings = {
	transport: TransportKind;
	/** "" = auto-detect. */
	cliPath: string;
	/** Name of the secret in app.secretStorage; the key itself is never in data.json. */
	apiKeySecret: string;
	models: { cli: ModelSlots; api: ModelSlots };
	maxTokens: { quick: number; pages: number };
	context: { highlight: boolean; session: boolean; folder: boolean; map: boolean };
};

export const DEFAULT_SETTINGS: NestedSettings = {
	transport: "cli",
	cliPath: "",
	apiKeySecret: "anthropic-api-key",
	models: {
		cli: { quick: "haiku", pages: "sonnet" },
		api: { quick: "claude-haiku-4-5-20251001", pages: "claude-sonnet-5-5" },
	},
	maxTokens: { quick: 1024, pages: 4096 },
	context: { highlight: true, session: true, folder: true, map: false },
};

/** Merges saved data over defaults, one level of nesting at a time, so new keys get defaults. */
export function mergeSettings(saved: unknown): NestedSettings {
	const merge = (base: unknown, over: unknown): unknown => {
		if (!isPlain(base)) return over === undefined || typeof over !== typeof base ? base : over;
		const o = isPlain(over) ? over : {};
		return Object.fromEntries(Object.keys(base).map((k) => [k, merge(base[k], o[k])]));
	};
	return merge(DEFAULT_SETTINGS, saved) as NestedSettings;
}

function isPlain(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

export class NestedSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: NestedReaderPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl, plugin } = this;
		const s = plugin.settings;
		containerEl.empty();

		new Setting(containerEl).setName("Connection").setHeading();

		new Setting(containerEl)
			.setName("Reach Claude through")
			.addDropdown((d) =>
				d
					.addOption("cli", "Claude plan (command-line tool)")
					.addOption("api", "Anthropic API key")
					.setValue(s.transport)
					.onChange(async (v) => {
						s.transport = v as TransportKind;
						await plugin.saveSettings();
						this.display();
					}),
			);

		if (s.transport === "cli") {
			new Setting(containerEl)
				.setName("Command-line tool path")
				.setDesc("Leave blank to find the Claude command-line tool automatically.")
				.addText((t) =>
					t
						.setPlaceholder(findClaudeBin("") ?? "Not found")
						.setValue(s.cliPath)
						.onChange(async (v) => {
							s.cliPath = v.trim();
							await plugin.saveSettings();
						}),
				);
		} else {
			new Setting(containerEl)
				.setName("Anthropic API key")
				.setDesc("Stored in Obsidian's secret storage, not in the plugin's data file.")
				.addComponent((el) =>
					new SecretComponent(this.app, el).setValue(s.apiKeySecret).onChange(async (name) => {
						s.apiKeySecret = name;
						await plugin.saveSettings();
					}),
				);
		}

		const slots = s.models[s.transport];
		new Setting(containerEl)
			.setName("Quick answer model")
			.addText((t) =>
				t.setValue(slots.quick).onChange(async (v) => {
					slots.quick = v.trim();
					await plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName("New page model")
			.addText((t) =>
				t.setValue(slots.pages).onChange(async (v) => {
					slots.pages = v.trim();
					await plugin.saveSettings();
				}),
			);

		const status = containerEl.createDiv({ cls: "nr-status" });
		new Setting(containerEl).addButton((b) =>
			b
				.setButtonText("Test connection")
				.setCta()
				.onClick(async () => {
					status.className = "nr-status";
					status.setText("Checking…");
					try {
						status.setText(await plugin.transport().test());
						status.addClass("nr-status-ok");
					} catch (e) {
						status.setText(e instanceof Error ? e.message : String(e));
						status.addClass("nr-status-error");
					}
				}),
		);
		containerEl.appendChild(status); // keep the status line under the button

		new Setting(containerEl).setName("Context sent with each question").setHeading();
		const toggle = (name: string, key: "highlight" | "session" | "folder") =>
			new Setting(containerEl).setName(name).addToggle((t) =>
				t.setValue(s.context[key]).onChange(async (v) => {
					s.context[key] = v;
					await plugin.saveSettings();
				}),
			);
		toggle("Highlight and its paragraph", "highlight");
		toggle("Other pages in this thread", "session");
		toggle("Pages in the same folder", "folder");
	}
}

