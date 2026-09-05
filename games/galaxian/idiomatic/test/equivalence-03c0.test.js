// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_03c0 — memory-equivalent to the frozen oracle at ROM 0x03c0. Blanks `columns` VRAM columns (B is
 * the column-count input): three cells per column stamped with the blank tile, stepping up one row each,
 * then advancing to the next column by the low byte only. Live-out is VRAM (in dumpState), so EQUAL is
 * ramDiff==null across 1/2/3 columns. Teeth: no-op, short column count, and a wrong-tile twin. The nine
 * candidate cells are pre-dirtied with a sentinel so the blanking is observable.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_03c0 as cand } from "../loc_03c0.js";
import { loc_03c0 as oracle } from "../../translated/loc_03c0.js";

const SENTINEL = 0xaa; // != blank tile 0x10, so the stamp is observable
const BLANK = 0x10;
// The cells three columns' worth of blanking touches (col-major, up one row each).
const CELLS = [0x5193, 0x5173, 0x5153, 0x5195, 0x5175, 0x5155, 0x5197, 0x5177, 0x5157];
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const entry = (columns) => craft((mem8, m) => {
  m.push16(0x9999);
  m.regs.b = columns;
  for (const c of CELLS) mem8[c] = SENTINEL;
});

test("EQUAL (crafted): loc_03c0 == oracle blanks 1/2/3 columns", { skip }, () => {
  for (const columns of [1, 2, 3]) {
    assert.equal(ramDiff(oracle, cand, entry(columns)), null, `loc_03c0 diverged (columns=${columns})`);
  }
  // Positive control: two columns really blank both column-start cells to the blank tile.
  const a = entry(2); oracle(a);
  assert.equal(a.mem8[0x5193], BLANK, "positive control: column 0 start blanked");
  assert.equal(a.mem8[0x5195], BLANK, "positive control: column 1 start blanked");
  assert.equal(a.mem8[0x5197], SENTINEL, "positive control: column 2 untouched at two columns");
  console.log("  EQUAL: loc_03c0 == oracle, columns blanked with the blank tile");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const shortCount = (m) => cand(m, 1); // one column short of the crafted two
  const wrongTile = (m) => {
    let hl = 0x5193;
    for (let col = 0; col < 2; col++) {
      for (let r = 0; r < 3; r++) { m.mem8[hl] = BLANK - 1; hl = (hl - 32) & 0xffff; }
      hl = ((hl >> 8) << 8) | ((hl + 98) & 0xff);
    }
  };
  assert.ok(ramDiff(oracle, noOp, entry(2)), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, shortCount, entry(2)), "the short-column-count twin escaped");
  assert.ok(ramDiff(oracle, wrongTile, entry(2)), "the wrong-tile twin escaped");
  console.log("  TEETH: no-op, short-count, wrong-tile all caught");
});
