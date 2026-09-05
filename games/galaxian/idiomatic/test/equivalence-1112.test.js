// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1112 — memory-equivalent to the frozen oracle at ROM 0x1112.
 * Register live-in is IX (the object-record base); every live-out is a record field or a global, so RAM
 * equivalence is the whole story. We point IX at a scratch record in work RAM and cover each path:
 *   - FAST COUNTING: fast field > 1 -> only it decrements.
 *   - SLOW COUNTING: fast elapses (reload + companion step), slow field still counting.
 *   - RETIRE: both timers elapse, position below threshold -> state byte cleared.
 *   - ADVANCE: both timers elapse, position at/above threshold -> fast reload, companion seeded, sub-state++.
 * EQUAL asserts ramDiff==null on each with a non-vacuous positive control. Teeth: no-op, wrong-reload,
 * always-retire and wrong-companion twins each diverge. The return-stack window is masked by ramDiff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_1112 as cand } from "../loc_1112.js";
import { loc_1112 as oracle } from "../../translated/loc_1112.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const OBJ = 0x4280;   // scratch record in work RAM, clear of the masked stack window at 0x43e0+
const GLOBAL = 0x422d; // companion source, below the record
const FAST = 0x10, SLOW = 0x11, COMPANION = 0x12, SUBSTATE = 0x02, STATE = 0x01, POS = 0x07;

function seed(mut) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.ix = OBJ;
    mem8[OBJ + FAST] = 3; mem8[OBJ + SLOW] = 3; mem8[OBJ + COMPANION] = 0;
    mem8[OBJ + SUBSTATE] = 0; mem8[OBJ + STATE] = 0x77; mem8[OBJ + POS] = 0;
    mem8[GLOBAL] = 0x10;
    if (mut) mut(mem8, m);
  });
}

const fastCounting = () => seed();                                      // fast=3 -> just ticks
const slowCounting = () => seed((mem) => { mem[OBJ + FAST] = 1; });     // fast elapses, slow still counting
const retire = () => seed((mem) => { mem[OBJ + FAST] = 1; mem[OBJ + SLOW] = 1; mem[OBJ + POS] = 0x6f; });
const advance = () => seed((mem) => { mem[OBJ + FAST] = 1; mem[OBJ + SLOW] = 1; mem[OBJ + POS] = 0x70; });

function ramAfter(fn, e) { const m = e.clone(); m.routines = STUBS; fn(m); return m; }

// Twins.
const noOp = () => {};
const wrongReload = (m) => { cand(m); m.mem8[m.regs.ix + FAST] = 5; };  // fast reload off (4 vs 5)
const alwaysRetire = (m) => { const ix = m.regs.ix; // clears state regardless of the position gate
  m.mem8[ix + FAST] = (m.mem8[ix + FAST] - 1) & 0xff; m.mem8[ix + STATE] = 0; };
const wrongCompanion = (m) => { cand(m); m.mem8[m.regs.ix + COMPANION] = (m.mem8[m.regs.ix + COMPANION] + 1) & 0xff; };

test("EQUAL (crafted): loc_1112 == oracle across every path", { skip }, () => {
  for (const [name, e] of [
    ["fast-counting", fastCounting], ["slow-counting", slowCounting], ["retire", retire], ["advance", advance],
  ]) {
    assert.equal(ramDiff(oracle, cand, e()), null, `loc_1112 diverged on ${name}`);
  }

  // Positive controls.
  assert.equal(ramAfter(oracle, fastCounting()).mem8[OBJ + FAST], 2, "fast-counting decrements 3->2");
  const sc = ramAfter(oracle, slowCounting());
  assert.equal(sc.mem8[OBJ + FAST], 4, "slow-counting reloads fast to 4");
  assert.equal(sc.mem8[OBJ + COMPANION], 1, "slow-counting steps the companion");
  assert.equal(sc.mem8[OBJ + SLOW], 2, "slow-counting decrements slow 3->2");
  assert.equal(ramAfter(oracle, retire()).mem8[OBJ + STATE], 0, "retire clears the state byte");
  const ad = ramAfter(oracle, advance());
  assert.equal(ad.mem8[OBJ + FAST], 50, "advance reloads fast to 50");
  assert.equal(ad.mem8[OBJ + COMPANION], (0x10 + 0x20) & 0xff, "advance seeds companion from the global + bias");
  assert.equal(ad.mem8[OBJ + SUBSTATE], 1, "advance bumps the sub-state");
  console.log("  EQUAL: loc_1112 == oracle on all four paths");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, fastCounting()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongReload, slowCounting()), "the wrong-reload twin escaped");
  assert.ok(ramDiff(oracle, alwaysRetire, advance()), "the always-retire twin escaped");
  assert.ok(ramDiff(oracle, wrongCompanion, advance()), "the wrong-companion twin escaped");
  console.log("  TEETH: no-op, wrong-reload, always-retire, wrong-companion all caught");
});
