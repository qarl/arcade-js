// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_25a7 — memory-equivalent to the frozen oracle at ROM 0x25a7 (dissolves its fall-through call of the
 * vertical tile-pair writer into a direct idiomatic call).
 * Seeds the fixed tile code 0x2c, then stamps (HL)=0x2c and (HL+0x20)=0x2e. Live-out is RAM only (the
 * vertical writer's A/HL advance is not consumed, matching the batch-1 decision). The seed points HL into
 * the VRAM interior so both cells land in the state dump, and paints them with a sentinel so every write
 * is observable; incoming A is dirtied to prove the routine forces its own seed. Teeth: a no-op twin
 * (proves the writes are observable) and a wrong-bottom-tile twin (A+3 instead of A+2).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_25a7 as cand } from "../loc_25a7.js";
import { loc_25a7 as oracle } from "../../translated/loc_25a7.js";

const DEST = 0x5100; // interior of VRAM 0x5000-0x53ff; DEST + 0x20 = 0x5120 is still in VRAM
const SEED = 0x2c; // the fixed tile code the routine forces
const SENTINEL = 0xee;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function seed(dest = DEST) {
  return craft((mem8, m) => {
    mem8[dest] = SENTINEL;
    mem8[(dest + 0x20) & 0xffff] = SENTINEL;
    m.regs.a = 0x99; // dirty A: the routine must overwrite it with its own seed
    m.regs.hl = dest;
    m.push16(0x9999); // ret target for the oracle's ret
  });
}

test("EQUAL: loc_25a7 == oracle (vertical tile pair from a fixed seed)", { skip }, () => {
  for (const d of [0x5100, 0x5200, 0x5040]) {
    assert.equal(ramDiff(oracle, cand, seed(d)), null, `loc_25a7 diverged (dest=0x${d.toString(16)})`);
  }
  // positive control: the oracle overwrites the sentinels with the seed pair.
  const a = seed(); oracle(a);
  assert.equal(a.mem8[DEST], SEED, "positive control: oracle stamped the top tile");
  assert.equal(a.mem8[DEST + 0x20], (SEED + 2) & 0xff, "positive control: oracle stamped the bottom tile");
  console.log("  EQUAL: loc_25a7 == oracle (RAM), vertical pair stamped from the fixed seed");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongBottom = (m, dest = m.regs.hl) => {
    m.mem8[dest] = SEED;
    m.mem8[dest + 0x20] = SEED + 3; // WRONG: the vertical writer steps the bottom tile by 2
  };
  assert.ok(ramDiff(oracle, noOp, seed()), "the no-op twin escaped (test is vacuous)");
  assert.ok(ramDiff(oracle, wrongBottom, seed()), "the wrong-bottom-tile twin escaped");
  console.log("  TEETH: no-op, wrong-bottom-tile caught");
});
