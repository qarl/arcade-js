// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_109b — memory-equivalent to the frozen oracle at ROM 0x109b.
 * Per-object phase entry addressed by IX. It writes only record fields (n+1 at +0x16, a code byte at
 * +0x03, the phase timer 0x18 at +0x10, an incremented sub-state at +0x02, the ready flag at +0x0f),
 * so its live-out is pure RAM and EQUAL is ramDiff. n = (~(ix+0x07))&3 selects the path: n!=0 leaves
 * the ready flag clear, n==0 arms it to 0x18. We sweep seeds covering n=3,1,0 and a sub-state wrap.
 * Positive control: the oracle stamps n+1 at +0x16 (over a sentinel). Teeth: no-op, ready-flag-always,
 * and a code-byte perturbation.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_109b as cand } from "../loc_109b.js";
import { loc_109b as oracle } from "../../translated/loc_109b.js";

const REC = 0x4100; // object record base (work RAM, in the state dump, clear of the masked stack window)
const SEED = REC + 0x07;
const STEP_COUNT = REC + 0x16;
const CODE_BYTE = REC + 0x03;
const PHASE_TIMER = REC + 0x10;
const SUB_STATE = REC + 0x02;
const READY_FLAG = REC + 0x0f;
const SENTINEL = 0xaa;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A crafted entry with IX = REC, the phase seed and sub-state poked, and every output cell pre-dirtied
// with a sentinel so the oracle demonstrably overwrites them.
function entry(seed, subState = 0x10) {
  return craft((mem, m) => {
    m.push16(0x9999);
    m.regs.ix = REC;
    mem[SEED] = seed;
    mem[SUB_STATE] = subState;
    mem[STEP_COUNT] = SENTINEL;
    mem[CODE_BYTE] = SENTINEL;
    mem[PHASE_TIMER] = SENTINEL;
    mem[READY_FLAG] = SENTINEL;
  });
}

// seeds chosen so n = (~seed)&3 spans 3,1,0(twice); one entry wraps the sub-state 0xff->0x00.
const cases = [
  [0x00, 0x10], // n=3
  [0x02, 0x10], // n=1
  [0x03, 0x10], // n=0 -> ready flag armed
  [0xff, 0xff], // n=0 and sub-state wraps
];

// Teeth twins.
const noOp = () => {};
const readyAlways = (m) => { cand(m); m.mem8[READY_FLAG] = 0x18; };            // ignores the n==0 gate
const badCode = (m) => { cand(m); m.mem8[CODE_BYTE] = (m.mem8[CODE_BYTE] + 1) & 0xff; };

test("EQUAL (crafted): loc_109b == oracle across phase seeds", { skip }, () => {
  for (const [seed, sub] of cases) {
    assert.equal(ramDiff(oracle, cand, entry(seed, sub)), null,
      `loc_109b diverged (seed=0x${seed.toString(16)} sub=0x${sub.toString(16)})`);
  }
  // positive control: for seed 0x03, n=0 -> n+1=1 at +0x16 and ready flag armed to 0x18.
  const a = entry(0x03); oracle(a);
  assert.equal(a.mem8[STEP_COUNT], 1, "positive control: oracle did not write n+1 at +0x16");
  assert.equal(a.mem8[READY_FLAG], 0x18, "positive control: n==0 should arm the ready flag");
  // seed 0x02 -> n=1 -> ready flag stays clear.
  const b = entry(0x02); oracle(b);
  assert.equal(b.mem8[READY_FLAG], 0, "positive control: n!=0 should leave the ready flag clear");
  console.log("  EQUAL: loc_109b == oracle across n=3,1,0 and a sub-state wrap");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, entry(0x00)), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, readyAlways, entry(0x02)), "the ready-flag-always twin escaped");
  assert.ok(ramDiff(oracle, badCode, entry(0x00)), "the code-byte twin escaped");
  console.log("  TEETH: no-op, ready-flag-always, code-byte perturbation all caught");
});
