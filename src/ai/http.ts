import { request } from "../node";

/** A non-2xx response, with its status kept so callers can tell a rejected request from a dead connection. */
export class HttpError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
		this.name = "HttpError";
	}
}

/**
 * POSTs JSON and streams the response body as text. Uses Node's https rather
 * than fetch: it needs no CORS opt-in from any provider, and the plugin is
 * desktop only. Non-2xx responses reject with a readable message.
 */
export function postStream(
	url: string,
	headers: Record<string, string>,
	body: unknown,
	onText: (chunk: string) => void,
	signal?: AbortSignal,
	serviceLabel = "AI service",
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
		const payload = JSON.stringify(body);
		const req = request(
			url,
			{
				method: "POST",
				headers: { ...headers, "content-type": "application/json", "content-length": new TextEncoder().encode(payload).length },
			},
			(res) => {
				res.setEncoding("utf8");
				const status = res.statusCode ?? 0;
				if (status < 200 || status >= 300) {
					let text = "";
					res.on("data", (c: string) => (text += c));
					res.on("end", () => finish(new HttpError(status, httpErrorMessage(status, text, serviceLabel))));
					res.on("error", (e) => finish(e));
					return;
				}
				res.on("data", (c: string) => {
					try {
						onText(c);
					} catch (e) {
						req.destroy();
						finish(e instanceof Error ? e : new Error(String(e)));
					}
				});
				res.on("end", () => finish());
				res.on("error", (e) => finish(e));
			},
		);

		let settled = false;
		const onAbort = () => {
			req.destroy();
			finish(new DOMException("Aborted", "AbortError"));
		};
		function finish(err?: Error) {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			if (err) reject(err);
			else resolve();
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		req.on("error", (e) => finish(e));
		req.end(payload);
	});
}

/** Turns an error response into a sentence fit to show the user. */
export function httpErrorMessage(status: number, body: string, serviceLabel: string): string {
	if (status === 401 || status === 403) return `The ${serviceLabel} API key was refused. Check it in settings.`;
	try {
		const j = JSON.parse(body) as { error?: unknown; message?: unknown };
		const e = j.error;
		if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
			return (e as { message: string }).message;
		}
		if (typeof j.message === "string") return j.message;
		if (typeof e === "string") return e;
	} catch {
		// not JSON
	}
	return `HTTP ${status}`;
}
