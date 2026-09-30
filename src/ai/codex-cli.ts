import { spawn } from "child_process";
import { childEnv, findBin, neutralCwd } from "./claude-cli";
import { CodexStreamReducer } from "./codex-stream";
import { buildTranscript, splitSystem } from "./transcript";
import type { AiRequest, StreamHandlers, StreamResult, Transport } from "./transport";

const NOT_FOUND = "The codex command-line tool isn't installed, or wasn't found. Set its path in settings.";
const NOT_SIGNED_IN = "Not signed in to Codex. Run `codex login` in a terminal.";

const lastLine = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).pop();

export class CodexCliTransport implements Transport {
	constructor(private getBinOverride: () => string) {}

	stream(req: AiRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
		const bin = findBin("codex", this.getBinOverride());
		if (!bin) return Promise.reject(new Error(NOT_FOUND));
		const { system, turns } = splitSystem(req.system, req.messages);
		const transcript = buildTranscript(turns);
		// `codex exec` has no system-prompt flag, so the instructions lead the prompt.
		const prompt = system ? `${system}\n\n---\n\n${transcript}` : transcript;
		const model = req.model.trim();
		// The trailing "-" makes codex read the prompt from stdin.
		const args = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only"];
		if (model) args.push("--model", model);
		args.push("-");

		return new Promise<StreamResult>((resolve, reject) => {
			const child = spawn(bin, args, { cwd: neutralCwd(), env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
			const reducer = new CodexStreamReducer();
			let text = "";
			let overBudget = false;
			let aborted = false;
			let lineBuf = "";
			let stderr = "";
			const budget = req.maxTokens * 8; // chars; backstop since codex has no max-tokens flag

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
				for (const t of step.tools) handlers.onTool?.(t);
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
			child.on("error", (e) => reject(new Error(`Couldn't start Codex: ${e.message}`)));
			child.on("close", (code) => {
				signal?.removeEventListener("abort", onAbort);
				handleLine(lineBuf);
				if (aborted) return reject(new DOMException("Aborted", "AbortError"));
				if (reducer.failure) return reject(new Error(reducer.failure));
				if (code !== 0 && !overBudget && !text) {
					return reject(new Error(lastLine(stderr) ?? "Codex exited with an error"));
				}
				resolve({ text, truncated: overBudget });
			});

			child.stdin.on("error", () => {}); // child may exit before reading; close handler reports it
			child.stdin.end(prompt);
		});
	}

	test(): Promise<string> {
		const bin = findBin("codex", this.getBinOverride());
		if (!bin) return Promise.reject(new Error(NOT_FOUND));
		return new Promise((resolve, reject) => {
			const child = spawn(bin, ["login", "status"], {
				cwd: neutralCwd(), env: childEnv(), stdio: ["ignore", "pipe", "pipe"],
			});
			let out = "";
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (c: string) => (out += c));
			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (c: string) => (out += c));
			child.on("error", (e) => reject(new Error(`Couldn't start Codex: ${e.message}`)));
			child.on("close", (code) => {
				if (code === 0 && out.includes("Logged in")) return resolve("Signed in to ChatGPT (codex).");
				reject(new Error(NOT_SIGNED_IN));
			});
		});
	}
}
