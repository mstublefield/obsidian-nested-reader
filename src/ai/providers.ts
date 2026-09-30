import type { Service } from "../settings-model";

export type ResponsesProvider = {
	service: Exclude<Service, "anthropic">;
	label: string;
	url: string;
	/** GET endpoint used by "Test connection". */
	testUrl: string;
	/** Low effort keeps reasoning tokens from eating the whole output budget. */
	reasoning?: { effort: string };
	/** Perplexity: a model value without "/" is a preset, not a model. */
	presets?: boolean;
};

export const PROVIDERS: Record<"openai" | "xai" | "perplexity", ResponsesProvider> = {
	openai: {
		service: "openai",
		label: "OpenAI",
		url: "https://api.openai.com/v1/responses",
		testUrl: "https://api.openai.com/v1/models",
		reasoning: { effort: "low" },
	},
	xai: {
		service: "xai",
		label: "xAI",
		url: "https://api.x.ai/v1/responses",
		testUrl: "https://api.x.ai/v1/models",
	},
	perplexity: {
		service: "perplexity",
		label: "Perplexity",
		url: "https://api.perplexity.ai/v1/agent",
		testUrl: "https://api.perplexity.ai/v1/models",
		presets: true,
	},
};
