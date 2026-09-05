// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1a12 — crafted-entry equivalence vs the frozen per-object accumulator step.
 * The routine writes no RAM; its sole live-out is register B (the running total the caller threads across
 * objects). A post-attract seed is cloned; the object pointer (IX), its active byte, Y (H), X (L), flags
 * (C), the total (B) and the reference-X cell are poked, and a return address laid for the oracle's ret.
 * EQUAL asserts ramDiff==null (nothing written) AND register B on the hit / inactive / out-of-range paths;
 * bDiff compares B directly (ramDiff is blind to registers). Non-vacuous: the oracle really moves B on a
 * hit. Teeth: no-op and wrong-step twins escape on the hit path, a runs-when-inactive twin on the skip path.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff, STUBS } from "./_bootSetup.js";
import { loc_1a12 as cand } from "../loc_1a12.js";
import { loc_1a12 as oracle } from "../../translated/loc_1a12.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const IX = 0x4260; // object record base (work RAM)
const REF_X = 0x4202; // reference-X cell the delta is measured against
const START = 0x10; // seeded running total

// Active object, near row band (Y-128 < 52), delta == 0 -> index 0 -> table step 0x02 added to B.
const hit = () => craft((mem, m) => {
  m.push16(0x9999);
  mem[IX] = 0x01; // bit 0 set -> active
  m.regs.ix = IX; m.regs.h = 0x90; m.regs.l = 0x80; m.regs.c = 0x00; m.regs.b = START;
  mem[REF_X] = 0xc0; // delta = 0xc0 - 0x80 - 0x40 = 0
});
// Same but inactive (bit 0 clear): must leave B untouched.
const inactive = () => craft((mem, m) => {
  m.push16(0x9999);
  mem[IX] = 0x00;
  m.regs.ix = IX; m.regs.h = 0x90; m.regs.l = 0x80; m.regs.c = 0x00; m.regs.b = START;
  mem[REF_X] = 0xc0;
});
// Active but Y above range (Y < 128): must leave B untouched.
const lowY = () => craft((mem, m) => {
  m.push16(0x9999);
  mem[IX] = 0x01;
  m.regs.ix = IX; m.regs.h = 0x40; m.regs.l = 0x80; m.regs.c = 0x00; m.regs.b = START;
  mem[REF_X] = 0xc0;
});

// Live-out = RAM (must stay untouched) AND register B.
function bDiff(twin, e) {
  const ram = ramDiff(oracle, twin, e);
  if (ram) return `RAM ${ram}`;
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.b !== b.regs.b) return `B: ${a.regs.b} vs ${b.regs.b}`;
  return null;
}

test("EQUAL (crafted): loc_1a12 == oracle on hit, inactive and out-of-range", { skip }, () => {
  assert.equal(bDiff(cand, hit()), null, "the hit path diverged");
  assert.equal(bDiff(cand, inactive()), null, "the inactive path diverged");
  assert.equal(bDiff(cand, lowY()), null, "the out-of-range path diverged");

  // Non-vacuous: the oracle moves B on the hit, and leaves it alone when skipping.
  const a = hit(); oracle(a);
  assert.equal(a.regs.b, (START + 0x02) & 0xff, "control: hit added the step to B");
  const b = inactive(); oracle(b);
  assert.equal(b.regs.b, START, "control: inactive left B untouched");
  console.log(`  EQUAL: loc_1a12 == oracle on B, hit ${START}->${(START + 0x02) & 0xff}`);
});

test("TEETH: broken twins are caught on register B", { skip }, () => {
  const noOp = () => {};
  const wrongStep = (m) => { m.regs.b = (m.regs.b + 1) & 0xff; };            // adds 1, not the table's 2
  const runsWhenInactive = (m) => { m.regs.b = (m.regs.b + 5) & 0xff; };     // accumulates regardless of active bit
  assert.ok(bDiff(noOp, hit()), "no-op twin escaped");
  assert.ok(bDiff(wrongStep, hit()), "wrong-step twin escaped");
  assert.ok(bDiff(runsWhenInactive, inactive()), "runs-when-inactive twin escaped");
  console.log("  TEETH: no-op, wrong-step (hit) and runs-when-inactive (skip) all caught on B");
});
