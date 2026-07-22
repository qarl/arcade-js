// SPDX-License-Identifier: GPL-3.0-only
//
// Assemble a game's ROM from your own dump. The ROM data is copyrighted and is
// never committed; this rebuilds it locally. Reads games/<id>/manifest.js,
// unzips the declared parts, concatenates them in address order into the flat
// images the engine loads, and verifies each against its pinned sha256 + size —
// so a wrong or damaged romset fails loudly instead of silently mistranslating.
//
// Usage: node tools/build-rom.mjs <gameId> [path/to/zip]
//        (zip defaults to $ROMZIP, else ~/Downloads/<manifest.rom.zip>)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const gameId = process.argv[2];
if (!gameId) { console.error("usage: node tools/build-rom.mjs <gameId> [zip]"); process.exit(2); }

const gameDir = join(root, "games", gameId);
const manifest = (await import(pathToFileURL(join(gameDir, "manifest.js")))).default;
const zip = process.argv[3] || process.env.ROMZIP ||
  join(process.env.HOME || "", "Downloads", manifest.rom.zip);

const romDir = join(gameDir, "rom");
mkdirSync(romDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "rombuild-"));
let ok = true;
try {
  for (const [name, spec] of Object.entries(manifest.rom.images)) {
    // -j junks archive paths; our part names are root-level and unambiguous.
    execFileSync("unzip", ["-o", "-j", zip, ...spec.parts, "-d", work],
      { stdio: ["ignore", "ignore", "inherit"] });
    const buf = Buffer.concat(spec.parts.map(p => readFileSync(join(work, p))));
    writeFileSync(join(romDir, `${name}.bin`), buf);
    const got = createHash("sha256").update(buf).digest("hex");
    const good = got === spec.sha256 && buf.length === spec.size;
    if (!good) ok = false;
    console.log(`${good ? "OK " : "BAD"}  ${name}.bin  ${buf.length}B  ${got}`);
    if (!good) console.error(`     expected ${spec.size}B ${spec.sha256}`);
  }
} catch (e) {
  console.error(`\n✗ ROM build failed: ${e.message}`);
  console.error(`  (is "${zip}" present and a valid ${gameId} romset?)`);
  process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(ok
  ? `\n✓ ${gameId} ROM assembled & verified → ${romDir}`
  : `\n✗ verification FAILED — wrong or damaged romset`);
process.exit(ok ? 0 : 1);
