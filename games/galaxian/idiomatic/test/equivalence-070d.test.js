// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_070d — memory-equivalent to the frozen oracle at ROM 0x070d, with its m.call(0x070e) dissolved
 * into a direct call of the idiomatic loc_070e. The oracle does `inc (hl)` then falls into 0x070e,
 * which is `dec l; ld (hl),0x50` — i.e. with HL=0x400a it bumps the sub-state counter at 0x400a and
 * re-arms the mode timer at 0x4009 to 0x50. The idiomatic 0x070e hard-codes 0x4009 (its batch-1 ABI:
 * HL is always 0x400a on entry, held by every caller), so the crafted entry seats HL=0x400a. Both
 * cells are in the state dump, so EQUAL is ramDiff==null (no register live-out — callers tail-return).
 * Both cells are pre-sentinelled so the oracle demonstrably moves them. Teeth: no-op, missing timer,
 * missing increment, and wrong-counter twins each make ramDiff non-null.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_070d as cand } from "../loc_070d.js";
import { loc_070d as oracle } from "../../translated/loc_070d.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const COUNTER = 0x400a; // HL on entry -> the sub-state counter that gets bumped
const TIMER = 0x4009;   // the mode dwell timer re-armed to 0x50
const RELOAD = 0x50;

const entry = () => craft((mem, mm) => {
  mem[COUNTER] = 0x10; // oracle bumps to 0x11
  mem[TIMER] = 0xaa;   // oracle re-arms to 0x50
  mm.regs.hl = COUNTER;
  mm.push16(0x9999);
});

const noOp = () => {};
const noTimer = (m) => { m.mem8[COUNTER] = m.mem8[COUNTER] + 1; };           // bumps counter, forgets the timer
const noInc = (m) => { m.mem8[TIMER] = RELOAD; };                            // arms timer, forgets the counter
const wrongCounter = (m) => { m.mem8[COUNTER + 1] = m.mem8[COUNTER + 1] + 1; m.mem8[TIMER] = RELOAD; };

test("EQUAL (crafted): loc_070d == oracle bumps the counter and re-arms the timer", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_070d diverged");
  // non-vacuous: the oracle really increments the counter and re-arms the timer.
  const a = entry().clone(); a.routines = STUBS; oracle(a);
  assert.equal(a.mem8[COUNTER], 0x11, "positive control: oracle bumped the counter");
  assert.equal(a.mem8[TIMER], RELOAD, "positive control: oracle re-armed the timer");
  console.log("  EQUAL: loc_070d == oracle, counter 0x10->0x11, timer -> 0x50");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, noTimer, entry()), "the missing-timer twin escaped");
  assert.ok(ramDiff(oracle, noInc, entry()), "the missing-increment twin escaped");
  assert.ok(ramDiff(oracle, wrongCounter, entry()), "the wrong-counter twin escaped");
  console.log("  TEETH: no-op, missing-timer, missing-increment, wrong-counter all caught");
});
