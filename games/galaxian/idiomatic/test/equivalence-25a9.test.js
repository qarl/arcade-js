// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_25a9 — memory-equivalent to the frozen oracle at ROM 0x25a9.
 * A vertical tile-pair stamp: (HL)=A, (HL+0x20)=A+2. The crafted seed points HL into VRAM interior so
 * both cells land in the state dump, paints them with a sentinel so every write is observable, and pushes
 * a ret target for the oracle. Live-out is RAM only. Teeth: a no-op twin (proves the write is observable)
 * and a wrong-bottom-tile twin (A+3 instead of A+2).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_25a9 as cand } from "../loc_25a9.js";
import { loc_25a9 as oracle } from "../../translated/loc_25a9.js";

const DEST = 0x5100; // interior of VRAM 0x5000-0x53ff; DEST + 0x20 = 0x5120 is still in VRAM
const TILE = 0x40;
const SENTINEL = 0xee;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function seed() {
  return craft((mem8, m) => {
    mem8[DEST] = SENTINEL;
    mem8[DEST + 0x20] = SENTINEL;
    m.regs.a = TILE;
    m.regs.hl = DEST;
    m.push16(0x9999); // ret target for the oracle's `ret`
  });
}

test("EQUAL: loc_25a9 == oracle (vertical tile pair)", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, seed()), null, "loc_25a9 diverged from the oracle");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongBottom = (m, tile = m.regs.a, dest = m.regs.hl) => {
    const { mem8 } = m;
    mem8[dest] = tile;
    mem8[dest + 0x20] = tile + 3; // WRONG: the ROM writes tile + 2
  };
  assert.notEqual(ramDiff(oracle, noOp, seed()), null, "the no-op twin escaped (test is vacuous)");
  assert.notEqual(ramDiff(oracle, wrongBottom, seed()), null, "the wrong-bottom-tile twin escaped");
});
