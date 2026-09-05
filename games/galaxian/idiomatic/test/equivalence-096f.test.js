// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_096f — memory-equivalent to the frozen oracle at ROM 0x096f (a DISSOLVE: its fall-through into the
 * strided block writer is a direct idiomatic call). It negates L (two's-complement) and broadcasts that
 * byte across nine work-RAM cells at 0x4028 stride 2. Live-out is RAM only (in dumpState), so EQUAL is
 * ramDiff==null; the input L is seeded via regs.l and the nine cells pre-dirtied with a sentinel. Teeth:
 * no-op, a broadcast-L twin (proves the negate), and a wrong-count twin. Positive control: -L is stamped.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_096f as cand } from "../loc_096f.js";
import { loc_096f as oracle } from "../../translated/loc_096f.js";

const BASE = 0x4028;
const CELL_COUNT = 9;
const STRIDE = 2;
const SENTINEL = 0x77; // != any broadcast value below, so the fill is observable
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const entry = (low) => craft((mem8, m) => {
  m.regs.l = low;
  for (let i = 0; i < CELL_COUNT; i++) mem8[BASE + i * STRIDE] = SENTINEL;
  m.push16(0x9999); // ret target for the block writer
});

test("EQUAL (crafted): loc_096f == oracle broadcasts -L across the strided block", { skip }, () => {
  for (const low of [0x00, 0x05, 0x80, 0xff]) {
    assert.equal(ramDiff(oracle, cand, entry(low)), null, `loc_096f diverged (L=0x${low.toString(16)})`);
  }
  // Positive control: L=0x05 stamps 0xfb (-5) into every cell, not the sentinel.
  const a = entry(0x05); oracle(a);
  for (let i = 0; i < CELL_COUNT; i++) {
    assert.equal(a.mem8[BASE + i * STRIDE], 0xfb, `positive control: cell ${i} not stamped with -L`);
  }
  console.log("  EQUAL: loc_096f == oracle, nine cells stamped with -L");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const broadcastL = (m) => { for (let i = 0; i < CELL_COUNT; i++) m.mem8[BASE + i * STRIDE] = m.regs.l; };
  const wrongCount = (m) => { for (let i = 0; i < CELL_COUNT - 1; i++) m.mem8[BASE + i * STRIDE] = (-m.regs.l) & 0xff; };
  assert.ok(ramDiff(oracle, noOp, entry(0x05)), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, broadcastL, entry(0x05)), "the broadcast-L twin escaped (negate)");
  assert.ok(ramDiff(oracle, wrongCount, entry(0x05)), "the wrong-count twin escaped");
  console.log("  TEETH: no-op, broadcast-L, wrong-count all caught");
});
