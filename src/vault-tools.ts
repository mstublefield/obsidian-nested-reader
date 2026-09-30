import { type App, FileSystemAdapter, TFile } from "obsidian";
import type { ToolSet } from "./ai/transport";
import {
	checkReadPath,
	clipPage,
	describeTool,
	formatList,
	isVisibleNote,
	titleOf,
	VAULT_TOOLS,
	type ListEntry,
} from "./vault-rules";
import { ENOUGH_FILES, ENOUGH_LINES, formatSearch, scanLines, searchTerms, type Candidate } from "./vault-search";

/** The most files the fallback search opens, so a huge vault cannot stall a question. */
const SCAN_CAP = 3000;
const YIELD_EVERY = 40;
/** How many of Omnisearch's best notes get their matching lines collected. */
const OMNI_CANDIDATES = 25;
const BODY_CLIP = 12_000;

/** The part of Omnisearch's public API used here: https://publish.obsidian.md/omnisearch/Public+API+%26+URL+Scheme */
type OmnisearchApi = { search(query: string): Promise<{ path: string; score?: number }[]> };

function omnisearch(): OmnisearchApi | null {
	const api = (window as unknown as { omnisearch?: unknown }).omnisearch;
	return api && typeof (api as OmnisearchApi).search === "function" ? (api as OmnisearchApi) : null;
}

/** The vault's absolute path, or null when it is not on the local file system. */
export function vaultBasePath(app: App): string | null {
	const adapter = app.vault.adapter;
	return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
}

const tick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

/** Read-only vault tools. `excluded` (vault-relative folders) is enforced in every one of them. */
export function createVaultToolSet(app: App, excluded: readonly string[]): ToolSet {
	const visibleFiles = () => app.vault.getMarkdownFiles().filter((f) => isVisibleNote(f.path, excluded));

	function listPages(): string {
		const files = visibleFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
		const entries: ListEntry[] = files.map((f) => {
			const cache = app.metadataCache.getFileCache(f);
			const fm: Record<string, unknown> | undefined = cache?.frontmatter;
			const t = typeof fm?.title === "string" && fm.title.trim() ? fm.title.trim() : undefined;
			const h1 = cache?.headings?.find((h) => h.level === 1)?.heading;
			return { path: f.path, title: t ?? h1 ?? f.basename };
		});
		return formatList(entries);
	}

	async function readPage(path: unknown): Promise<string> {
		const check = checkReadPath(typeof path === "string" ? path : "", excluded);
		if (!check.ok) return check.error;
		const file = app.vault.getAbstractFileByPath(check.path);
		if (!(file instanceof TFile)) return `${check.path} is not a note in this vault. Use search_pages or list_pages to find the right path.`;
		return clipPage(await app.vault.cachedRead(file));
	}

	async function candidateFrom(file: TFile, query: string, terms: string[]): Promise<Candidate> {
		const raw = await app.vault.cachedRead(file);
		return { path: file.path, title: titleOf(raw, file.path), body: raw.slice(0, BODY_CLIP), ...scanLines(raw, query, terms) };
	}

	async function viaOmnisearch(api: OmnisearchApi, query: string, terms: string[]): Promise<string | null> {
		try {
			const results = await api.search(query);
			const paths = results
				.map((r) => r.path)
				.filter((p) => typeof p === "string" && isVisibleNote(p, excluded))
				.slice(0, OMNI_CANDIDATES);
			const out: Candidate[] = [];
			for (const p of paths) {
				const f = app.vault.getAbstractFileByPath(p);
				if (f instanceof TFile) out.push(await candidateFrom(f, query, terms));
			}
			// Omnisearch found nothing, or none of it could be read: let the scan have a go.
			if (!out.length) return null;
			return formatSearch(query, out, { ordered: true });
		} catch {
			return null;
		}
	}

	async function viaScan(query: string, terms: string[]): Promise<string> {
		const files = visibleFiles().sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, SCAN_CAP);
		const found: Candidate[] = [];
		let lines = 0;
		let verbatimFiles = 0;
		let partial = files.length >= SCAN_CAP;
		for (let i = 0; i < files.length; i++) {
			if (i > 0 && i % YIELD_EVERY === 0) await tick();
			const c = await candidateFrom(files[i], query, terms);
			if (!c.verbatim.length && !c.loose.length) continue;
			found.push(c);
			if (c.verbatim.length) {
				verbatimFiles++;
				lines += c.verbatim.length;
			}
			if (lines >= ENOUGH_LINES || verbatimFiles >= ENOUGH_FILES) {
				partial = true;
				break;
			}
		}
		return formatSearch(query, found, { partial });
	}

	async function searchPages(query: unknown): Promise<string> {
		const q = typeof query === "string" ? query.trim() : "";
		if (!q) return "Give some words to search for.";
		const terms = searchTerms(q);
		const api = omnisearch();
		if (api) {
			const viaApi = await viaOmnisearch(api, q, terms);
			if (viaApi !== null) return viaApi;
		}
		return viaScan(q, terms);
	}

	return {
		definitions: VAULT_TOOLS,
		describe: describeTool,
		async run(name, input) {
			const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
			switch (name) {
				case "list_pages":
					return listPages();
				case "read_page":
					return readPage(inp.path);
				case "search_pages":
					return searchPages(inp.query);
				default:
					return `Unknown tool: ${name}`;
			}
		},
	};
}
