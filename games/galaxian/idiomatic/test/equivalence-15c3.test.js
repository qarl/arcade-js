// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_15c3 — crafted-entry equivalence vs the frozen delayed one-shot.
 * Every live-out is work RAM (the armed flag, the delay counter, the request flag) — no register or
 * latch — so ramDiff alone covers it, across not-armed, still-counting, fire, and a gated-off tick.
 * Teeth: no-op, a twin that never disarms, a twin that fires despite a closed enable, and a
 * never-decrement twin.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_15c3 as cand } from "../loc_15c3.js";
import { loc_15c3 as oracle } from "../../translated/loc_15c3.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const ARMED = 0x422e, TIMER = 0x422f, REQUEST = 0x4229, EN1 = 0x4200, EN2 = 0x41ef;

function entry(armed, timer, en1, en2) {
  return craft((mem8, mm) => {
    mm.push16(0x9999);
    mem8[ARMED] = armed;
    mem8[TIMER] = timer;
    mem8[EN1] = en1;
    mem8[EN2] = en2;
    mem8[REQUEST] = 0;
  });
}

const notArmed = () => entry(0x00, 5, 1, 1);
const counting = () => entry(0x01, 5, 1, 1);
const fire = () => entry(0x01, 1, 1, 1);
const gatedOff = () => entry(0x01, 1, 1, 0); // delay elapses but the second enable is clear

test("EQUAL (crafted): loc_15c3 == oracle across not-armed, counting, fire and gated-off", { skip }, () => {
  for (const [name, e] of [["not-armed", notArmed()], ["counting", counting()], ["fire", fire()],
                           ["gated-off", gatedOff()]]) {
    assert.equal(ramDiff(oracle, cand, e), null, `loc_15c3 diverged on ${name}`);
  }
  // non-vacuous: the oracle raises the request (and disarms) on fire, and ticks the delay while counting.
  const f = fire(); oracle(f);
  assert.equal(f.mem8[REQUEST], 1, "positive control: oracle raised the request");
  assert.equal(f.mem8[ARMED], 0, "positive control: oracle disarmed the one-shot");
  const c = counting(); oracle(c);
  assert.equal(c.mem8[TIMER], 4, "positive control: oracle ticked the delay down");
  console.log("  EQUAL: loc_15c3 == oracle (RAM) on all four paths");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const neverDisarm = (m) => { m.mem8[TIMER] = m.mem8[TIMER] - 1;
    if (m.mem8[TIMER] === 0) m.mem8[REQUEST] = 1; }; // fires but leaves the armed flag set
  const ignoreEnable = (m) => { m.mem8[TIMER] = m.mem8[TIMER] - 1;
    if (m.mem8[TIMER] === 0) { m.mem8[ARMED] = 0; m.mem8[REQUEST] = 1; } }; // fires without checking the enables
  const neverDec = (m) => { if (m.mem8[ARMED] & 0x01 && m.mem8[TIMER] === 1) { m.mem8[ARMED] = 0; m.mem8[REQUEST] = 1; } };
  assert.ok(ramDiff(oracle, noOp, fire()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, neverDisarm, fire()), "the never-disarm twin escaped");
  assert.ok(ramDiff(oracle, ignoreEnable, gatedOff()), "the enable-ignoring twin escaped");
  assert.ok(ramDiff(oracle, neverDec, counting()), "the never-decrement twin escaped");
  console.log("  TEETH: no-op, never-disarm, enable-ignoring, never-decrement all caught");
});
