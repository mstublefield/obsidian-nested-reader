import { delimiter, env, existsSync, homedir, join, mkdirSync, readdirSync, spawn, tmpdir, type Env } from "../node";
import { claudeArgs } from "./cli-args";
import { CliStreamReducer, NOT_SIGNED_IN } from "./cli-stream";
import { buildTranscript, splitSystem } from "./transcript";
import type { AiRequest, StreamHandlers, StreamResult, Transport } from "./transport";

const NOT_FOUND = "The claude command-line tool isn't installed, or wasn't found. Set its path in settings.";

/** Obsidian launches from the Dock with a minimal PATH, so look in the usual install spots too. */
function searchDirs(): string[] {
	const home = homedir();
	const dirs = [
		...(env().PATH ?? "").split(delimiter),
		join(home, ".local/bin"),
		join(home, ".claude/local"),
		join(home, ".volta/bin"),
		join(home, ".npm-global/bin"),
		join(home, ".bun/bin"),
		join(home, ".cargo/bin"),
	];
	const nvm = join(home, ".nvm/versions/node");
	try {
		for (const v of readdirSync(nvm)) dirs.push(join(nvm, v, "bin"));
	} catch {
		// no nvm
	}
	dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
	return dirs.filter(Boolean);
}

/** Returns the path to a command-line tool, or null when it can't be found. */
export function findBin(name: string, override: string): string | null {
	const o = override.trim();
	if (o && existsSync(o)) return o;
	for (const dir of searchDirs()) {
		const p = join(dir, name);
		if (existsSync(p)) return p;
	}
	return null;
}

export function childEnv(): Env {
	// If claude is a node script it needs `node` on PATH, so extend PATH for the child too.
	return { ...env(), PATH: [...new Set(searchDirs())].join(delimiter) };
}

export function neutralCwd(): string {
	const dir = join(tmpdir(), "nested-cli");
	mkdirSync(dir, { recursive: true });
	return dir;
}

export class ClaudeCliTransport implements Transport {
	constructor(private getBinOverride: () => string) {}

	stream(req: AiRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
		const bin = findBin("claude", this.getBinOverride());
		if (!bin) return Promise.reject(new Error(NOT_FOUND));
		const { system, turns } = splitSystem(req.system, req.messages);
		const args = claudeArgs(req, system);

		return new Promise<StreamResult>((resolve, reject) => {
			const child = spawn(bin, args, { cwd: neutralCwd(), env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
			const reducer = new CliStreamReducer();
			let text = "";
			let overBudget = false;
			let aborted = false;
			let lineBuf = "";
			let stderr = "";
			const budget = req.maxTokens * 8; // chars; backstop since the CLI has no max-tokens flag

			const onAbort = () => {
				aborted = true;
				child.kill();
			};
			if (signal?.aborted) onAbort();
			else signal?.addEventListener("abort", onAbort, { once: true });

			const handleLine = (raw: string) => {
				if (!raw.trim() || overBudget) return;
				let json: unknown;
				try {
					json = JSON.parse(raw);
				} catch {
					return;
				}
				const step = reducer.push(json);
				for (const t of step.texts) {
					text += t;
					handlers.onDelta(t);
				}
				if (step.tools.length) {
					// Text before a tool call is the model thinking aloud, not the answer.
					text = "";
					handlers.onReset?.();
					for (const t of step.tools) handlers.onTool?.(t);
				}
				if (text.length > budget) {
					overBudget = true;
					child.kill();
				}
			};

			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => {
				lineBuf += chunk;
				const lines = lineBuf.split("\n");
				lineBuf = lines.pop() ?? "";
				lines.forEach(handleLine);
			});
			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (c: string) => (stderr += c));
			child.on("error", (e) => reject(new Error(`Couldn't start Claude Code: ${e.message}`)));
			child.on("close", (code) => {
				signal?.removeEventListener("abort", onAbort);
				handleLine(lineBuf);
				if (aborted) return reject(new DOMException("Aborted", "AbortError"));
				if (reducer.failure) return reject(new Error(reducer.failure));
				if (code !== 0 && !overBudget) {
					const last = stderr.split("\n").map((l) => l.trim()).filter(Boolean).pop();
					return reject(new Error(last ?? "Claude Code exited with an error"));
				}
				resolve({ text, truncated: overBudget || reducer.truncated });
			});

			child.stdin.on("error", () => {}); // child may exit before reading; close handler reports it
			child.stdin.end(buildTranscript(turns));
		});
	}

	test(): Promise<string> {
		const bin = findBin("claude", this.getBinOverride());
		if (!bin) return Promise.reject(new Error(NOT_FOUND));
		return new Promise((resolve, reject) => {
			const child = spawn(bin, ["auth", "status", "--json"], {
				cwd: neutralCwd(), env: childEnv(), stdio: ["ignore", "pipe", "pipe"],
			});
			let out = "";
			let err = "";
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (c: string) => (out += c));
			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (c: string) => (err += c));
			child.on("error", (e) => reject(new Error(`Couldn't start Claude Code: ${e.message}`)));
			child.on("close", () => {
				try {
					const s = JSON.parse(out) as { loggedIn?: boolean; subscriptionType?: string };
					if (s.loggedIn === true) {
						const plan = s.subscriptionType ? ` (${s.subscriptionType} plan)` : "";
						return resolve(`Signed in to Claude${plan}.`);
					}
					reject(new Error(NOT_SIGNED_IN));
				} catch {
					const last = err.split("\n").map((l) => l.trim()).filter(Boolean).pop();
					reject(new Error(last ?? "Couldn't read the sign-in status from Claude Code."));
				}
			});
		});
	}
}
