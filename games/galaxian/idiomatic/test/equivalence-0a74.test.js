// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0a74 — crafted-entry equivalence vs the frozen per-object motion/sprite update at ROM 0x0a74.
 * The routine is memory-driven: it reads a phase bit (0x425f), a direction flag (0x4018), the 7 ten-byte
 * object records at 0x4260, and writes the integrated positions back plus the sprite shadow at 0x4081.
 * It takes no input registers and leaves none the caller reads (the caller's next op is another call), so
 * the whole live-out is RAM and ramDiff suffices. The seed fills all 14 sub-slots with a rotation of
 * scenarios — active/keep, sub-position overflow, integrate-off-screen, inactive — so every branch runs,
 * and the sprite shadow is pre-dirtied so writes are observable. EQUAL runs both phase and both direction
 * values. Teeth: no-op, and cand-plus-perturbation of a sprite cell and a record cell.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_0a74 as cand } from "../loc_0a74.js";
import { loc_0a74 as oracle } from "../../translated/loc_0a74.js";

const PHASE = 0x425f; // bit0 selects the leading sub-slot
const DIR = 0x4018; // bit0 mirrors the sprite Y
const REC_BASE = 0x4260; // 7 records x 10 bytes = 2 sub-slots each
const SPR_BASE = 0x4081; // sprite shadow, 7 x 4 bytes
const SPR_SENTINEL = 0x5a; // pre-poked across the sprite shadow so oracle writes are visible
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// Sub-slot templates [active, sub-position, pos-lo, pos-hi, velocity].
const SCENARIOS = [
  [1, 0x20, 0x00, 0x40, 0x02], // active, stays in the window
  [1, 0xfa, 0x11, 0x22, 0x03], // active, sub-position overflows -> deactivates
  [1, 0x30, 0x00, 0x05, 0xfe], // active, integrates off-screen -> deactivates
  [0, 0x11, 0x22, 0x33, 0x44], // inactive
  [1, 0x10, 0x80, 0x18, 0x7f], // active, large positive velocity, stays in the window
];

// A crafted entry with the phase/direction flags set, all 14 sub-slots filled from SCENARIOS, and the
// sprite shadow pre-dirtied. A ret address is laid for the oracle's ret.
function entry(phase, dir) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    mem8[PHASE] = phase;
    mem8[DIR] = dir;
    for (let a = REC_BASE; a < REC_BASE + 84; a++) mem8[a] = (a * 13 + 7) & 0xff; // deterministic filler
    for (let slot = 0; slot < 14; slot++) {
      const t = SCENARIOS[slot % SCENARIOS.length];
      for (let b = 0; b < 5; b++) mem8[REC_BASE + slot * 5 + b] = t[b];
    }
    for (let a = SPR_BASE; a < SPR_BASE + 32; a++) mem8[a] = SPR_SENTINEL;
  });
}

const brokenNoOp = () => {};
const brokenSprPerturb = (m) => { cand(m); m.mem8[SPR_BASE] = m.mem8[SPR_BASE] ^ 0xff; };
const brokenRecPerturb = (m) => { cand(m); m.mem8[REC_BASE + 2] = (m.mem8[REC_BASE + 2] + 1) & 0xff; };

test("EQUAL (crafted): loc_0a74 == oracle across both phases and directions", { skip }, () => {
  for (const phase of [0, 1]) {
    for (const dir of [0, 1]) {
      assert.equal(ramDiff(oracle, cand, entry(phase, dir)), null,
        `loc_0a74 RAM diverged (phase=${phase} dir=${dir})`);
    }
  }
  // non-vacuous: the oracle rewrites the sprite shadow away from the sentinel.
  assert.ok(ramDiff(oracle, brokenNoOp, entry(0, 0)), "vacuous: oracle changed no RAM");
  const c = entry(0, 0).clone(); c.routines = STUBS; oracle(c);
  let touched = false;
  for (let a = SPR_BASE; a < SPR_BASE + 32; a++) if (c.mem8[a] !== SPR_SENTINEL) { touched = true; break; }
  assert.ok(touched, "oracle did not write the sprite shadow");
  console.log("  EQUAL: loc_0a74 == oracle over 4 phase/direction combos; sprite shadow rewritten");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoOp, entry(0, 0)), "no-op twin escaped");
  assert.ok(ramDiff(oracle, brokenSprPerturb, entry(0, 0)), "sprite-perturb twin escaped");
  assert.ok(ramDiff(oracle, brokenRecPerturb, entry(1, 1)), "record-perturb twin escaped");
  console.log("  TEETH: no-op, sprite-cell perturb, record-cell perturb all caught");
});
