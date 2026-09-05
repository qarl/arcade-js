// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_210a — crafted-entry equivalence vs the frozen clamp-saturation tail at ROM 0x210a.
 * This leaf writes no RAM; its only live-out is register B, forced to 0x80. The seed pokes B foreign
 * (0x40) and lays the two stack words the oracle consumes (its `pop af` then `ret`); the live-out diff
 * checks RAM (stack masked, must stay untouched on both sides) AND register B. Non-vacuous: the oracle
 * really moves B to 0x80. Teeth: no-op, off-by-one, and zero twins each leave a wrong B.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff, STUBS } from "./_bootSetup.js";
import { markValueOutOfRange as cand } from "../markValueOutOfRange.js";
import { loc_210a as oracle } from "../../translated/loc_210a.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// Seed B foreign (0x40) and lay two stack words: the bottom is the return address the oracle's `ret`
// consumes, the top is the AF its `pop af` consumes. Neither the oracle nor the candidate writes RAM.
const entry = () => craft((mem, mm) => {
  mm.regs.b = 0x40;
  mm.push16(0x9999); // for the oracle's ret
  mm.push16(0xabcd); // for the oracle's pop af (top of stack)
});

// null == equivalent on the live-out: RAM untouched (stack window masked by ramDiff) AND register B.
function bDiff(twin, e) {
  const ram = ramDiff(oracle, twin, e);
  if (ram) return `RAM ${ram}`;
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.b !== b.regs.b) return `B: ${a.regs.b} vs ${b.regs.b}`;
  return null;
}

test("EQUAL (crafted): loc_210a == oracle on register B", { skip }, () => {
  assert.equal(bDiff(cand, entry()), null, "the clamp-saturation output diverged");
  // non-vacuous: the oracle actually moves B from the seeded 0x40 to 0x80.
  const a = entry().clone(); a.routines = STUBS; oracle(a);
  assert.equal(a.regs.b, 0x80, "oracle did not saturate B to 0x80");
  console.log("  EQUAL: loc_210a set B 0x40->0x80, == oracle; no RAM touched");
});

test("TEETH: broken twins are caught on register B", { skip }, () => {
  const noOp = () => {};
  const offByOne = (m) => { m.regs.b = 0x81; };
  const zero = (m) => { m.regs.b = 0; };
  assert.ok(bDiff(noOp, entry()), "no-op twin escaped");
  assert.ok(bDiff(offByOne, entry()), "off-by-one twin escaped");
  assert.ok(bDiff(zero, entry()), "zero twin escaped");
  console.log("  TEETH: no-op, off-by-one, zero all caught on B");
});
