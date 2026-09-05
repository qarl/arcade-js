// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_097d — crafted-entry equivalence vs the frozen direction-flag setter at ROM 0x097d.
 * The routine stamps SWEEP_DIRECTION_FLAG (0x420d) to 1 and touches nothing else. The seed pokes the
 * flag to a foreign value and pushes a return address for the oracle's ret; RAM is compared (stack
 * masked). Non-vacuous: the oracle really writes 1 over the seed. Teeth: no-op, wrong-const (clears
 * instead of sets), and wrong-cell twins each move RAM.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { loc_097d as cand } from "../loc_097d.js";
import { loc_097d as oracle } from "../../translated/loc_097d.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const SWEEP_DIRECTION_FLAG = 0x420d;

// Seed the flag to a foreign 0x55 so a correct run must overwrite it with 1.
const entry = () => craft((mem, mm) => { mem[SWEEP_DIRECTION_FLAG] = 0x55; mm.push16(0x9999); });

test("EQUAL (crafted): loc_097d == oracle sets the direction flag", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "the direction-flag write diverged");
  // non-vacuous: the oracle actually stamps 1 over the seeded 0x55.
  const a = entry().clone(); oracle(a);
  assert.equal(a.mem8[SWEEP_DIRECTION_FLAG], 1, "oracle did not set the flag to 1");
  console.log("  EQUAL: loc_097d wrote SWEEP_DIRECTION_FLAG 0x55->1, == oracle");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongConst = (m) => { m.mem8[SWEEP_DIRECTION_FLAG] = 0; };       // clears instead of setting 1
  const wrongCell = (m) => { m.mem8[SWEEP_DIRECTION_FLAG + 1] = 1; };   // writes the neighbour, not the flag
  assert.ok(ramDiff(oracle, noOp, entry()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongConst, entry()), "wrong-const twin escaped");
  assert.ok(ramDiff(oracle, wrongCell, entry()), "wrong-cell twin escaped");
  console.log("  TEETH: no-op, wrong-const, wrong-cell all caught");
});
