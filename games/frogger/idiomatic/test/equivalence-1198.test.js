// SPDX-License-Identifier: GPL-3.0-only
/**
 * computeVramColumnIndex — register-C-equivalent to the frozen oracle at ROM 0x1198.
 * GATE: crafted-entry. Attract never dispatches this coord/column compute (probe: 0 dispatches over
 * ENTRY_FRAMES), so a post-boot attract machine is cloned and its HL pointer and incoming carry
 * poked to drive it. The routine writes no RAM and the caller saves/restores HL/DE/BC around the
 * call, consuming only C afterwards — so the live-out is register C alone. RAM is still compared
 * (both sides must leave it untouched) and only C among the registers; the oracle clobbers HL/DE/B/
 * A/F, which are dead, so comparing them would false-fail. Both HL and both carry states are swept.
 * Teeth: three broken twins, each moving C.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { computeVramColumnIndex } from "../computeVramColumnIndex.js";
import { loc_1198 as oracle } from "../../translated/loc_1198.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const VRAM_BASE = 0xa800;
const CARRY_BIT = 0x01;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

let seed = null;
function seedMachine() {
  if (seed) return seed;
  const m = makeMachine();
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the seed run stopped early: ${m.stoppedBy}`);
  seed = m.clone();
  return seed;
}

function entryWith(hl, carry) {
  const e = seedMachine().clone();
  e.regs.hl = hl;
  e.regs.f = carry ? (e.regs.f | CARRY_BIT) : (e.regs.f & ~CARRY_BIT);
  return e;
}

// null == equivalent on the live-out: RAM untouched (dead stack window neutralized) AND register C.
function unitDiff(cand, machine) {
  const dead = deadStackBelow(STACK_SCRATCH, machine.regs.sp);
  const a = machine.clone(); oracle(a);
  const b = machine.clone(); cand(b);
  const da = a.dumpState(), db = b.dumpState();
  for (let off = 0; off < db.length; off++) {
    const addr = a.stateOffsetToAddr(off);
    if (dead(addr)) db[off] = da[off];
  }
  const ram = firstStateDiff(da, db, (o) => a.stateOffsetToAddr(o));
  if (ram) return `RAM 0x${(ram.addr ?? 0).toString(16)}: ${ram.a} vs ${ram.b}`;
  if (a.regs.c !== b.regs.c) return `C: ${a.regs.c} vs ${b.regs.c}`;
  return null;
}

const HLS = [0xa800, 0xa801, 0xa806, 0xa87e, 0xabff, 0xac37, 0xa9c3, 0xa000, 0xffff, 0x0000];
const rotateLeft = (v) => ((v << 1) | (v >> 7)) & 0xff;

// A correct reference the twins deviate from (used to build the wrong-value / carry twins).
function compute(hl, carry) {
  const off = (hl - VRAM_BASE - (carry ? 1 : 0)) & 0xffff;
  let low = off & 0xe0, high = (off >> 8) & 0xff, acc = 0;
  for (let p = 0; p < 6; p++) {
    acc = rotateLeft(acc);
    if (high & 0x04) acc = (acc + 1) & 0xff;
    const c = (low >> 7) & 1;
    low = ((low << 1) | c) & 0xff;
    high = ((high << 1) | c) & 0xff;
  }
  return { acc, low, high };
}

// broken twins, each leaving a wrong C.
function brokenNoOp() {}
function brokenNoFinalRotate(m) {
  const { regs } = m;
  regs.c = compute(regs.hl, regs.fC).acc; // BUG: omits the three trailing rotates
}
function brokenIgnoreCarry(m) {
  const { regs } = m;
  const off = (regs.hl - VRAM_BASE) & 0xffff; // BUG: drops the incoming borrow
  let low = off & 0xe0, high = (off >> 8) & 0xff, acc = 0;
  for (let p = 0; p < 6; p++) {
    acc = rotateLeft(acc);
    if (high & 0x04) acc = (acc + 1) & 0xff;
    const c = (low >> 7) & 1;
    low = ((low << 1) | c) & 0xff;
    high = ((high << 1) | c) & 0xff;
  }
  for (let i = 0; i < 3; i++) acc = rotateLeft(acc);
  regs.c = acc;
}

test("EQUAL (crafted): computeVramColumnIndex == oracle on register C over HL x carry", { skip }, () => {
  let n = 0;
  for (const hl of HLS) for (const carry of [false, true]) {
    assert.equal(unitDiff(computeVramColumnIndex, entryWith(hl, carry)), null, `diverged at hl=0x${hl.toString(16)} carry=${carry}`);
    n++;
  }
  // non-vacuous: the no-op twin diverges, proving the oracle actually sets C on a sample entry.
  assert.ok(unitDiff(brokenNoOp, entryWith(0xa87e, false)), "vacuous: oracle left C unchanged");
  console.log(`  EQUAL: ${n} crafted (HL,carry) entries, computeVramColumnIndex == oracle on C`);
});

test("TEETH: broken twins are caught on register C", { skip }, () => {
  // pick an entry where each twin actually moves C (swept below to be sure at least one catches).
  const caughtOn = (twin) => HLS.some((hl) => [false, true].some((carry) => unitDiff(twin, entryWith(hl, carry))));
  assert.ok(caughtOn(brokenNoOp), "the no-op twin escaped");
  assert.ok(caughtOn(brokenNoFinalRotate), "the missing-final-rotate twin escaped");
  assert.ok(caughtOn(brokenIgnoreCarry), "the ignore-incoming-carry twin escaped");
  console.log("  TEETH: no-op, missing-final-rotate, ignore-incoming-carry all caught");
});
