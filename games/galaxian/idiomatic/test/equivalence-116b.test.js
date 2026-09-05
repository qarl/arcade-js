// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_116b — memory-equivalent to the frozen oracle at ROM 0x116b.
 * Cross-coupled fixed-point rotation on two 16-bit accumulators held in the IX record: the seed at
 * +0x18 sets the step count, the accumulators live at +0x19/+0x1b (acc1 hi/lo) and +0x1a/+0x1c
 * (acc2 hi/lo). It writes only those four record bytes, so its live-out is pure RAM and EQUAL is
 * ramDiff. Vectors span multi-step runs, carry propagation, and a source high byte with bit 7 set
 * (exercising the sign-extension). Positive control: a one-step run visibly moves acc1's low byte to
 * 0x80. Teeth: no-op, hi/lo perturbations, and a twin that drops the sign-extension.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_116b as cand } from "../loc_116b.js";
import { loc_116b as oracle } from "../../translated/loc_116b.js";

const REC = 0x4100; // object record base (work RAM, in the state dump, clear of the masked stack window)
const SEED = REC + 0x18;
const ACC1_HI = REC + 0x19, ACC1_LO = REC + 0x1b;
const ACC2_HI = REC + 0x1a, ACC2_LO = REC + 0x1c;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A crafted entry with IX = REC and the seed + both accumulators poked.
function entry(seed, a1h, a1l, a2h, a2l) {
  return craft((mem, m) => {
    m.push16(0x9999);
    m.regs.ix = REC;
    mem[SEED] = seed;
    mem[ACC1_HI] = a1h; mem[ACC1_LO] = a1l;
    mem[ACC2_HI] = a2h; mem[ACC2_LO] = a2l;
  });
}

// [seed, acc1hi, acc1lo, acc2hi, acc2lo]
const cases = [
  [0x03, 0x30, 0x00, 0x00, 0x00], // 4 steps
  [0x00, 0x00, 0x00, 0x40, 0x00], // 1 step -- positive-control vector (acc1 low -> 0x80)
  [0x02, 0x90, 0x00, 0x10, 0x00], // 3 steps, negative highs
  [0x03, 0x7f, 0xff, 0x01, 0x01], // carry propagation
  [0x00, 0x10, 0x00, 0x90, 0x00], // 1 step, source high byte bit 7 set -> sign-extension
  [0x01, 0x40, 0x00, 0x40, 0x00], // 2 steps
];

// Teeth twins.
const noOp = () => {};
const perturbHi = (m) => { cand(m); m.mem8[ACC1_HI] = (m.mem8[ACC1_HI] + 1) & 0xff; };
const perturbLo = (m) => { cand(m); m.mem8[ACC1_LO] ^= 0xff; };

// Reimplements the integration but WITHOUT the sign-extension borrow; must diverge when a source high
// byte has bit 7 set (case 5).
function brokenNoSign(m) {
  const step = (hi, lo, srcHi) => {
    const sum = ((srcHi << 1) & 0xff) + lo;
    const hiNext = (hi + (sum > 0xff ? 1 : 0)) & 0xff; // borrow dropped
    return [hiNext === 128 ? hi : hiNext, sum & 0xff];
  };
  const steps = (m.mem8[SEED] & 3) + 1;
  let hi1 = m.mem8[ACC1_HI], lo1 = m.mem8[ACC1_LO];
  let hi2 = m.mem8[ACC2_HI], lo2 = m.mem8[ACC2_LO];
  for (let i = 0; i < steps; i++) {
    [hi1, lo1] = step(hi1, lo1, hi2);
    [hi2, lo2] = step(hi2, lo2, -hi1 & 0xff);
  }
  m.mem8[ACC1_HI] = hi1; m.mem8[ACC2_HI] = hi2;
  m.mem8[ACC1_LO] = lo1; m.mem8[ACC2_LO] = lo2;
}

test("EQUAL (crafted): loc_116b == oracle across step counts, carries, and sign-extension", { skip }, () => {
  for (const [seed, a1h, a1l, a2h, a2l] of cases) {
    assert.equal(ramDiff(oracle, cand, entry(seed, a1h, a1l, a2h, a2l)), null,
      `loc_116b diverged (seed=0x${seed.toString(16)} acc1=${a1h},${a1l} acc2=${a2h},${a2l})`);
  }
  // positive control: the one-step vector moves acc1's low byte 0x00 -> 0x80.
  const a = entry(0x00, 0x00, 0x00, 0x40, 0x00); oracle(a);
  assert.equal(a.mem8[ACC1_LO], 0x80, "positive control: oracle did not integrate acc1's low byte");
  console.log("  EQUAL: loc_116b == oracle across 6 vectors (steps/carry/sign-extension)");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const changing = () => entry(0x00, 0x00, 0x00, 0x40, 0x00);
  assert.ok(ramDiff(oracle, noOp, changing()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, perturbHi, changing()), "the hi-perturbation twin escaped");
  assert.ok(ramDiff(oracle, perturbLo, changing()), "the lo-perturbation twin escaped");
  assert.ok(ramDiff(oracle, brokenNoSign, entry(0x00, 0x10, 0x00, 0x90, 0x00)),
    "the dropped-sign-extension twin escaped");
  console.log("  TEETH: no-op, hi/lo perturbations, dropped-sign-extension all caught");
});
