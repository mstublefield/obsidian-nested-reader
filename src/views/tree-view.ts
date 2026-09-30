import { ItemView, Keymap, Menu, type TFile, type ViewStateResult, type WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import { isGrownPage } from "../pages/compose";
import type { PageMeta } from "../platform/types";
import type NestedReaderPlugin from "../main";
import { answerCountText, familyOf, familyRows, type FamilyRow } from "../tree/family";

export const TREE_VIEW_TYPE = "nested-reader-tree";

const EMPTY_TEXT = "Pages you grow from this note with New page or Deep dive will appear here.";

/** The "Nested pages" side panel: the family of the active note, hung under each page's `source`. */
export class NestedTreeView extends ItemView {
	private unreadOnly = false;

	constructor(leaf: WorkspaceLeaf, private plugin: NestedReaderPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return TREE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Nested pages";
	}

	getIcon(): string {
		return "git-fork";
	}

	getState(): Record<string, unknown> {
		return { unreadOnly: this.unreadOnly };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const v = (state as { unreadOnly?: unknown } | null)?.unreadOnly;
		this.unreadOnly = v === true;
		this.render();
		await super.setState(state, result);
	}

	onOpen(): Promise<void> {
		this.contentEl.addClass("nr-tree");
		this.render();
		return Promise.resolve();
	}

	render(): void {
		try {
			this.renderInner();
		} catch (e) {
			const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
			console.error("Nested Reader: couldn't draw the Nested pages panel", msg);
			this.contentEl.empty();
			this.contentEl.createDiv({ cls: "nr-tree-empty", text: `Couldn't draw this panel: ${e instanceof Error ? e.message : String(e)}` });
		}
	}

	private renderInner(): void {
		const { app, settings, answers, pages } = this.plugin;
		const scroller = this.contentEl;
		const top = scroller.scrollTop;
		scroller.empty();

		const active = this.plugin.activeNote();
		if (!active) {
			scroller.createDiv({ cls: "nr-tree-empty", text: "Open a note to see the pages grown from it." });
			return;
		}

		const tracker = this.plugin.tracker;
		const family = familyOf(tracker.index, active.path);
		const metas: Record<string, PageMeta> = {};
		for (const path of family.members) {
			const file = app.vault.getFileByPath(path);
			if (!file) continue;
			const fm: Record<string, unknown> | undefined = app.metadataCache.getFileCache(file)?.frontmatter;
			const title = typeof fm?.title === "string" && fm.title.trim() !== "" ? fm.title.trim() : file.basename;
			const created = typeof fm?.created === "string" && fm.created.trim() !== "" ? fm.created.trim() : new Date(file.stat.ctime).toISOString();
			metas[path] = { path, title, created, source: tracker.index.parentOf(path) };
		}
		const rootTitle = metas[family.root]?.title ?? active.basename;

		const header = scroller.createDiv({ cls: "nr-tree-header" });
		header.createDiv({ cls: "nr-tree-title", text: rootTitle });
		const actions = header.createDiv({ cls: "nr-tree-actions" });
		const filter = actions.createEl("button", { cls: "clickable-icon nr-tree-btn" });
		filter.toggleClass("is-active", this.unreadOnly);
		filter.setAttr("aria-pressed", String(this.unreadOnly));
		setIcon(filter, "filter");
		setTooltip(filter, this.unreadOnly ? "Show all pages" : "Show unread only");
		filter.addEventListener("click", () => {
			this.unreadOnly = !this.unreadOnly;
			this.app.workspace.requestSaveLayout();
			this.render();
		});

		const alone = family.members.length <= 1;
		if (alone) scroller.createDiv({ cls: "nr-tree-empty", text: EMPTY_TEXT });

		const rows = familyRows(family, metas, pages.state, this.unreadOnly && !alone);
		if (!rows.length) {
			scroller.createDiv({ cls: "nr-tree-empty", text: "No unread pages in this family." });
			return;
		}
		const list = scroller.createDiv({ cls: "nr-tree-list" });
		list.setAttr("role", "tree");
		for (const row of rows) {
			const meta = metas[row.path];
			const file = app.vault.getFileByPath(row.path);
			if (!meta || !file) continue;
			this.renderRow(list, row, meta.title, file, file === active, settings.tree.showAnswerCounts ? answers.count(row.path) : 0);
		}
		scroller.scrollTop = top;
	}

	private renderRow(list: HTMLElement, row: FamilyRow, title: string, file: TFile, current: boolean, answerCount: number): void {
		const el = list.createDiv({ cls: "nr-tree-row" });
		el.setAttr("role", "treeitem");
		el.setAttr("tabindex", "0");
		el.setCssProps({ "--nr-depth": String(row.depth) });
		el.toggleClass("is-current", current);
		if (current) el.setAttr("aria-current", "true");
		const dot = el.createSpan({ cls: "nr-tree-dot" });
		if (row.state !== "none") dot.addClass(`is-${row.state}`);
		if (row.state === "failed" && row.error) setTooltip(el, row.error);
		el.createSpan({ cls: "nr-tree-name", text: title });
		const count = answerCountText(answerCount);
		if (count) el.createSpan({ cls: "nr-tree-count", text: count });

		el.addEventListener("click", (evt) => void this.openNote(file, Keymap.isModEvent(evt)));
		el.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") void this.openNote(file, Keymap.isModEvent(evt));
		});
		el.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			this.menu(file, row).showAtMouseEvent(evt);
		});
	}

	/** Not `open`: that name is View.open(containerEl), which Obsidian calls to attach the view. */
	private async openNote(file: TFile, where: boolean | "tab" | "split" | "window"): Promise<void> {
		const leaf = this.app.workspace.getLeaf(where);
		await leaf.openFile(file);
		// Opening the note it is already showing raises no file-open event.
		this.plugin.pages.opened(file);
	}

	private menu(file: TFile, row: FamilyRow): Menu {
		const { workspace, metadataCache } = this.app;
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").onClick(() => void this.openNote(file, "tab")));
		menu.addItem((i) =>
			i.setTitle("Open to the right").setIcon("separator-vertical").onClick(() => void workspace.getLeaf("split", "vertical").openFile(file)),
		);
		menu.addSeparator();
		const unread = row.state === "unread";
		menu.addItem((i) =>
			i
				.setTitle(unread ? "Mark as read" : "Mark as unread")
				.setIcon(unread ? "check" : "mail")
				.setDisabled(row.state === "writing")
				.onClick(() => this.plugin.pages.setUnread(file.path, !unread)),
		);
		if (isGrownPage(metadataCache.getFileCache(file)?.frontmatter)) {
			menu.addItem((i) =>
				i
					.setTitle("Regenerate this page")
					.setIcon("refresh-cw")
					.setDisabled(row.state === "writing")
					.onClick(() => void this.plugin.pages.regenerate(file)),
			);
		}
		menu.addSeparator();
		workspace.trigger("file-menu", menu, file, "nested-reader-tree");
		return menu;
	}
}
