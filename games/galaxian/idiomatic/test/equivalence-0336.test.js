// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0336 — crafted-entry equivalence vs the frozen sub-timer tail at ROM 0x0336 (DISSOLVED).
 * The routine ticks the sub-timer at 0x4008; while it is still counting it just returns. On wrap it
 * reloads 0x4008 = 0x3c (60) and cascades into loc_0331 starting at 0x4009 — the m.call(0x0331) is
 * dissolved into a direct idiomatic call. Live-out is memory only: 0x4008 (dec/reload), 0x4009 (the
 * next tier, decremented by the cascade), and 0x400a (bumped when that tier expires). A post-attract
 * seed is cloned, the three cells poked, and a return address laid for the oracle's ret (which routes
 * its still-translated cascade through STUBS). EQUAL asserts ramDiff==null on the still-counting,
 * wrap-tier-counts, and wrap-tier-expires paths with non-vacuous controls. Teeth: no-op, no-reload,
 * wrong-reload, and no-cascade twins.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { loc_0336 as cand } from "../loc_0336.js";
import { loc_0336 as oracle } from "../../translated/loc_0336.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const SUB = 0x4008; // sub-timer ticked first
const TIMER = 0x4009; // next-tier timer the cascade ticks on wrap
const NEXT = 0x400a; // phase counter bumped when the next tier expires
const RELOAD = 60; // 0x3c reload written back into the sub-timer on wrap

// Sub-timer still counting -> plain decrement, no cascade.
const stillCounting = () => craft((mem, m) => { m.push16(0x9999); mem[SUB] = 3; mem[TIMER] = 5; mem[NEXT] = 0x10; });
// Sub-timer wraps; the next tier is still counting.
const wrapTierCounts = () => craft((mem, m) => { m.push16(0x9999); mem[SUB] = 1; mem[TIMER] = 5; mem[NEXT] = 0x10; });
// Sub-timer wraps and the next tier also expires -> carry into 0x400a.
const wrapTierExpires = () => craft((mem, m) => { m.push16(0x9999); mem[SUB] = 1; mem[TIMER] = 1; mem[NEXT] = 0x10; });

test("EQUAL (crafted): loc_0336 == oracle on tick, wrap, and wrap-with-carry", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, stillCounting()), null, "the still-counting path diverged");
  assert.equal(ramDiff(oracle, cand, wrapTierCounts()), null, "the wrap/tier-counts path diverged");
  assert.equal(ramDiff(oracle, cand, wrapTierExpires()), null, "the wrap/tier-expiry path diverged");

  // Non-vacuous positive controls: the oracle really moves each live-out.
  const a = stillCounting(); oracle(a);
  assert.equal(a.mem8[SUB], 2, "control: sub-timer 3->2 on a plain tick");
  assert.equal(a.mem8[TIMER], 5, "control: no cascade while still counting");
  const b = wrapTierCounts(); oracle(b);
  assert.equal(b.mem8[SUB], RELOAD, "control: sub-timer reloaded to 60 on wrap");
  assert.equal(b.mem8[TIMER], 4, "control: next tier 5->4 on wrap");
  assert.equal(b.mem8[NEXT], 0x10, "control: no carry while the next tier is still counting");
  const c = wrapTierExpires(); oracle(c);
  assert.equal(c.mem8[SUB], RELOAD, "control: sub-timer reloaded to 60 on wrap");
  assert.equal(c.mem8[TIMER], 0, "control: next tier 1->0 on expiry");
  assert.equal(c.mem8[NEXT], 0x11, "control: phase counter 0x10->0x11 carried");
  console.log("  EQUAL: loc_0336 == oracle, tick 3->2, wrap reload+cascade, and carry into 0x400a");
});

test("TEETH: broken twins are caught by the RAM diff", { skip }, () => {
  const noOp = () => {};
  // Decrements the sub-timer but never reloads or cascades on wrap.
  const noReload = (m) => { const { mem8 } = m; mem8[SUB] = (mem8[SUB] - 1) & 0xff; };
  // Cascades correctly but reloads the sub-timer with the wrong value.
  const wrongReload = (m) => {
    const { mem8 } = m;
    const r = (mem8[SUB] - 1) & 0xff; mem8[SUB] = r;
    if (r !== 0) return;
    mem8[SUB] = 59; // should be 60
    mem8[TIMER] = (mem8[TIMER] - 1) & 0xff;
  };
  // Reloads on wrap but never ticks the next tier.
  const noCascade = (m) => {
    const { mem8 } = m;
    const r = (mem8[SUB] - 1) & 0xff; mem8[SUB] = r;
    if (r !== 0) return;
    mem8[SUB] = RELOAD;
  };

  assert.ok(ramDiff(oracle, noOp, stillCounting()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, noReload, wrapTierCounts()), "no-reload twin escaped");
  assert.ok(ramDiff(oracle, wrongReload, wrapTierCounts()), "wrong-reload twin escaped");
  assert.ok(ramDiff(oracle, noCascade, wrapTierExpires()), "no-cascade twin escaped");
  console.log("  TEETH: no-op, no-reload, wrong-reload, no-cascade all caught by the RAM diff");
});
