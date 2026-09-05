// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0363 — crafted-entry equivalence vs the frozen zero-the-block tail (a DISSOLVE: its lone call
 * into the strided block writer is replaced by a direct idiomatic call with the constant 0).
 * Live-out is RAM only: nine cells at 0x4028 stride 2, all forced to 0. The seed pre-dirties the nine
 * cells with a sentinel and seats a foreign accumulator (the routine must broadcast 0, not A), plus a
 * ret target the oracle's block writer consumes. Teeth: a no-op, a broadcast-A twin (proves the forced
 * zero), and a wrong-count twin.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_0363 as cand } from "../loc_0363.js";
import { loc_0363 as oracle } from "../../translated/loc_0363.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const BASE = 0x4028;
const CELL_COUNT = 9;
const STRIDE = 2;
const SENTINEL = 0x77; // initial cell value (nonzero, so the zeroing is observable)
const FOREIGN_A = 0x55; // foreign accumulator; broadcasting it instead of 0 must be caught

const entry = () => craft((mem, mm) => {
  for (let i = 0; i < CELL_COUNT; i++) mem[BASE + i * STRIDE] = SENTINEL;
  mm.regs.a = FOREIGN_A;
  mm.push16(0x9999); // ret target for the block writer's ret
});

test("EQUAL (crafted): loc_0363 == oracle zeroes the strided block", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_0363 diverged from the oracle");
  // Non-vacuous: the oracle really forces the nine cells to 0 (not the foreign accumulator).
  const a = entry(); oracle(a);
  for (let i = 0; i < CELL_COUNT; i++) {
    assert.equal(a.mem8[BASE + i * STRIDE], 0, `positive control: cell ${i} not zeroed`);
  }
  console.log("  EQUAL: loc_0363 == oracle, nine cells forced to 0");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const broadcastA = (m) => { for (let i = 0; i < CELL_COUNT; i++) m.mem8[BASE + i * STRIDE] = m.regs.a; };
  const wrongCount = (m) => { for (let i = 0; i < CELL_COUNT - 1; i++) m.mem8[BASE + i * STRIDE] = 0; };
  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, broadcastA, entry()), "the broadcast-A twin escaped");
  assert.ok(ramDiff(oracle, wrongCount, entry()), "the wrong-count twin escaped");
  console.log("  TEETH: no-op, broadcast-A, wrong-count all caught");
});
