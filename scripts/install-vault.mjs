// Copies the built plugin into a vault: pnpm install:vault "/path/to/Vault"
// Copies rather than links, so a work vault only changes when you choose to install.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const vault = process.argv[2] ?? process.env.NESTED_VAULT;
if (!vault) {
	console.error('Usage: pnpm install:vault "/path/to/Vault"   (or set NESTED_VAULT)');
	process.exit(1);
}
const root = resolve(vault);
if (!existsSync(join(root, ".obsidian"))) {
	console.error(`${root} is not an Obsidian vault (no .obsidian folder).`);
	process.exit(1);
}
const { id, version } = JSON.parse(readFileSync("manifest.json", "utf8"));
const dest = join(root, ".obsidian", "plugins", id);
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) {
	if (!existsSync(f)) {
		console.error(`${f} is missing; run pnpm build first.`);
		process.exit(1);
	}
	copyFileSync(f, join(dest, f));
}
console.log(`Installed ${id} ${version} into ${dest}`);
console.log("In Obsidian: Settings → Community plugins → reload the list, then turn on Nested Reader (or reload the plugin if it was on).");
