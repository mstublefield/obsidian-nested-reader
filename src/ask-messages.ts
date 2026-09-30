// Pure glue to the upstream prompt builder. Must not import "obsidian".
import type { Settings } from "./platform/types";
import type { AnswerSettings, NestedSettings } from "./settings-model";

/**
 * The upstream prompt builder reads only `settings.context.{highlight,session,folder}` and
 * `settings.tools` from a `Settings` that describes the whole desktop app. This is the one place
 * that pretends our small settings are that type. `tools` follows the vault-search setting, which
 * makes upstream add its own sentence about the tools; `systemAddendum` clarifies that sentence.
 */
export function promptSettings(context: NestedSettings["context"], tools = false): Settings {
	return { context, tools } as unknown as Settings;
}

/**
 * What the Answers settings add to the system prompt, in a fixed order, only when they apply.
 * Returns "" when nothing applies.
 */
export function systemAddendum(answers: AnswerSettings): string {
	const parts: string[] = [];
	if (answers.ownKnowledge) {
		parts.push(
			"The pages are context, not a limit: if they don't explain something the reader asks about, answer from your own knowledge, and don't say that the text doesn't explain it.",
		);
	}
	if (answers.vaultSearch) {
		let s =
			"You can look things up in the reader's notes with the tools provided; the notes are an Obsidian vault, and the session folder above means the whole vault.";
		if (answers.excludeFolders.length) s += ` Never read these folders: ${answers.excludeFolders.join(", ")}.`;
		parts.push(s);
	}
	if (answers.webSearch) {
		parts.push("You can search the web when the notes and your own knowledge are not enough; mention sources briefly.");
	}
	let out = parts.join(" ");
	const extra = answers.extraInstructions.trim();
	if (extra) out = out ? `${out}\n\n${extra}` : extra;
	return out;
}
