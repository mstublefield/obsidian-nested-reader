# Nested Reader for Obsidian

Select a phrase in a note and ask about it, without leaving Obsidian.

- **Quick answer**: a short answer appears under the paragraph. Afterwards the phrase keeps a dotted underline, and hovering it shows the answer again.
- **New page**: writes a new note beside the current one, answers the question there, links the phrase to it with `[[child|phrase]]`, and opens it in a split.
- **Deep dive**: writes a longer note in the background and marks it unread.

Child notes record where they came from in front matter (`source`, `question`, `mode`), so your notes grow into a tree you can browse in the side panel, the graph and backlinks.

This is an Obsidian port of [Nested Reader](https://nestedreader.app/) by True Frontier. See [NOTICE.md](NOTICE.md) for attribution and license status. The original app is on the `upstream-app` branch.

> **Status:** early development. It is desktop only, and it is not in the community plugin directory.

## How to use

1. Select some text in a note, in Live Preview, source mode or Reading view.
2. Click the **Ask** pill that appears under the selection, or run **Ask about selection** from the command palette or the editor's right-click menu. The pill can be turned off in settings under Reading. No hotkey is set by default; assign your own in Settings, Hotkeys.
3. Type a question and press **Enter** for a quick answer, or press Enter on an empty box to get an explanation of the selection. **Esc** closes the card.
4. The answer streams into a card under the paragraph, pushing the text below it down. Type in the box under the answer to ask a follow-up; earlier questions and answers stay above it.

Coming next: dotted underlines and hover recall for past answers, cards that survive a reload, and the New page and Deep dive actions.

## Answers

Three settings under **Answers** decide what the model may draw on, for every service:

- **Answer from general knowledge** (on by default): the pages are context, not a limit. When they don't explain something you ask about, the model explains it from what it knows instead of saying the text doesn't cover it.
- **Let it search this vault** (on by default): the model can list, search and read notes, read-only, while it answers. With an API key the plugin runs these tools itself, using the Omnisearch plugin's index for search when it is installed. With the Claude plan the `claude` tool reads the vault directly (Read, Grep and Glob); with the ChatGPT plan `codex` runs inside the vault folder.
- **Let it search the web** (off by default): uses the service's own web search, which is slower and may cost more per question. Perplexity's presets (`fast`, `low`, `medium`, `high`) search the web by default, so this setting cannot turn search off there.

**Folders it may not read** lists vault folders, one per line (for example `Clients/Acme`), whose notes are never read or sent. The plugin enforces this for its own tools and for the same-folder and thread context (the note you are reading is the one exception). For the Claude plan it is enforced with permission rules and also stated in the instructions. For the ChatGPT plan it is only stated in the instructions, because Codex's sandbox can read the whole disk, so keep very sensitive notes out of a vault you use with it, or leave vault search off.

**Extra instructions** is added to every question, for example "Answer for a product manager."

Privacy: whatever the model reads from your notes is sent to the service you chose, the same as the highlighted text.

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
```

The dev vault at `~/Documents/Obsidian/Nested Dev` links this repo in as `.obsidian/plugins/nested-reader`, and the [hot-reload](https://github.com/pjeby/hot-reload) plugin reloads it whenever `main.js` changes.

`docs/upstream-README.md` and `docs/architecture.md` describe the original app, and remain the reference for its behavior.
