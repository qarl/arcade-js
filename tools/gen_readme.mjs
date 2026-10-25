// SPDX-License-Identifier: GPL-3.0-only
// gen_readme — rewrites README.md's `<!-- BEGIN GENERATED: <kind> -->` ... `<!-- END GENERATED -->` blocks
// from the repo, so the front page cannot silently drift from the code it quotes.
//   listing <path>  the file verbatim in a ```js fence, minus its leading `// SPDX-License-Identifier:` lines
//   game status     one table row per games/registry.js entry, every cell read from its manifest or disk
// --write rewrites README.md; --check exits 1 (naming each stale block) when it differs, 0 when current.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOCK = /(<!-- BEGIN GENERATED: (.+?) -->\n)([\s\S]*?)(<!-- END GENERATED -->)/g;
const SPDX = /^\/\/ SPDX-License-Identifier:/;

function listing(path) {
  const lines = readFileSync(join(REPO, path), "utf8").split("\n");
  while (lines.length && SPDX.test(lines[0])) lines.shift();
  return "```js\n" + lines.join("\n").replace(/\n*$/, "\n") + "```\n";
}

async function gameStatus() {
  const { GAMES } = await import(pathToFileURL(join(REPO, "games", "registry.js")).href);
  const rows = [
    "| Game | Year | Maker | Board (MAME machine config) | CPU | Runtime | Idiomatic layer complete (`idiomaticComplete`) | Done audit |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const id of GAMES) {
    const m = (await import(pathToFileURL(join(REPO, "games", id, "manifest.js")).href)).default;
    const done = existsSync(join(REPO, "games", id, "DONE.md")) ? `[DONE.md](games/${id}/DONE.md)` : "—";
    const complete = m.idiomaticComplete === true ? "yes" : "not declared";
    rows.push(`| [${m.title}](games/${id}/) | ${m.year} | ${m.manufacturer} | \`${m.board}\` | ${m.cpu} | ${m.runtime ?? "translated"} | ${complete} | ${done} |`);
  }
  return rows.join("\n") + "\n";
}

async function generate(kind) {
  if (kind.startsWith("listing ")) return listing(kind.slice("listing ".length));
  if (kind === "game status") return gameStatus();
  throw new Error(`gen_readme: unknown GENERATED block kind "${kind}"`);
}

// Returns README text with every generated block replaced, plus the kinds whose content changed.
export async function render(text) {
  const parts = [...text.matchAll(BLOCK)];
  if (!parts.length) throw new Error("gen_readme: README.md has no GENERATED blocks");
  if ((text.match(/<!-- BEGIN GENERATED:/g) ?? []).length !== parts.length)
    throw new Error("gen_readme: README.md has a BEGIN GENERATED marker without its own END GENERATED");
  let out = "", at = 0;
  const stale = [];
  for (const p of parts) {
    const body = await generate(p[2]);
    if (body !== p[3]) stale.push(p[2]);
    out += text.slice(at, p.index) + p[1] + body + p[4];
    at = p.index + p[0].length;
  }
  return { text: out + text.slice(at), stale };
}

async function main(mode) {
  const file = join(REPO, "README.md");
  const { text, stale } = await render(readFileSync(file, "utf8"));
  if (mode === "--write") {
    writeFileSync(file, text);
    console.log(stale.length ? `gen_readme: rewrote ${stale.join(", ")}` : "gen_readme: already current");
  } else if (mode === "--check") {
    if (!stale.length) return console.log("gen_readme: README.md is current");
    console.error(`gen_readme: README.md is STALE in: ${stale.join(", ")}\n  run: node tools/gen_readme.mjs --write`);
    process.exitCode = 1;
  } else {
    console.error("usage: node tools/gen_readme.mjs --write|--check");
    process.exitCode = 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv[2]);
