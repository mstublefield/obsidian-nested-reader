# Nested Reader for Obsidian

Select a phrase in a note and ask about it, without leaving Obsidian.

- **Quick answer**: a short answer appears under the paragraph. Afterwards the phrase keeps a dotted underline, and hovering it shows the answer again.
- **New page**: writes a new note beside the current one, answers the question there, links the phrase to it with `[[child|phrase]]`, and opens it in a split.
- **Deep dive**: writes a longer note in the background and marks it unread.

Child notes record where they came from in front matter (`source`, `question`, `mode`), so your notes grow into a tree you can browse in the side panel, the graph and backlinks.

This is an Obsidian port of [Nested Reader](https://nestedreader.app/) by True Frontier. See [NOTICE.md](NOTICE.md) for attribution and license status. The original app is on the `upstream-app` branch.

> **Status:** early development. It is desktop only, and it is not in the community plugin directory.

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
