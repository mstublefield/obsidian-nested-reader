import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Obsidian attaches a view by calling view.open(containerEl). A view method with the same name (or one of
// the other lifecycle names) silently replaces it and the view never appears; that happened once with a
// private open(file) in the Nested pages panel.
const RESERVED = ["open", "close", "load", "unload", "onload", "onunload"];

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
		d.isDirectory() ? sources(join(dir, d.name)) : d.name.endsWith(".ts") ? [join(dir, d.name)] : [],
	);
}

describe("view classes", () => {
	const views = sources("src").filter((f) => /extends (ItemView|View|FileView|MarkdownView)\b/.test(readFileSync(f, "utf8")));

	it("finds the Nested pages view", () => {
		expect(views.some((f) => f.endsWith("tree-view.ts"))).toBe(true);
	});

	it.each(views)("%s does not shadow Obsidian lifecycle methods", (file) => {
		const src = readFileSync(file, "utf8");
		for (const name of RESERVED) {
			expect(src, `${file} defines ${name}()`).not.toMatch(new RegExp(`^\\s*(private |protected |public )?(async )?${name}\\(`, "m"));
		}
	});
});
