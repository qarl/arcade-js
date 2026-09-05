// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_10f0 — memory-equivalent to the frozen oracle at ROM 0x10f0 (object sub-state-0 entry handler).
 * GATE: crafted-entry. Register live-in is IX (the object record base); the memory effects are three
 * seeded timer fields (+0x10,+0x11,+0x12), the advanced sub-state byte (+0x02), and the sound-request
 * selector cell (0x41df) chosen by the position field (+0x07) against the 0x70 threshold. We clone a
 * post-attract seed, point IX at a scratch record, push a return address for the oracle's `ret`, seed the
 * fields with sentinels, and sweep +0x07 across the threshold. Live-out is memory only; RAM is compared.
 * TEETH: a no-op, a threshold-flipped twin (swaps the two selectors), and a no-advance twin (skips the
 * sub-state inc) must all diverge.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { armObjectAnimAndRequestSound as cand } from "../armObjectAnimAndRequestSound.js";
import { loc_10f0 as oracle } from "../../translated/loc_10f0.js";

const OBJ = 0x4200;         // scratch object record base (work RAM, clear of the masked stack window)
const SUBSTATE = OBJ + 2;
const POS = OBJ + 7;
const SELECTOR = 0x41df;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function seed(pos) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.ix = OBJ;
    mem8[POS] = pos;
    mem8[SUBSTATE] = 0x40;     // arbitrary start, to observe the inc
    mem8[OBJ + 16] = 0xee;     // +0x10 sentinel
    mem8[OBJ + 17] = 0xee;     // +0x11 sentinel
    mem8[OBJ + 18] = 0xee;     // +0x12 sentinel
    mem8[SELECTOR] = 0x55;     // selector sentinel
  });
}

// pos values straddling the 0x70 threshold: below -> selector 0x07, at/above -> 0x17.
const POSITIONS = [0x00, 0x6f, 0x70, 0x71, 0xff];

test("EQUAL (crafted): loc_10f0 == oracle across the selector threshold", { skip }, () => {
  for (const pos of POSITIONS) {
    assert.equal(ramDiff(oracle, cand, seed(pos)), null, `pos=0x${pos.toString(16)} diverged`);
  }
  // Positive control: fields seeded, sub-state advanced, selector chosen by the threshold.
  const lo = seed(0x6f); oracle(lo);
  assert.equal(lo.mem8[OBJ + 16], 0x04, "control: +0x10 seeded to 4");
  assert.equal(lo.mem8[OBJ + 17], 0x04, "control: +0x11 seeded to 4");
  assert.equal(lo.mem8[OBJ + 18], 0x1c, "control: +0x12 seeded to 0x1c");
  assert.equal(lo.mem8[SUBSTATE], 0x41, "control: sub-state advanced 0x40 -> 0x41");
  assert.equal(lo.mem8[SELECTOR], 0x07, "control: pos<0x70 -> selector 0x07");
  const hi = seed(0x70); oracle(hi);
  assert.equal(hi.mem8[SELECTOR], 0x17, "control: pos>=0x70 -> selector 0x17");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const flipped = (m) => { // swaps the two selectors
    const { mem8 } = m; const obj = m.regs.ix;
    mem8[obj + 16] = 0x04; mem8[obj + 17] = 0x04; mem8[obj + 18] = 0x1c;
    mem8[obj + 2] = (mem8[obj + 2] + 1) & 0xff;
    mem8[SELECTOR] = mem8[obj + 7] >= 0x70 ? 0x07 : 0x17;
  };
  const noAdvance = (m) => { // seeds fields + selector but skips the sub-state inc
    const { mem8 } = m; const obj = m.regs.ix;
    mem8[obj + 16] = 0x04; mem8[obj + 17] = 0x04; mem8[obj + 18] = 0x1c;
    mem8[SELECTOR] = mem8[obj + 7] >= 0x70 ? 0x17 : 0x07;
  };
  assert.ok(POSITIONS.some((p) => ramDiff(oracle, noOp, seed(p))), "no-op twin escaped");
  assert.ok(POSITIONS.some((p) => ramDiff(oracle, flipped, seed(p))), "threshold-flipped twin escaped");
  assert.ok(POSITIONS.some((p) => ramDiff(oracle, noAdvance, seed(p))), "no-advance twin escaped");
});
