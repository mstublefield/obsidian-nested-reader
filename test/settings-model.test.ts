import { describe, expect, it } from "vitest";
import { accessFor, DEFAULT_SETTINGS, getPath, mergeSettings, setPath } from "../src/settings-model";

const OLD = {
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

describe("mergeSettings", () => {
	it("gives defaults for nothing", () => {
		expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings(undefined).service).toBe("anthropic");
		expect(DEFAULT_SETTINGS.access).toEqual({ anthropic: "plan", openai: "api" });
		expect(DEFAULT_SETTINGS.maxTokens).toEqual({ quick: 2048, pages: 8192 });
	});

	it("keeps saved new-shape values and fills gaps", () => {
		const s = mergeSettings({ service: "xai", models: { xai: { pages: "grok-9" } } });
		expect(s.service).toBe("xai");
		expect(s.models.xai).toEqual({ quick: "grok-4.20-0309-non-reasoning", pages: "grok-9" });
		expect(s.models.openai).toEqual(DEFAULT_SETTINGS.models.openai);
	});

	it("migrates the first release's shape", () => {
		const s = mergeSettings(OLD);
		expect(s.service).toBe("anthropic");
		expect(s.access.anthropic).toBe("plan");
		expect(s.cliPath.anthropic).toBe("");
		expect(s.apiKeySecret.anthropic).toBe("anthropic-api-key");
		expect(s.models.anthropic).toEqual({ quick: "claude-haiku-4-5", pages: "claude-sonnet-5-5" });
		expect(s.maxTokens).toEqual({ quick: 2048, pages: 8192 });
		expect(s.context).toEqual(OLD.context);
	});

	it("migrates an api user, keeping custom values", () => {
		const s = mergeSettings({
			...OLD,
			transport: "api",
			cliPath: "/x/claude",
			models: { cli: { quick: "opus", pages: "sonnet" }, api: { quick: "claude-custom-1", pages: "fable" } },
			maxTokens: { quick: 500, pages: 4096 },
		});
		expect(s.access.anthropic).toBe("api");
		expect(s.cliPath.anthropic).toBe("/x/claude");
		expect(s.models.anthropic).toEqual({ quick: "claude-custom-1", pages: "claude-fable-5-1" });
		expect(s.maxTokens).toEqual({ quick: 500, pages: 8192 });
	});
});

describe("accessFor", () => {
	it("is always api for services without a plan CLI", () => {
		const s = mergeSettings(null);
		expect(accessFor(s, "xai")).toBe("api");
		expect(accessFor(s, "perplexity")).toBe("api");
		expect(accessFor(s, "anthropic")).toBe("plan");
		expect(accessFor(s, "openai")).toBe("api");
	});
});

describe("getPath / setPath", () => {
	it("reads and writes dotted keys", () => {
		const o: Record<string, unknown> = { a: { b: { c: 1 } } };
		expect(getPath(o, "a.b.c")).toBe(1);
		expect(getPath(o, "a.x.c")).toBeUndefined();
		setPath(o, "a.b.c", 2);
		setPath(o, "d.e", "x");
		expect(getPath(o, "a.b.c")).toBe(2);
		expect(getPath(o, "d.e")).toBe("x");
	});
});

describe("tree settings", () => {
	it("has defaults and merges over them", () => {
		expect(DEFAULT_SETTINGS.tree).toEqual({ ribbonIcon: true, openOnStartup: false, showAnswerCounts: true });
		const s = mergeSettings({ tree: { openOnStartup: true } });
		expect(s.tree).toEqual({ ribbonIcon: true, openOnStartup: true, showAnswerCounts: true });
	});
});
