import type { StreamHandlers, StreamResult } from "./ai/transport";
import type { AskRecord } from "./ask-record";
import { buildAskContext } from "./context";
import { quickAnswerMessages } from "./lib/prompts";
import type NestedReaderPlugin from "./main";
import type { AskTarget } from "./reader/target";

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
	return plugin
		.transport()
		.stream(
			{ system, messages, model: plugin.model("quick"), maxTokens: plugin.maxTokens("quick") },
			handlers,
			signal,
		);
}
