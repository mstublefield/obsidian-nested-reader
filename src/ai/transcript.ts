import type { ChatMessage } from "../platform/types";

/** System-role messages are folded into one system prompt; the rest are the turns. */
export function splitSystem(system: string | undefined, messages: ChatMessage[]) {
	const parts = system ? [system] : [];
	const turns: ChatMessage[] = [];
	for (const m of messages) {
		if (m.role === "system") parts.push(m.content);
		else turns.push(m);
	}
	return { system: parts.length ? parts.join("\n\n") : undefined, turns };
}

/**
 * Flattens turns into one stdin prompt for the CLI, which takes a single
 * prompt rather than a message list. Matches upstream's wording.
 */
export function buildTranscript(turns: ChatMessage[]): string {
	if (turns.length === 1) return turns[0].content;
	let out = "Conversation so far; answer the last message.\n\n";
	for (const m of turns) {
		out += `${m.role === "user" ? "User" : "Assistant"}: ${m.content}\n\n`;
	}
	return out;
}
