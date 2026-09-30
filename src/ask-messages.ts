// Pure glue to the upstream prompt builder. Must not import "obsidian".
import type { Settings } from "./platform/types";
import type { NestedSettings } from "./settings-model";

/**
 * The upstream prompt builder reads only `settings.context.{highlight,session,folder}` and
 * `settings.tools` from a `Settings` that describes the whole desktop app. This is the one place
 * that pretends our small settings are that type. Tools are off: the plugin has no folder tools.
 */
export function promptSettings(context: NestedSettings["context"]): Settings {
	return { context, tools: false } as unknown as Settings;
}
