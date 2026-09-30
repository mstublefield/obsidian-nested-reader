import { describe, expect, it } from "vitest";
import { parseFrontMatter, serializeFrontMatter } from "../src/lib/frontmatter";
import { slugify, uniquePath } from "../src/lib/slug";
import { buildTree } from "../src/lib/tree";
import type { PageMeta } from "../src/platform/types";

// Smoke tests: the upstream helpers compile and behave as the plugin relies on them to.
describe("upstream helpers", () => {
	it("round-trips front matter with a title that needs quoting", () => {
		const raw = serializeFrontMatter({ title: 'Replay: "why"', source: "parent.md", mode: "new-page" }) + "Body";
		const { meta, body } = parseFrontMatter(raw);
		expect(meta).toEqual({ title: 'Replay: "why"', source: "parent.md", mode: "new-page" });
		expect(body.trim()).toBe("Body");
	});

	it("slugs and de-duplicates child page paths beside the parent", () => {
		expect(slugify("What is a sharp-wave ripple?")).toBe("what-is-a-sharp-wave-ripple");
		const taken = new Set(["notes/what-is-it.md"]);
		expect(uniquePath("what-is-it", taken, "notes")).toBe("notes/what-is-it-2.md");
	});

	it("hangs children under their source", () => {
		const pages: Record<string, PageMeta> = {
			"a.md": { path: "a.md", title: "A" },
			"b.md": { path: "b.md", title: "B", source: "a.md" },
		};
		const tree = buildTree(pages);
		// A flat list in display order; nesting is carried by depth.
		expect(tree.map((t) => [t.path, t.depth])).toEqual([
			["a.md", 0],
			["b.md", 1],
		]);
	});
});
