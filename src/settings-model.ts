// Pure settings model and migration. Must not import "obsidian" so vitest can load it.
import { cleanFolder, type FileNames, type PageLocation } from "./pages/names";
import { normalizeFolders } from "./vault-rules";

export type Service = "anthropic" | "openai" | "xai" | "perplexity";
export type Access = "plan" | "api";
export type Slot = "quick" | "pages";
export type NestedSettings = {
	service: Service;
	/** xAI and Perplexity have no plan CLI, so they are always "api". */
	access: { anthropic: Access; openai: Access };
	/** "" = auto-detect. */
	cliPath: { anthropic: string; openai: string };
	/** Names of secrets in app.secretStorage; the keys themselves are never in data.json. */
	apiKeySecret: Record<Service, string>;
	/** Exact model IDs, sent verbatim. */
	models: Record<Service, Record<Slot, string>>;
	maxTokens: Record<Slot, number>;
	context: { highlight: boolean; session: boolean; folder: boolean; map: boolean };
	answers: AnswerSettings;
	pages: PageSettings;
	tree: TreeSettings;
	/** Show the floating Ask pill under a finished text selection. */
	showAskButton: boolean;
	/** Keep each finished Quick answer, in the plugin's answers.json, so it can be shown again. */
	rememberAnswers: boolean;
	/** Give phrases you have asked about a dotted underline. */
	underlineAnswers: boolean;
	/** Show the answer in a small popover when the pointer rests on an underlined phrase. */
	hoverAnswers: boolean;
	/** Clicking an underlined phrase reopens its answer as a card, ready for a follow-up. */
	clickOpensAnswers: boolean;
};

export type AnswerSettings = {
	/** Tell the model the pages are context, not a limit, so it answers from what it knows. */
	ownKnowledge: boolean;
	/** Let the model list, search and read notes (read-only) while it answers. */
	vaultSearch: boolean;
	/** Vault-relative folder paths the model may never read or be sent. */
	excludeFolders: string[];
	/** Turn on the service's own web search. */
	webSearch: boolean;
	/** Added verbatim to every question's instructions. */
	extraInstructions: string;
};

export type TreeSettings = {
	/** Put a "Show nested pages" icon in the left ribbon. */
	ribbonIcon: boolean;
	/** Add the Nested pages panel to the right sidebar when the vault opens, without taking focus. */
	openOnStartup: boolean;
	/** Show the number of saved quick answers next to each note in the panel. */
	showAnswerCounts: boolean;
};

/** Where a page opens once it exists. */
export type Opens = "split" | "tab" | "current" | "background";
export const OPENS: readonly Opens[] = ["split", "tab", "current", "background"];

export type PageSettings = {
	/** Beside the note the page grew from, or in one folder. */
	location: PageLocation;
	/** Vault-relative folder, used when `location` is "folder". */
	folder: string;
	/** Readable names ("What is a ripple.md") or short slugs ("what-is-a-ripple.md"). */
	fileNames: FileNames;
	/** Rewrite the highlighted words in the parent note as a link to the new page. */
	linkPhrase: boolean;
	newPageOpens: Opens;
	deepDiveOpens: Opens;
};

export type ServiceInfo = {
	label: string;
	hasPlan: boolean;
	planLabel?: string;
	docsUrl: string;
	/** Shown in the model field's description. */
	example: string;
};

export const SERVICE_ORDER: Service[] = ["anthropic", "openai", "xai", "perplexity"];

export const SERVICES: Record<Service, ServiceInfo> = {
	anthropic: {
		label: "Claude",
		hasPlan: true,
		planLabel: "Claude plan (claude command-line tool)",
		docsUrl: "https://platform.claude.com/docs/en/about-claude/models/overview",
		example: "claude-sonnet-5-5",
	},
	openai: {
		label: "OpenAI",
		hasPlan: true,
		planLabel: "ChatGPT plan (codex command-line tool)",
		docsUrl: "https://developers.openai.com/api/docs/models",
		example: "gpt-6.1-sol",
	},
	xai: {
		label: "Grok (xAI)",
		hasPlan: false,
		docsUrl: "https://docs.x.ai/developers/models",
		example: "grok-4.7",
	},
	perplexity: {
		label: "Perplexity",
		hasPlan: false,
		docsUrl: "https://docs.perplexity.ai/docs/agent-api/models",
		example: "anthropic/claude-sonnet-5-5",
	},
};

