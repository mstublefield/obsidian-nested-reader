type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

export type CodexStep = { texts: string[]; tools: string[] };

/** Reducer over the JSON lines of `codex exec --json`. Port of upstream's Rust logic. */
export class CodexStreamReducer {
	failure: string | null = null;
	done = false;
	/** Codex has no stop reason, so truncation is only ever detected by the caller's budget. */
	readonly truncated = false;

	push(line: unknown): CodexStep {
		const step: CodexStep = { texts: [], tools: [] };
		if (this.done || !isObj(line)) return step;
		const item = isObj(line.item) ? line.item : undefined;

		if (line.type === "item.started" && item?.type === "command_execution") {
			const command = (typeof item.command === "string" ? item.command : "").trim().replace(/\n/g, " ");
			const short = [...command].slice(0, 60).join("");
			step.tools.push(short ? `Running \`${short}\`` : "Running a command");
		} else if (line.type === "item.completed" && item?.type === "agent_message") {
			if (typeof item.text === "string") step.texts.push(item.text);
		} else if (line.type === "turn.completed") {
			this.done = true;
		} else if (line.type === "turn.failed" || line.type === "error") {
			const err = isObj(line.error) ? line.error : undefined;
			this.failure =
				(typeof err?.message === "string" ? err.message : undefined) ??
				(typeof line.message === "string" ? line.message : undefined) ??
				"Codex returned an error";
			this.done = true;
		}
		return step;
	}
}
