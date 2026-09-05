// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_18e7 — crafted-entry equivalence vs the frozen terminator tail. The candidate DISSOLVES the old
 * indirect call, invoking the countdown-tick leaf directly with the pointer that arrives in DE. Its
 * live-outs are work RAM only (the counter byte, and the scroll-enable flag cleared on the zero
 * crossing); DE/HL are dead at the caller, so ramDiff alone covers it. Paths: a plain tick and the
 * finish. Teeth: no-op, never-decrement, a finish that fails to stop the scroller, and a wrong-cell tick.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_18e7 as cand } from "../loc_18e7.js";
import { loc_18e7 as oracle } from "../../translated/loc_18e7.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const COUNTER = 0x4100; // work-RAM cell the countdown pointer (DE) addresses
const SCROLL_ENABLE = 0x40b0; // cleared on the zero crossing

// DE carries the countdown pointer at entry; the tail swaps it into HL and decrements it.
function entry(counterValue, scroll) {
  return craft((mem8, mm) => {
    mm.push16(0x9999);
    mm.regs.de = COUNTER;
    mem8[COUNTER] = counterValue;
    mem8[SCROLL_ENABLE] = scroll;
  });
}

const tick = () => entry(5, 1); // counter above 1 -> just decrements
const finish = () => entry(1, 1); // counter hits 0 -> stop the scroller

test("EQUAL (crafted): loc_18e7 == oracle on a tick and on the finish", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, tick()), null, "loc_18e7 diverged on the tick path");
  assert.equal(ramDiff(oracle, cand, finish()), null, "loc_18e7 diverged on the finish path");
  // non-vacuous: the oracle decrements the counter, and clears the scroll flag on the zero crossing.
  const t = tick(); oracle(t);
  assert.equal(t.mem8[COUNTER], 4, "positive control: oracle ticked the counter down");
  const f = finish(); oracle(f);
  assert.equal(f.mem8[COUNTER], 0, "positive control: oracle reached zero");
  assert.equal(f.mem8[SCROLL_ENABLE], 0, "positive control: oracle stopped the scroller");
  console.log("  EQUAL: loc_18e7 == oracle (RAM) on tick and finish");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const neverDec = (m) => { if (m.mem8[COUNTER] === 0) m.mem8[SCROLL_ENABLE] = 0; }; // clears but never ticks
  const noFinish = (m) => { m.mem8[COUNTER] = m.mem8[COUNTER] - 1; }; // ticks but never stops the scroller
  const wrongCell = (m) => { m.mem8[COUNTER + 1] = m.mem8[COUNTER + 1] - 1; }; // decrements the wrong byte
  assert.ok(ramDiff(oracle, noOp, tick()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, neverDec, tick()), "the never-decrement twin escaped");
  assert.ok(ramDiff(oracle, noFinish, finish()), "the no-finish twin escaped");
  assert.ok(ramDiff(oracle, wrongCell, tick()), "the wrong-cell twin escaped");
  console.log("  TEETH: no-op, never-decrement, no-finish, wrong-cell all caught");
});
