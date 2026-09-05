// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_113d — memory-equivalent to the frozen oracle at ROM 0x113d.
 * Register live-in is IX (the actor record base). We craft an attract seed, push a return address for
 * the oracle's `ret`, point IX at a scratch record in work RAM, and seed the record's timer (+0x10) and
 * state byte (+0x01). The routine ticks the timer down and, only on the frame it reaches zero, clears
 * the state byte. It is BRANCHY on the timer: >1 -> ret nz (state untouched); ==1 -> reaches zero and
 * clears state; ==0 -> wraps to 0xff (ret nz). We seed 3, 2, 1 and the 0-wrap. RAM is compared.
 * TEETH: always-clear, never-clear and decrement-by-two twins must each diverge.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { endObjectAnimOnTimerExpiry as loc_113d } from "../endObjectAnimOnTimerExpiry.js";
import { loc_113d as oracle } from "../../translated/loc_113d.js";

const OBJ = 0x4280; // scratch actor record in work RAM (clear of the masked stack window at 0x43e0+)
const TIMER = 0x10; // +0x10 countdown
const STATE = 0x01; // +0x01 state byte
const STATE_SENTINEL = 0x77; // oracle clears state to 0 only on the expiry frame
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// broken twins (read IX live — test code, not the idiomatic module).
function brokenAlwaysClear(m) {
  const ix = m.regs.ix;
  m.mem8[ix + TIMER] = (m.mem8[ix + TIMER] - 1) & 0xff;
  m.mem8[ix + STATE] = 0; // clears regardless of expiry
}
function brokenNeverClear(m) {
  const ix = m.regs.ix;
  m.mem8[ix + TIMER] = (m.mem8[ix + TIMER] - 1) & 0xff; // never clears the state byte
}
function brokenDecTwo(m) {
  const ix = m.regs.ix;
  const r = (m.mem8[ix + TIMER] - 2) & 0xff;
  m.mem8[ix + TIMER] = r;
  if (r === 0) m.mem8[ix + STATE] = 0;
}

function seed(timer) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.ix = OBJ;
    mem8[OBJ + TIMER] = timer;
    mem8[OBJ + STATE] = STATE_SENTINEL;
  });
}

test("loc_113d == oracle across timer values", { skip }, () => {
  for (const t of [3, 2, 1, 0]) {
    assert.equal(ramDiff(oracle, loc_113d, seed(t)), null, `timer=${t} diverged`);
  }
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenAlwaysClear, seed(3)) !== null, "the always-clear twin escaped");
  assert.ok(ramDiff(oracle, brokenNeverClear, seed(1)) !== null, "the never-clear twin escaped");
  assert.ok(ramDiff(oracle, brokenDecTwo, seed(3)) !== null, "the decrement-by-two twin escaped");
});
