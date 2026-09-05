// SPDX-License-Identifier: GPL-3.0-only
// §4 decompile equivalence-test harness (galaxian). Boots a bounded attract state as the shared seed; each
// equivalence test clones it, pokes a routine's inputs, and runs the idiomatic candidate vs the frozen
// translated oracle in ISOLATION (no born-live needed). Stack scratch (0x43e0-0x43ff, the return-stack
// window measured in §3) is masked from the RAM diff.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Machine } from "../../machine.js";
import { buildRoutines } from "../../routines.js";

const GAME = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROM = join(GAME, "rom");
const IMAGES = ["maincpu.bin", "gfx1.bin", "proms.bin"];

export function romsPresent() {
  return IMAGES.every((f) => existsSync(join(ROM, f)));
}

let cached = null;
function romImages() {
  if (!cached) {
    cached = {
      rom: new Uint8Array(readFileSync(join(ROM, "maincpu.bin"))),
      gfx: new Uint8Array(readFileSync(join(ROM, "gfx1.bin"))),
      proms: new Uint8Array(readFileSync(join(ROM, "proms.bin"))),
    };
  }
  return cached;
}

// A bounded attract frame that leaves work RAM populated; before the main-loop return at ~216.
export const ENTRY_FRAMES = 200;

// Return-stack scratch window (measured §3: the benign stack blip lives in 0x43ea-0x43ff).
export const isStackScratch = (addr) => addr >= 0x43e0 && addr <= 0x43ff;

export function makeMachine(overrides) {
  const { rom, gfx, proms } = romImages();
  const routines = buildRoutines();
  if (overrides) for (const [addr, fn] of overrides) routines.set(addr, fn);
  return new Machine(rom, routines, { gfx, proms });
}
