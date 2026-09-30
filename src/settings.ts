import {
	type App,
	PluginSettingTab,
	SecretComponent,
	type SettingDefinitionItem,
	type SettingGroupItem,
} from "obsidian";
import { findBin } from "./ai/claude-cli";
import type NestedReaderPlugin from "./main";
import {
	accessFor,
	getPath,
	SERVICE_ORDER,
	SERVICES,
	setPath,
	type Service,
	type Slot,
} from "./settings-model";
import { cleanFolder } from "./pages/names";
import { normalizeFolders } from "./vault-rules";

const FOLDERS_KEY = "answers.excludeFolders";

const OPENS_LABELS: Record<string, string> = {
	split: "Beside (split)",
	tab: "In a new tab",
	current: "In this tab",
	background: "In the background",
};

export class NestedSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: NestedReaderPlugin) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		const v = getPath(this.plugin.settings, key);
		// The folder list is stored as an array and edited as one path per line.
		return key === FOLDERS_KEY && Array.isArray(v) ? v.join("\n") : v;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		let v = typeof value === "string" && !key.startsWith("apiKeySecret") ? value.trim() : value;
		if (key === FOLDERS_KEY) v = normalizeFolders(value);
		if (key === "pages.folder") v = cleanFolder(String(value));
		setPath(this.plugin.settings, key, v);
		await this.plugin.saveSettings();
		if (key === "underlineAnswers") this.plugin.refreshAnswers();
		if (key === "tree.ribbonIcon") this.plugin.applyRibbon();
		if (key === "tree.showAnswerCounts") this.plugin.refreshTree();
		// Rows appear and disappear with the service, the access mode and the vault-search toggle.
		if (key === "service" || key.startsWith("access.") || key === "answers.vaultSearch" || key === "pages.location") this.refreshDomState();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = () => this.plugin.settings;
		const on = (svc: Service) => () => s().service === svc;
		const onPlan = (svc: "anthropic" | "openai") => () => s().service === svc && accessFor(s(), svc) === "plan";
		const onApi = (svc: Service) => () => s().service === svc && accessFor(s(), svc) === "api";

		const connection: SettingGroupItem[] = [
			{
				name: "Service",
				control: {
					type: "dropdown",
					key: "service",
					options: Object.fromEntries(SERVICE_ORDER.map((k) => [k, SERVICES[k].label])),
				},
			},
		];

		for (const svc of ["anthropic", "openai"] as const) {
			connection.push(
				{
					name: "Access",
					visible: on(svc),
					control: {
						type: "dropdown",
						key: `access.${svc}`,
						options: { plan: SERVICES[svc].planLabel ?? "Plan", api: "API key" },
					},
				},
				{
					name: "Command-line tool path",
					desc: "Leave blank to find it automatically.",
					visible: onPlan(svc),
					control: {
						type: "text",
						key: `cliPath.${svc}`,
						placeholder: findBin(svc === "anthropic" ? "claude" : "codex", "") ?? "Not found",
					},
				},
			);
		}

		for (const svc of SERVICE_ORDER) {
			// Named per service: rows without a control are keyed by name, and four rows called "API key" collide.
			const keyName = `${SERVICES[svc].label} API key`;
			connection.push({
				name: keyName,
				desc: "Stored in Obsidian's secret storage, not in this plugin's settings file.",
				visible: onApi(svc),
				render: (setting) => {
					setting.setName(keyName);
					setting.setDesc("Stored in Obsidian's secret storage, not in this plugin's settings file.");
					setting.addComponent((el) =>
						new SecretComponent(this.app, el)
							.setValue(s().apiKeySecret[svc])
							.onChange(async (name) => {
								s().apiKeySecret[svc] = name;
								await this.plugin.saveSettings();
							}),
					);
				},
			});
		}

		const slots: [Slot, string][] = [["quick", "Quick answer model"], ["pages", "New page model"]];
		for (const svc of SERVICE_ORDER) {
			for (const [slot, name] of slots) {
				connection.push({
					name,
					desc: modelDesc(svc),
					visible: on(svc),
					control: { type: "text", key: `models.${svc}.${slot}` },
				});
			}
		}

		connection.push({
			name: "Test connection",
			render: (setting) => {
				setting.setName("Test connection");
				const status = setting.descEl.createDiv({ cls: "nr-status" });
				setting.addButton((b) =>
					b
						.setButtonText("Test connection")
						.setCta()
						.onClick(async () => {
							status.className = "nr-status";
							status.setText("Checking…");
							try {
								status.setText(await this.plugin.transport().test());
								status.addClass("nr-status-ok");
							} catch (e) {
								status.setText(e instanceof Error ? e.message : String(e));
								status.addClass("nr-status-error");
							}
						}),
				);
			},
		});

		return [
			{ type: "group", heading: "Connection", items: connection },
			{
				type: "group",
				heading: "Answers",
				items: [
					{
						name: "Answer from general knowledge",
						desc: "When the notes don't explain something, the model explains it from what it knows.",
						control: { type: "toggle", key: "answers.ownKnowledge" },
					},
					{
						name: "Let it search this vault",
						desc: "The model can list, search and read notes (read-only) while answering. What it reads is sent to the service you chose.",
						control: { type: "toggle", key: "answers.vaultSearch" },
					},
					{
						name: "Folders it may not read",
						desc: "One folder per line, e.g. Clients/Acme. See Limitations below for how firmly each service honours this.",
						visible: () => s().answers.vaultSearch,
						control: { type: "textarea", key: FOLDERS_KEY, placeholder: "Clients/Acme", rows: 4 },
					},
					{
						name: "Let it search the web",
						desc: "Uses the service's own web search. Slower, and may cost more per question.",
						control: { type: "toggle", key: "answers.webSearch" },
					},
					{
						name: "Extra instructions",
						desc: "Added to every question, e.g. 'Answer for a product manager.'",
						control: { type: "textarea", key: "answers.extraInstructions", rows: 3 },
					},
					{
						name: "Limitations",
						desc: limitsDesc(),
						searchable: false,
					},
				],
			},
			{
				type: "group",
				heading: "New pages",
				items: [
					{
						name: "Where new pages go",
						control: {
							type: "dropdown",
							key: "pages.location",
							options: { beside: "Beside the note they grew from", folder: "In a folder" },
						},
					},
					{
						name: "Folder for new pages",
						desc: "Vault-relative, e.g. Nested. Created when needed. Leave blank for the vault root.",
						visible: () => s().pages.location === "folder",
						control: { type: "text", key: "pages.folder", placeholder: "Nested" },
					},
					{
						name: "File names",
						desc: "Readable names look like What is a sharp-wave ripple.md; short slugs like what-is-a-sharp-wave-ripple.md. A number is added when the name is taken.",
						control: {
							type: "dropdown",
							key: "pages.fileNames",
							options: { readable: "From the question, readable", slug: "Short slug" },
						},
					},
					{
						name: "Link the phrase to the new page",
						desc: "Rewrites the highlighted words in your note as a link to the page. Skipped, with a notice, when the words can't safely become a link.",
						control: { type: "toggle", key: "pages.linkPhrase" },
					},
					{
						name: "New page opens",
						control: { type: "dropdown", key: "pages.newPageOpens", options: OPENS_LABELS },
					},
					{
						name: "Deep dive opens",
						desc: "In the background, the page is marked unread and a notice appears when it is ready.",
						control: { type: "dropdown", key: "pages.deepDiveOpens", options: OPENS_LABELS },
					},
				],
			},
			{
				type: "group",
				heading: "Nested pages panel",
				items: [
					{
						name: "Show a ribbon icon",
						desc: "Adds a Show nested pages button to the left ribbon.",
						control: { type: "toggle", key: "tree.ribbonIcon" },
					},
					{
						name: "Open the panel when the vault opens",
						desc: "Adds it to the right sidebar without taking focus. Turning this on applies the next time the vault opens.",
						control: { type: "toggle", key: "tree.openOnStartup" },
					},
					{
						name: "Show answer counts",
						desc: "Next to each note, how many quick answers are saved in it.",
						control: { type: "toggle", key: "tree.showAnswerCounts" },
					},
				],
			},
			{
				type: "group",
				heading: "Reading",
				items: [
					{ name: "Show the ask button when text is selected", control: { type: "toggle", key: "showAskButton" } },
					{
						name: "Remember answers",
						desc: "Keep each finished quick answer in this plugin's answers file, so it can be shown again. Turning this off does not delete answers already kept.",
						control: { type: "toggle", key: "rememberAnswers" },
					},
					{ name: "Underline phrases you have asked about", control: { type: "toggle", key: "underlineAnswers" } },
					{
						name: "Show the answer when hovering an underlined phrase",
						control: { type: "toggle", key: "hoverAnswers" },
					},
					{
						name: "Open the answer when clicking an underlined phrase",
						desc: "Reopens it as a card under the paragraph, ready for a follow-up. Links inside the phrase still open.",
						control: { type: "toggle", key: "clickOpensAnswers" },
					},
				],
			},
			{
				type: "group",
				heading: "Context sent with each question",
				items: [
					{ name: "Highlight and its paragraph", control: { type: "toggle", key: "context.highlight" } },
					{ name: "Other pages in this thread", control: { type: "toggle", key: "context.session" } },
					{ name: "Pages in the same folder", control: { type: "toggle", key: "context.folder" } },
				],
			},
		];
	}
}

const LIMITS_URL = "https://github.com/mstublefield/obsidian-nested-reader#limitations";

/** Kept to two short sentences: the settings screen has little room, the README has the detail. */
function limitsDesc(): DocumentFragment {
	const frag = createFragment();
	frag.appendText("With the ChatGPT plan, excluded folders are only a request the model may ignore. Perplexity always searches the web. ");
	frag.createEl("a", { text: "Read about the limits", href: LIMITS_URL });
	return frag;
}

function modelDesc(svc: Service): DocumentFragment {
	const info = SERVICES[svc];
	const frag = createFragment();
	if (svc === "perplexity") {
		frag.appendText("A preset (fast, low, medium, high) or a provider/model ID such as ");
		frag.createEl("code", { text: info.example });
		frag.appendText(". ");
	} else {
		frag.appendText("Exact model ID, e.g. ");
		frag.createEl("code", { text: info.example });
		frag.appendText(". ");
	}
	frag.createEl("a", { text: `See ${info.label}'s model list`, href: info.docsUrl });
	return frag;
}
