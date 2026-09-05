// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0322 — memory-equivalent to the frozen oracle at ROM 0x0322.
 * The routine takes NO register live-in: it stores three fixed constants into the sequence control
 * block (SEQUENCE_STATE = 1, and the dwell timer bytes 0x4008/0x4009 = 3/3). We craft an attract seed,
 * push a return address for the oracle's `ret`, seed the three target cells with sentinels so a dropped
 * store is visible, and compare RAM. LIVE-OUT is memory-only, so RAM is compared (stack window masked).
 * TEETH: a wrong-state twin and a no-op twin must both diverge.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { enterSequenceStep1 as loc_0322 } from "../enterSequenceStep1.js";
import { loc_0322 as oracle } from "../../translated/loc_0322.js";

const SEQUENCE_STATE = 0x400a;
const STATE_TIMER_FRAMES = 0x4008;
const STATE_TIMER_TICKS = 0x4009;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// broken twins.
function brokenNoOp() {}
function brokenWrongState(m) {
  const { mem8 } = m;
  mem8[SEQUENCE_STATE] = 2; // oracle writes 1
  mem8[STATE_TIMER_FRAMES] = 3;
  mem8[STATE_TIMER_TICKS] = 3;
}

function seed() {
  return craft((mem8, m) => {
    m.push16(0x9999); // return address for the oracle's ret
    mem8[SEQUENCE_STATE] = 0xaa; // sentinels: any dropped store shows in the diff
    mem8[STATE_TIMER_FRAMES] = 0xbb;
    mem8[STATE_TIMER_TICKS] = 0xcc;
  });
}

test("loc_0322 == oracle (fixed-constant stores)", { skip }, () => {
  assert.equal(ramDiff(oracle, loc_0322, seed()), null, "candidate diverged from oracle");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoOp, seed()) !== null, "the no-op twin escaped");
  assert.ok(ramDiff(oracle, brokenWrongState, seed()) !== null, "the wrong-state twin escaped");
});
