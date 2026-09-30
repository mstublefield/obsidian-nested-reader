import type { AiRequest, StreamHandlers, StreamResult } from "./ai/transport";
import { systemAddendum } from "./ask-messages";
import type { AskRecord } from "./ask-record";
import { buildAskContext } from "./context";
import { quickAnswerMessages } from "./lib/prompts";
import type NestedReaderPlugin from "./main";
import type { AskTarget } from "./reader/target";
import type { Slot } from "./settings-model";
import { createVaultToolSet, vaultBasePath } from "./vault-tools";

/** Streams a Quick answer to `question` about the target, continuing the record's thread. */
export async function quickAsk(
	plugin: NestedReaderPlugin,
	target: AskTarget,
	record: AskRecord,
	question: string,
	handlers: StreamHandlers,
	signal: AbortSignal,
): Promise<StreamResult> {
	const ctx = await buildAskContext(plugin.app, plugin.settings, {
		file: target.file,
		selection: target.text,
		paragraph: target.paragraph,
		thread: record.thread,
	});
	if (signal.aborted) throw new DOMException("Aborted", "AbortError");
	const { system, messages } = quickAnswerMessages(ctx, question);
	return plugin.transport().stream(buildRequest(plugin, system, messages, "quick", plugin.maxTokens("quick")), handlers, signal);
}

/**
 * The request for a model call: the prompt plus what the Answers settings add, and the vault and web
 * tools the settings allow. Shared by Quick answers and new pages.
 */
export function buildRequest(
	plugin: NestedReaderPlugin,
	system: string,
	messages: AiRequest["messages"],
	slot: Slot,
	maxTokens: number,
): AiRequest {
	const { answers } = plugin.settings;
	const addendum = systemAddendum(answers);
	// The CLIs read the vault by path; the API transports get the plugin's own tools.
	const base = answers.vaultSearch ? vaultBasePath(plugin.app) : null;
	const vaultDir = base && plugin.usesCli() ? base : undefined;
	return {
		system: addendum ? `${system}\n\n${addendum}` : system,
		messages,
		model: plugin.model(slot),
		maxTokens,
		tools: answers.vaultSearch && !plugin.usesCli() ? createVaultToolSet(plugin.app, answers.excludeFolders) : undefined,
		webSearch: answers.webSearch,
		vaultDir,
		excludeDirs: vaultDir ? answers.excludeFolders.map((f) => `${vaultDir}/${f}`) : undefined,
	};
}