export const DEFAULT_SETTINGS: NestedSettings = {
	service: "anthropic",
	access: { anthropic: "plan", openai: "api" },
	cliPath: { anthropic: "", openai: "" },
	apiKeySecret: {
		anthropic: "anthropic-api-key",
		openai: "openai-api-key",
		xai: "xai-api-key",
		perplexity: "perplexity-api-key",
	},
	models: {
		anthropic: { quick: "claude-haiku-4-5", pages: "claude-sonnet-5-5" },
		openai: { quick: "gpt-6-luna", pages: "gpt-6.1-sol" },
		xai: { quick: "grok-4.20-0309-non-reasoning", pages: "grok-4.7" },
		perplexity: { quick: "fast", pages: "medium" },
	},
	maxTokens: { quick: 2048, pages: 8192 },
	context: { highlight: true, session: true, folder: true, map: false },
	answers: { ownKnowledge: true, vaultSearch: true, excludeFolders: [], webSearch: false, extraInstructions: "" },
	pages: {
		location: "beside",
		folder: "Nested",
		fileNames: "readable",
		linkPhrase: true,
		newPageOpens: "split",
		deepDiveOpens: "background",
	},
	tree: { ribbonIcon: true, openOnStartup: false, showAnswerCounts: true },
	showAskButton: true,
	rememberAnswers: true,
	underlineAnswers: true,
	hoverAnswers: true,
	clickOpensAnswers: true,
};

export function accessFor(settings: NestedSettings, service: Service): Access {
	if (service === "anthropic" || service === "openai") return settings.access[service];
	return "api";
}

const OLD_ALIASES: Record<string, string> = {
	haiku: "claude-haiku-4-5",
	sonnet: "claude-sonnet-5-5",
	opus: "claude-opus-5-5",
	fable: "claude-fable-5-1",
};

function isPlain(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The first release stored one Claude-only shape: `transport` plus models split by transport. */
function isOldShape(raw: unknown): raw is Record<string, unknown> {
	return isPlain(raw) && typeof raw.transport === "string" && !("service" in raw);
}

function migrateOld(old: Record<string, unknown>): Record<string, unknown> {
	const cli = old.transport === "cli";
	const models = isPlain(old.models) ? old.models : {};
	const slots = (isPlain(models[cli ? "cli" : "api"]) ? models[cli ? "cli" : "api"] : {}) as Record<string, unknown>;
	const other = (isPlain(models[cli ? "api" : "cli"]) ? models[cli ? "api" : "cli"] : {}) as Record<string, unknown>;
	const pick = (slot: Slot): string | undefined => {
		const v = [slots[slot], other[slot]].find((x) => typeof x === "string" && x.trim() !== "");
		return typeof v === "string" ? (OLD_ALIASES[v.trim()] ?? v.trim()) : undefined;
	};
	const tokens = isPlain(old.maxTokens) ? old.maxTokens : {};
	return {
		service: "anthropic",
		access: { anthropic: cli ? "plan" : "api" },
		cliPath: { anthropic: old.cliPath },
		apiKeySecret: { anthropic: old.apiKeySecret },
		models: { anthropic: { quick: pick("quick"), pages: pick("pages") } },
		maxTokens: {
			quick: tokens.quick === 1024 ? DEFAULT_SETTINGS.maxTokens.quick : tokens.quick,
			pages: tokens.pages === 4096 ? DEFAULT_SETTINGS.maxTokens.pages : tokens.pages,
		},
		context: old.context,
	};
}

/** Deep-merges saved data over defaults, so new keys get defaults. Also migrates the first release's shape. */
export function mergeSettings(raw: unknown): NestedSettings {
	const saved = isOldShape(raw) ? migrateOld(raw) : raw;
	const merge = (base: unknown, over: unknown): unknown => {
		if (!isPlain(base)) return over === undefined || typeof over !== typeof base ? base : over;
		const o = isPlain(over) ? over : {};
		return Object.fromEntries(Object.keys(base).map((k) => [k, merge(base[k], o[k])]));
	};
	const merged = merge(DEFAULT_SETTINGS, saved) as NestedSettings;
	merged.answers.excludeFolders = normalizeFolders(merged.answers.excludeFolders);
	// A value from an older or hand-edited file that is not one of the choices falls back to its default.
	const d = DEFAULT_SETTINGS.pages;
	const p = merged.pages;
	if (p.location !== "beside" && p.location !== "folder") p.location = d.location;
	if (p.fileNames !== "readable" && p.fileNames !== "slug") p.fileNames = d.fileNames;
	if (!OPENS.includes(p.newPageOpens)) p.newPageOpens = d.newPageOpens;
	if (!OPENS.includes(p.deepDiveOpens)) p.deepDiveOpens = d.deepDiveOpens;
	p.folder = cleanFolder(p.folder);
	return merged;
}

export function getPath(obj: unknown, path: string): unknown {
	let cur: unknown = obj;
	for (const k of path.split(".")) {
		if (!isPlain(cur)) return undefined;
		cur = cur[k];
	}
	return cur;
}

/** Sets a dotted path, creating intermediate objects as needed. */
export function setPath(obj: object, path: string, value: unknown): void {
	const keys = path.split(".");
	const last = keys.pop() as string;
	let cur = obj as Record<string, unknown>;
	for (const k of keys) {
		if (!isPlain(cur[k])) cur[k] = {};
		cur = cur[k] as Record<string, unknown>;
	}
	cur[last] = value;
}
