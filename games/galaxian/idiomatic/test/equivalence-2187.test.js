// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_2187 — memory-equivalent to the frozen oracle at ROM 0x2187.
 * Blanks a 4x4 tile block in video RAM: writes the blank code 0x40 to four rows of four cells at
 * 0x51da, 0x51fa, 0x521a, 0x523a. No register live-out (callers overwrite HL/A/DE afterward), so the
 * only live-out is the 16 VRAM cells, all in the state dump. The entry pre-dirties the 16 cells with a
 * sentinel (differs from 0x40) so the oracle demonstrably changes them. Teeth: no-op, wrong value,
 * short (one row), and contiguous-stride (ignores the row gap) twins each make ramDiff non-null.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_2187 as cand } from "../loc_2187.js";
import { loc_2187 as oracle } from "../../translated/loc_2187.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const BLANK = 0x40;
const SENT = 0xaa; // differs from every stamped value so the no-op/short twins cannot alias prior VRAM
const CELLS = [];
for (const rowBase of [0x51da, 0x51fa, 0x521a, 0x523a]) for (let c = 0; c < 4; c++) CELLS.push(rowBase + c);

const entry = () => craft((mem, mm) => { for (const a of CELLS) mem[a] = SENT; mm.push16(0x9999); });

const noOp = () => {};
const wrongVal = (m) => { for (const a of CELLS) m.mem8[a] = 0x00; };
const short = (m) => { for (let c = 0; c < 4; c++) m.mem8[0x51da + c] = BLANK; }; // only the first row
const contiguous = (m) => { for (let i = 0; i < 16; i++) m.mem8[0x51da + i] = BLANK; }; // no row gap

test("EQUAL (crafted): loc_2187 == oracle blanks the 4x4 block", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_2187 VRAM diverged");
  // non-vacuous: the oracle really overwrites the sentinel with the blank code.
  const a = entry().clone(); oracle(a);
  for (const c of CELLS) assert.equal(a.mem8[c], BLANK, `oracle did not blank 0x${c.toString(16)}`);
  console.log("  EQUAL: loc_2187 == oracle, 16 cells blanked");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongVal, entry()), "the wrong-value twin escaped");
  assert.ok(ramDiff(oracle, short, entry()), "the single-row twin escaped");
  assert.ok(ramDiff(oracle, contiguous, entry()), "the contiguous-stride twin escaped");
  console.log("  TEETH: no-op, wrong-value, single-row, contiguous-stride all caught");
});
