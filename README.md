# Nested Reader for Obsidian

Select a phrase in a note and ask about it, without leaving Obsidian.

- **Quick answer**: a short answer appears under the paragraph. Afterwards the phrase keeps a dotted underline, and hovering it shows the answer again.
- **New page**: writes a new note beside the current one, answers the question there, links the phrase to it with `[[child|phrase]]`, and opens it in a split.
- **Deep dive**: writes a longer note in the background and marks it unread.

Child notes record where they came from in front matter (`source`, `question`, `mode`), so your notes grow into a tree you can browse in the side panel, the graph and backlinks.

This is an Obsidian port of [Nested Reader](https://nestedreader.app/) by True Frontier. See [NOTICE.md](NOTICE.md) for attribution. The original app is on the `upstream-app` branch.

> **Status:** early release (0.1.0). Desktop only (macOS, Windows, Linux).

## How to use

1. Select some text in a note, in Live Preview, source mode or Reading view.
2. Click the **Ask** pill that appears under the selection, or run **Ask about selection** from the command palette or the editor's right-click menu. The pill can be turned off in settings under Reading. No hotkey is set by default; assign your own in Settings, Hotkeys.
3. Type a question and press **Enter** for a quick answer, or press Enter on an empty box to get an explanation of the selection. **Esc** closes the card.
4. The answer streams into a card under the paragraph, pushing the text below it down. Type in the box under the answer to ask a follow-up; earlier questions and answers stay above it.

5. After a quick answer finishes, the phrase keeps a **dotted underline**. Hover it to see the answer again in a small popover; move the pointer away to dismiss it. The popover's buttons open the answer as a card, or **Forget** it (a notice offers Undo). The underline appears once the card is closed.
6. **Click** an underlined phrase to reopen its answer as a card under the paragraph, with the earlier questions above it, ready for a follow-up. A link inside the phrase still opens as a link.
7. Two commands, with no hotkeys set: **Show answers in this note** (pick one to jump to its phrase and reopen it) and **Forget answers in this note** (with Undo).

Answers are kept after each complete answer, so a crash does not lose them. A cut-off or failed answer is shown but not kept. If you ask again about the same phrase in a note, the new answer replaces the old one. Phrases are found again by their text, so an answer still attaches after you edit around it; if you delete the phrase, the answer stays in the file but has nothing to underline (use **Show answers in this note** to read it).

The hover popover, the underline, clicking to reopen, and remembering itself can each be turned off in settings under Reading.

**Where answers are stored:** in `answers.json` inside this plugin's folder (`.obsidian/plugins/<plugin id>/answers.json`), not inside your notes. They are per vault, follow a renamed or deleted note, and sync only if your vault's `.obsidian` folder syncs. A damaged file is copied to `answers.json.bak` and the plugin starts empty.

## New pages and deep dives

Type a question in the ask box (or in a card's follow-up box), then pick a verb from the row of buttons under it:

| Button | What happens |
| --- | --- |
| **Quick answer** (or press Enter) | A short answer in a card, as above. In a follow-up box this button reads **Ask**. |
| **New page** | Writes a new note that answers the question, links the phrase to it, and opens it beside the current note. |
| **Deep dive** | Writes a longer note in the background and marks it unread. |

New page and Deep dive have no keyboard shortcuts in the box, because Obsidian's own hotkeys already use Cmd+Enter. Esc closes the box.

When a page finishes, its file is renamed to the title the model gave it (links to it update automatically); turn this off with **Rename the file to the page's title** in settings. A page you have renamed yourself is left alone.

Leave the question empty and the page is written to "Go deeper on: <your selection>". The ask box closes when you pick a page verb; a page asked for from a card's follow-up box leaves the card open. The command palette has **New page from selection** and **Deep dive from selection** (empty question, no hotkeys set).

**Where pages go and what they are called** are settings under **New pages**. By default a page goes beside the note it grew from and is named after the question, for example `What is a sharp-wave ripple.md`; a number is added if the name is taken (`... 2.md`). Other choices: put every page in one folder (default name `Nested`, created when needed), and use short slugs like `what-is-a-sharp-wave-ripple.md`. Characters that are illegal in file names or special in links are dropped, and names are cut to 80 characters.

**Front matter.** Each page starts with:

```yaml
---
title: "What is a sharp-wave ripple?"
source: "[[Replay into cortex]]"
question: "What is a sharp-wave ripple?"
created: 2026-09-10T09:42:00.000Z
mode: new-page
---
```

`source` is the note it grew from (quoted, so Obsidian reads it as a link rather than a list), `mode` is `new-page` or `deep-dive`, and `title` is updated to the model's own heading when the page finishes. The plugin reads `source` to show pages grown from the same note as context for later questions.

**The phrase link.** With **Link the phrase to the new page** on (the default), the words you highlighted are rewritten in the parent note as a link to the page, using your vault's link format (for example `[[What is a sharp-wave ripple|sharp-wave ripples]]`). This is skipped, with a notice saying why, when the words are not in the note exactly as highlighted, run across lines, contain brackets or formatting (`*`, `_`, backticks, `==`, `|`), or are already inside a link or code. A quick answer saved for the same phrase is kept; the phrase's dotted underline stays on the link text, and clicking it follows the link (hover still shows the quick answer).

**Writing and endings.** The file is created at once with the front matter and a heading, then the text streams in and is saved every fraction of a second. If the page hits its length limit, it keeps what arrived and ends with a warning callout. If it fails, the file keeps its heading and a failure callout with the reason. Run **Regenerate this page** (offered on any page with `question`, `source` and `mode` in its front matter) to write it again from the same question; it replaces the body and keeps the front matter.

**Opening and unread.** Settings choose where a New page and a Deep dive open: beside (split), in a new tab, in this tab, or in the background (defaults: split and background). A page finished while you are not looking at it is marked unread, and a notice "Deep dive ready: <title>" opens it when clicked. While pages are writing, the status bar says "Writing <title>…"; afterwards it shows how many pages are unread, and clicking it (or running **Open next unread page**) opens the oldest. Opening a page marks it read. Unread, writing and failed pages are remembered in the plugin's `data.json`, next to its settings.

Coming next: cards that survive a reload.

## Nested pages panel

Run **Show nested pages** (command palette, or the ribbon icon) to open a panel in the right sidebar. It shows the family of the note you are reading: follow each page's `source` up to the first note, then every page grown from it, in the same order as the original app (the first note newest first, pages under a note oldest first), indented by depth. A note with no family shows a short hint and itself as the only row.

Each row shows the page's `title` (or its file name), and a dot: **blue** is unread, **pulsing blue** is being written, **amber** is failed (hover for the reason). The note you are in is highlighted. A muted "2 answers" after the name counts the quick answers saved in that note.

- **Click** a row to open it in the most recent tab; **Cmd/Ctrl-click** opens it in a new tab. Opening marks it read.
- **Right-click** for Open in new tab, Open to the right, Mark as unread or read, Regenerate this page (for grown pages), and Obsidian's usual file menu.
- The **filter** button in the panel header shows only unread, writing and failed pages and the pages above them. It is remembered with the panel's layout, not in settings.

Settings under **Nested pages panel**: show a ribbon icon (on), open the panel when the vault opens (off; it is added to the right sidebar without taking focus), and show answer counts (on). No hotkey is set by default.

## Answers

Three settings under **Answers** decide what the model may draw on, for every service:

- **Answer from general knowledge** (on by default): the pages are context, not a limit. When they don't explain something you ask about, the model explains it from what it knows instead of saying the text doesn't cover it.
- **Let it search this vault** (on by default): the model can list, search and read notes, read-only, while it answers. With an API key the plugin runs these tools itself, using the Omnisearch plugin's index for search when it is installed. With the Claude plan the `claude` tool reads the vault directly (Read, Grep and Glob); with the ChatGPT plan `codex` runs inside the vault folder.
- **Let it search the web** (off by default): uses the service's own web search, which is slower and may cost more per question. Perplexity's presets (`fast`, `low`, `medium`, `high`) search the web by default, so this setting cannot turn search off there.

**Folders it may not read** lists vault folders, one per line (for example `Clients/Acme`), whose notes should never be read or sent. How firmly that holds depends on the service; see [Limitations](#limitations) before relying on it for sensitive notes.

**Extra instructions** is added to every question, for example "Answer for a product manager."

Privacy: whatever the model reads from your notes is sent to the service you chose, the same as the highlighted text.

## Limitations

Read this before you point the plugin at a vault with confidential notes.

**Folders it may not read** is enforced differently for each way of connecting:

| Connection | How excluded folders are kept out | Can the model still read them? |
| --- | --- | --- |
| API key (any service) | The plugin runs every search, list and read itself and refuses excluded paths. | No. |
| Claude plan (`claude`) | Claude Code permission rules deny reading those folders; searching and listing honour the same rules. The folders are also named in the instructions. | Not in testing so far. Claude Code documents these rules as best effort for search, so treat this as strong but not absolute. |
| ChatGPT plan (`codex`) | Only an instruction. Codex's read-only sandbox can read the whole disk. | **Yes, if it ignores the instruction.** |

The same-folder and thread context the plugin sends with each question always skips excluded folders. The one exception is the note you are reading, because you chose to ask about it.

If a vault holds notes that must never leave your Mac, the safe options are an API key, or turning off **Let it search this vault** (and **Pages in the same folder**).

Other limits:

- **Perplexity always searches the web.** Its presets (`fast`, `low`, `medium`, `high`, `xhigh`) include web search, so **Let it search the web** cannot turn it off there.
- **Whatever the model reads is sent to the service you chose**, the same as the highlighted text. Vault search makes that potentially any note outside the excluded folders.
- **The `.obsidian` folder is never readable** through the Claude plan, because other plugins keep settings and tokens there.
- **Desktop only.** The plan connections run command-line tools, and streaming uses Node's networking.

## Disclosures

As required by Obsidian's [developer policies](https://docs.obsidian.md/Community+directory/Developer+policies):

- **An account is required.** Answers come from an AI service you choose: Claude (Anthropic), OpenAI, Grok (xAI) or Perplexity. You need an account with one of them.
- **Payment may be required.** The plugin is free, but the services are not: you use either a paid plan (Claude or ChatGPT, through their command-line tools) or an API key billed by the provider. The plugin never charges you anything itself.
- **Network use.** The highlighted text, its paragraph, related notes and, when vault search is on, notes the model reads are sent to the service you chose. See [Network use](#network-use) and [Limitations](#limitations).
- **Files outside the vault.** With a plan connection, the plugin runs the `claude` or `codex` command-line tool installed on your computer and gives it a scratch folder in your system's temporary directory. With the ChatGPT plan, `codex`'s read-only sandbox can read files outside the vault (see [Limitations](#limitations)). With an API key, nothing outside the vault is touched.
- **No telemetry, no ads.** The plugin collects nothing about you and shows no ads.

## Network use

When you ask a question, the highlighted text, its paragraph, and (depending on your context settings) other notes from the vault are sent to the service you choose in settings: Claude, OpenAI, Grok (xAI) or Perplexity. Claude and OpenAI can be reached two ways:

- **Plan**: runs the `claude` (Claude plan) or `codex` (ChatGPT plan) command-line tool installed on your Mac, so questions count against your subscription.
- **API key**: calls the provider's API directly (`api.anthropic.com`, `api.openai.com`, `api.x.ai`, `api.perplexity.ai`). Keys are stored in Obsidian's secret storage, not in the plugin's settings file.

Grok and Perplexity are API key only. You type the exact model ID for each service, and it is sent as written; each model field links to that provider's model list.

Nothing else is sent anywhere. The plugin has no analytics or telemetry. It needs Obsidian 1.13.0 or later.

## Development

```bash
pnpm install
pnpm dev      # esbuild watch → main.js
pnpm test     # vitest
pnpm build    # typecheck + production bundle
pnpm lint     # eslint with eslint-plugin-obsidianmd
pnpm install:vault "/path/to/Vault"   # build, then copy main.js, manifest.json, styles.css into that vault
```

The dev vault at `~/Documents/Obsidian/Nested Dev` links this repo in as `.obsidian/plugins/nested-reader`, and the [hot-reload](https://github.com/pjeby/hot-reload) plugin reloads it whenever `main.js` changes.

`docs/upstream-README.md` and `docs/architecture.md` describe the original app, and remain the reference for its behavior.

## License

[MIT](LICENSE). Built on [Nested Reader](https://github.com/truefrontier/nested-reader) by Kevin Kirchner (True Frontier), also MIT-licensed; the original copyright notice is kept in LICENSE.

**Credits:** the reading model (Quick Answer, New Page, Deep Dive), the prompts and the ranking and session-map helpers are Kevin Kirchner's work in Nested Reader; this port was made with his approval ([truefrontier/nested-reader#75](https://github.com/truefrontier/nested-reader/issues/75)).
