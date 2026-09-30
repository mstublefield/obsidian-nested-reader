// Pure argument building for the CLI transports. Must not import "obsidian" or node modules.
import type { AiRequest } from "./transport";

const VAULT_TOOLS = ["Read", "Grep", "Glob"];
const WEB_TOOLS = ["WebSearch", "WebFetch"];

/** Claude Code's tool names for this request; empty means a plain one-turn answer. */
export function claudeToolNames(req: AiRequest): string[] {
	return [...(req.vaultDir ? VAULT_TOOLS : []), ...(req.webSearch ? WEB_TOOLS : [])];
}

/** A permission-rule path: absolute paths need a leading `//`; glob characters in a name are escaped. */
export function readDenyRule(absDir: string): string {
	const p = absDir.replace(/\\/g, "/").replace(/\/+$/, "");
	const escaped = p.replace(/[*?[\]]/g, (c) => `\\${c}`);
	return `Read(/${escaped.startsWith("/") ? escaped : `/${escaped}`}/**)`;
}

/** What the CLI is told about the vault, since its own tools can reach more than the settings allow. */
export function vaultNote(req: AiRequest): string | undefined {
	if (!req.vaultDir) return undefined;
	let note = `The reader's notes are an Obsidian vault at ${req.vaultDir}. Its Markdown files are the notes; read only inside it, and ignore its dot-folders such as .obsidian.`;
	if (req.excludeDirs?.length) {
		note += ` Never read, search or quote anything inside these folders: ${req.excludeDirs.join(", ")}.`;
	}
	return note;
}

export function claudeSystem(req: AiRequest, system: string | undefined): string | undefined {
	const note = vaultNote(req);
	if (!note) return system;
	return system ? `${system}\n\n${note}` : note;
}

/** The full `claude -p` argument list (without the prompt, which goes on stdin). */
export function claudeArgs(req: AiRequest, system: string | undefined): string[] {
	const tools = claudeToolNames(req);
	const args = [
		"-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
		"--no-session-persistence", "--setting-sources", "", "--strict-mcp-config",
	];
	if (tools.length) {
		// Print mode cannot ask for permission, so the read-only set is approved up front.
		args.push("--max-turns", "12", "--tools", tools.join(","), "--allowedTools", tools.join(","));
		if (req.vaultDir) args.push("--add-dir", req.vaultDir);
		if (req.vaultDir) {
			// The vault's own settings folder holds other plugins' data, which can include tokens.
			const denied = [`${req.vaultDir}/.obsidian`, ...(req.excludeDirs ?? [])];
			args.push("--disallowedTools", ...denied.map(readDenyRule));
		}
	} else {
		args.push("--max-turns", "1", "--tools", "");
	}
	args.push("--model", req.model);
	const sys = claudeSystem(req, system);
	if (sys) args.push("--system-prompt", sys);
	return args;
}

/** The `codex exec` argument list; the trailing "-" makes it read the prompt from stdin. */
export function codexArgs(req: AiRequest): string[] {
	const args = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only"];
	if (req.vaultDir) args.push("--cd", req.vaultDir);
	// `--search` is a top-level flag that `exec` lacks; the config key it sets works here.
	args.push("-c", `web_search="${req.webSearch ? "live" : "disabled"}"`);
	const model = req.model.trim();
	if (model) args.push("--model", model);
	args.push("-");
	return args;
}

export function codexPrompt(req: AiRequest, system: string | undefined, transcript: string): string {
	const sys = claudeSystem(req, system);
	return sys ? `${sys}\n\n---\n\n${transcript}` : transcript;
}
