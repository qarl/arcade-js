// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceAttractDemoFrogHop — memory-equivalent to the frozen oracle at ROM 0x23B7.
 * GATE: crafted-entry. Attract never dispatches this in-play hop continuation (probe: 0 over ENTRY_FRAMES),
 * since its caller only runs in active play; a coherent post-boot state captured at the per-frame
 * score redraw (0x0b1f) is cloned and the four hop-active flags poked. The clear entry (all flags
 * 0, mirrors pre-set nonzero) exercises the four mirror-clear writes; each direction entry sets one flag so
 * the routine hands off to that direction's advance handler (0x1bba/0x1c0d/0x1c76/0x1cd5), with the frog X/Y
 * cursors armed and run on a fresh clone: the oracle reaches the frozen handlers via m.call, the rewrite
 * calls the lifted handlers directly. Live-out is memory-only, so RAM is compared and registers/SP are
 * not; the dead stack scratch below the entry SP is masked, since the lifted handlers no longer model the
 * oracle's internal return-address push (e.g. the UP-hop slot-cursor call). Teeth: three broken twins
 * (no-op, wrong mirror value, skip the DOWN advance call).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { advanceAttractDemoFrogHop } from "../advanceAttractDemoFrogHop.js";
import { loc_23b7 as oracle } from "../../translated/loc_23b7.js";

const NEIGHBOUR = 0x0b1f;
const ACTIVE_FLAGS = 0x8248; // four hop-active flags 0x8248..0x824b
const MIRRORS = 0x824c;   // four direction arrival mirrors 0x824c..0x824f
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

let seed = null;
function seedState() {
  if (seed) return seed;
  const real = TRANSLATED.get(NEIGHBOUR);
  const m = makeMachine(new Map([[NEIGHBOUR, (mm) => {
    if (!seed) seed = mm.clone();
    return real(mm);
  }]]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.ok(seed, "vacuous: the neighbour was never dispatched, no state to replay");
  return seed;
}

// The clear entry: all active flags 0, all mirrors nonzero so each mirror-clear write shows.
function craftClear() {
  const c = seedState().clone();
  for (let i = 0; i < 4; i++) { c.mem8[ACTIVE_FLAGS + i] = 0; c.mem8[MIRRORS + i] = 0x77; }
  return c;
}

// A direction entry: fire one direction (its mirror 0 so the handler proceeds), the rest clear; give the
// handlers a coherent hop counter/delta so they do observable work.
function craftDirection(dir) {
  const c = seedState().clone();
  for (let i = 0; i < 4; i++) { c.mem8[ACTIVE_FLAGS + i] = 0; c.mem8[MIRRORS + i] = 0; }
  c.mem8[ACTIVE_FLAGS + dir] = 1;
  for (let i = 0; i < 4; i++) { c.mem8[0x8250 + i] = 2; c.mem8[0x8254 + i] = 1; }
  return c;
}


// null == RAM-equivalent. Memory-only live-out: compare RAM, mask the dead stack scratch.
function ramDiff(cand, machine) {
  const dead = deadStackBelow(STACK_SCRATCH, machine.regs.sp);
  const a = machine.clone(); oracle(a);
  const b = machine.clone(); cand(b);
  const A = a.dumpState(), B = b.dumpState();
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    if (A[i] === B[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return `0x${(addr ?? 0).toString(16)}: ${A[i]} vs ${B[i]}`;
  }
  return null;
}

// broken twins the RAM diff must catch.
function brokenNoOp() {}
function brokenWrongMirror(m) {
  const { regs, mem8 } = m;
  regs.hl = 0x8044; regs.de = 0x8047;
  regs.a = mem8[0x8248]; if (regs.a !== 0) return m.call(0x1bba); mem8[0x824c] = 1; // BUG: not 0
  regs.a = mem8[0x8249]; if (regs.a !== 0) return m.call(0x1c0d); mem8[0x824d] = 1;
  regs.a = mem8[0x824a]; if (regs.a !== 0) return m.call(0x1c76); mem8[0x824e] = 1;
  regs.a = mem8[0x824b]; if (regs.a !== 0) return m.call(0x1cd5); mem8[0x824f] = 1;
}
function brokenSkipAdvance(m) {
  const { regs, mem8 } = m;
  regs.hl = 0x8044; regs.de = 0x8047;
  regs.a = mem8[0x8248]; if (regs.a !== 0) return; mem8[0x824c] = 0; // BUG: DOWN never advances
  regs.a = mem8[0x8249]; if (regs.a !== 0) return m.call(0x1c0d); mem8[0x824d] = 0;
  regs.a = mem8[0x824a]; if (regs.a !== 0) return m.call(0x1c76); mem8[0x824e] = 0;
  regs.a = mem8[0x824b]; if (regs.a !== 0) return m.call(0x1cd5); mem8[0x824f] = 0;
}

test("EQUAL (crafted): advanceAttractDemoFrogHop == oracle on the clear path and each direction arm", { skip }, () => {
  assert.equal(ramDiff(advanceAttractDemoFrogHop, craftClear()), null, "the clear path diverged");
  for (let d = 0; d < 4; d++) assert.equal(ramDiff(advanceAttractDemoFrogHop, craftDirection(d)), null, `direction ${d} diverged`);
  assert.ok(ramDiff(brokenNoOp, craftClear()), "vacuous: oracle wrote nothing on the clear path");
  assert.ok(ramDiff(brokenNoOp, craftDirection(0)), "vacuous: oracle wrote nothing on the DOWN arm");
  console.log("  EQUAL: clear path + four direction advance arms, advanceAttractDemoFrogHop == oracle");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(brokenNoOp, craftClear()), "the no-op twin escaped");
  assert.ok(ramDiff(brokenWrongMirror, craftClear()), "the wrong-mirror twin escaped");
  assert.ok(ramDiff(brokenSkipAdvance, craftDirection(0)), "the skip-advance twin escaped");
  console.log("  TEETH: no-op, wrong-mirror, skip-advance all caught");
});
