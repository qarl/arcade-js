// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0df6 — crafted-entry equivalence vs the frozen move-target commit primitive.
 * Covers the single straight-line path: target X stashed, signed move delta computed (current − target,
 * wrapping mod 256), the 3-byte accumulator zeroed, and the sub-state bumped. IX points into clean work
 * RAM below the masked stack window so every write is visible in the RAM diff.
 * Teeth: a no-op twin; a sign-flipped-delta twin; a twin that skips the sub-state bump — all must diverge.
 * Positive control: the oracle really wrote the target, the wrapped delta, the zeros and the bumped state.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { commitMoveToTargetX as cand } from "../commitMoveToTargetX.js";
import { loc_0df6 as oracle } from "../../translated/loc_0df6.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const REC = 0x43a0;      // object record base: clean work RAM, all fields below the masked 0x43e0 window
const TARGET_X = 0x50;   // chosen target X (register A on entry)
const CURRENT_X = 0x30;  // record +0x04; delta = (0x30 - 0x50) & 0xff = 0xe0
const EXPECT_DELTA = (CURRENT_X - TARGET_X) & 0xff;

const seed = () => craft((mem, mm) => {
  mm.regs.ix = REC;
  mm.regs.a = TARGET_X;
  mem[REC + 0x02] = 0x07;             // stale sub-state (expect +1)
  mem[REC + 0x04] = CURRENT_X;        // current X
  mem[REC + 0x09] = 0xbb;             // stale delta (expect overwritten)
  mem[REC + 0x19] = 0xaa;             // stale target (expect overwritten)
  mem[REC + 0x1a] = 0x11; mem[REC + 0x1b] = 0x22; mem[REC + 0x1c] = 0x33; // stale accumulator (expect 0)
});

test("EQUAL (crafted): loc_0df6 == oracle on the commit path", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, seed()), null, "the commit path diverged");

  const a = seed().clone(); oracle(a);
  assert.equal(a.mem8[REC + 0x19], TARGET_X, "target X not stored");
  assert.equal(a.mem8[REC + 0x09], EXPECT_DELTA, "wrapped move delta not stored");
  assert.equal(a.mem8[REC + 0x1a], 0, "accumulator byte 0 not zeroed");
  assert.equal(a.mem8[REC + 0x1b], 0, "accumulator byte 1 not zeroed");
  assert.equal(a.mem8[REC + 0x1c], 0, "accumulator byte 2 not zeroed");
  assert.equal(a.mem8[REC + 0x02], 0x08, "sub-state not bumped");
  console.log(`  EQUAL: target 0x${TARGET_X.toString(16)}, delta 0x${EXPECT_DELTA.toString(16)}, accum zeroed, sub-state 7->8`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const signFlipped = (m) => { // delta with the wrong sign (target − current instead of current − target)
    const { mem8 } = m; const rec = m.regs.ix; const t = m.regs.a;
    mem8[rec + 0x19] = t;
    mem8[rec + 0x09] = t - mem8[rec + 0x04];
    mem8[rec + 0x1a] = 0; mem8[rec + 0x1b] = 0; mem8[rec + 0x1c] = 0;
    mem8[rec + 0x02] = mem8[rec + 0x02] + 1;
  };
  const noBump = (m) => { // everything but the sub-state increment
    const { mem8 } = m; const rec = m.regs.ix; const t = m.regs.a;
    mem8[rec + 0x19] = t;
    mem8[rec + 0x09] = mem8[rec + 0x04] - t;
    mem8[rec + 0x1a] = 0; mem8[rec + 0x1b] = 0; mem8[rec + 0x1c] = 0;
  };
  assert.ok(ramDiff(oracle, noOp, seed()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, signFlipped, seed()), "sign-flipped-delta twin escaped");
  assert.ok(ramDiff(oracle, noBump, seed()), "missing-sub-state-bump twin escaped");
  console.log("  TEETH: no-op, sign-flipped delta, missing sub-state bump all caught");
});
