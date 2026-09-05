// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1917 — crafted-entry equivalence vs the frozen state-3 field reset at ROM 0x1917.
 * The routine writes the 0x0900 word into the 0x4001 field: 0x4001 <- 0, 0x4002 <- 9. The seed pokes
 * both bytes to foreign values and pushes a return address for the oracle's ret; RAM is compared
 * (stack masked). Non-vacuous: the oracle really lands 0 / 9. Teeth: no-op, wrong-low, wrong-high,
 * and byte-swapped twins each move RAM.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { presetCreditCount as cand } from "../presetCreditCount.js";
import { loc_1917 as oracle } from "../../translated/loc_1917.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const FIELD_LO = 0x4001;
const FIELD_HI = 0x4002;

// Seed both bytes foreign (0xff / 0xff) so a correct run must land 0 in the low byte and 9 in the high.
const entry = () => craft((mem, mm) => { mem[FIELD_LO] = 0xff; mem[FIELD_HI] = 0xff; mm.push16(0x9999); });

test("EQUAL (crafted): loc_1917 == oracle resets the 0x4001 field", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "the field reset diverged");
  // non-vacuous: the oracle actually writes {0x4001:0, 0x4002:9} over the seeded 0xff/0xff.
  const a = entry().clone(); oracle(a);
  assert.equal(a.mem8[FIELD_LO], 0, "oracle did not clear the low byte");
  assert.equal(a.mem8[FIELD_HI], 9, "oracle did not set the high byte to 9");
  console.log("  EQUAL: loc_1917 wrote 0x4001<-0 0x4002<-9, == oracle");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongLow = (m) => { m.mem8[FIELD_LO] = 1; m.mem8[FIELD_HI] = 9; };  // low byte off
  const wrongHigh = (m) => { m.mem8[FIELD_LO] = 0; m.mem8[FIELD_HI] = 8; }; // high byte off
  const swapped = (m) => { m.mem8[FIELD_LO] = 9; m.mem8[FIELD_HI] = 0; };   // bytes swapped
  assert.ok(ramDiff(oracle, noOp, entry()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongLow, entry()), "wrong-low twin escaped");
  assert.ok(ramDiff(oracle, wrongHigh, entry()), "wrong-high twin escaped");
  assert.ok(ramDiff(oracle, swapped, entry()), "byte-swapped twin escaped");
  console.log("  TEETH: no-op, wrong-low, wrong-high, swapped all caught");
});
