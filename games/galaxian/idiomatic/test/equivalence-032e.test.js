// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_032e — crafted-entry equivalence vs the frozen state handler (dissolved).
 * The handler points at the step-1 dwell timer and delegates to the shared cascade tick, so its live-out
 * is memory only: the timer byte decrements, and on reaching zero the next cell is bumped. A post-attract
 * seed is cloned, the timer + neighbour poked, and a return address laid for the oracle's ret (which routes
 * through the still-translated cascade via STUBS). EQUAL asserts ramDiff==null on the still-counting and
 * expiry-carry paths, with a non-vacuous positive control. Teeth: no-op, no-carry, and wrong-cell twins.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { loc_032e as cand } from "../loc_032e.js";
import { loc_032e as oracle } from "../../translated/loc_032e.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TIMER = 0x4009; // the dwell-timer byte the handler ticks
const NEXT = TIMER + 1; // 0x400a, bumped on expiry

const stillCounting = () => craft((mem, m) => { m.push16(0x9999); mem[TIMER] = 3; mem[NEXT] = 0x10; });
const expiry = () => craft((mem, m) => { m.push16(0x9999); mem[TIMER] = 1; mem[NEXT] = 0x10; });

test("EQUAL (crafted): loc_032e == oracle on tick and on expiry-carry", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, stillCounting()), null, "the still-counting path diverged");
  assert.equal(ramDiff(oracle, cand, expiry()), null, "the expiry/carry path diverged");

  // Non-vacuous: the oracle ticks the timer, and carries into the next cell on expiry.
  const a = stillCounting(); oracle(a);
  assert.equal(a.mem8[TIMER], 2, "control: timer 3->2 on a plain tick");
  assert.equal(a.mem8[NEXT], 0x10, "control: no carry while still counting");
  const b = expiry(); oracle(b);
  assert.equal(b.mem8[TIMER], 0, "control: timer 1->0 on expiry");
  assert.equal(b.mem8[NEXT], 0x11, "control: next cell carried on expiry");
  console.log("  EQUAL: loc_032e == oracle, tick 3->2 (no carry) and expiry 1->0 (carry)");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const noCarry = (m) => { const { mem8 } = m; mem8[TIMER] = (mem8[TIMER] - 1) & 0xff; };
  const wrongCell = (m) => {
    const { mem8 } = m; const v = (mem8[TIMER] - 1) & 0xff; mem8[TIMER] = v;
    if (v === 0) mem8[TIMER + 2] = (mem8[TIMER + 2] + 1) & 0xff;
  };
  assert.ok(ramDiff(oracle, noOp, stillCounting()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, noCarry, expiry()), "no-carry twin escaped");
  assert.ok(ramDiff(oracle, wrongCell, expiry()), "wrong-cell twin escaped");
  console.log("  TEETH: no-op, no-carry, wrong-cell all caught by the RAM diff");
});
