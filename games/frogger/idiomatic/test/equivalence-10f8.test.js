// SPDX-License-Identifier: GPL-3.0-only
/**
 * renderFrogAnimArm6 — memory-equivalent to the frozen oracle at ROM 0x10F8.
 * GATE: crafted-entry. Attract never dispatches this frog-anim arm (probe: 0 over ENTRY_FRAMES), so
 * coherent post-boot states are captured at the per-frame score redraw (0x0b1f) and replayed through
 * both sides. The routine reads all its inputs from memory (no register live-in), so any such state
 * is a valid entry; each is nudged so the arm's sprite triple renders a small, bounded, observable
 * block (the anim index is parked one below its wrap so only this arm draws). The rewrite enters the
 * lifted render loop with a direct call where the oracle uses a Z80 call to 0x0ff1, so the only
 * divergence is the seam's transient pushed return address in dead stack scratch below the entry SP,
 * excluded from the RAM compare. Live-out is memory-only, so RAM is compared and registers/SP are not.
 * Teeth: three broken twins (no-op, wrong plot cursor, skip the render call).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { renderFrogAnimArm6 } from "../renderFrogAnimArm6.js";
import { loc_10f8 as oracle } from "../../translated/loc_10f8.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const NEIGHBOUR = 0x0b1f; // per-frame score redraw; a source of coherent post-boot states
const ANIM_INDEX = 0x8000; // parked one below the wrap so only this arm renders
const SPRITE_TRIPLE = 0x8282;
const CAP = 200;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

let captured = null;
function captureNeighbours() {
  if (captured) return captured;
  const entries = [];
  const real = TRANSLATED.get(NEIGHBOUR);
  const m = makeMachine(new Map([[NEIGHBOUR, (mm) => {
    if (entries.length < CAP) entries.push(mm.clone());
    return real(mm);
  }]]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.ok(entries.length > 0, "vacuous: the neighbour was never dispatched, no state to replay");
  captured = entries;
  return captured;
}

// A coherent state nudged so the arm draws a small bounded block and the anim index wraps right after.
function craft(machine) {
  const c = machine.clone();
  c.mem8[ANIM_INDEX] = 0x0a;
  c.mem8[SPRITE_TRIPLE] = 2;
  c.mem8[SPRITE_TRIPLE + 1] = 2;
  c.mem8[SPRITE_TRIPLE + 2] = 2;
  return c;
}

// null == RAM-equivalent. Memory-only live-out: compare RAM, not registers or SP.
function ramDiff(cand, machine) {
  const dead = deadStackBelow(STACK_SCRATCH, machine.regs.sp);
  const a = machine.clone(); oracle(a);
  const b = machine.clone(); cand(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), dead);
  return d ? `0x${(d.addr ?? 0).toString(16)}: ${d.a} vs ${d.b}` : null;
}

// broken twins the RAM diff must catch.
function brokenNoOp() {}
function brokenWrongCursor(m) {
  const { regs, mem8, mem16 } = m;
  regs.a = mem8[0x8282]; regs.b = mem8[0x8283]; regs.c = mem8[0x8284];
  regs.hl = mem16[0x13f9]; regs.de = 0x149f;
  regs.ix = 0x8137; regs.iy = 0x8137; // BUG: cursor off by one
  mem8[0x81b1] = regs.a; mem16[0x8001] = regs.de;
  return m.call(0x0ff1);
}
function brokenSkipRender(m) {
  const { regs, mem8, mem16 } = m;
  regs.a = mem8[0x8282]; regs.b = mem8[0x8283]; regs.c = mem8[0x8284];
  regs.hl = mem16[0x13f9]; regs.de = 0x149f; regs.ix = 0x8136; regs.iy = 0x8136;
  mem8[0x81b1] = regs.a; mem16[0x8001] = regs.de;
  // BUG: never enters the render loop
}

test("REAL: renderFrogAnimArm6 == oracle on every captured, arm-rendered state", { skip }, () => {
  const entries = captureNeighbours().map(craft);
  for (const e of entries) assert.equal(ramDiff(renderFrogAnimArm6, e), null, "a captured machine diverged");
  assert.ok(ramDiff(brokenNoOp, entries[0]), "vacuous: oracle wrote nothing on the sample entry");
  console.log(`  REAL: ${entries.length} rendered arm states, renderFrogAnimArm6 == oracle`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  const e = craft(captureNeighbours()[0]);
  assert.ok(ramDiff(brokenNoOp, e), "the no-op twin escaped");
  assert.ok(ramDiff(brokenWrongCursor, e), "the wrong-cursor twin escaped");
  assert.ok(ramDiff(brokenSkipRender, e), "the skip-render twin escaped");
  console.log("  TEETH: no-op, wrong-cursor, skip-render all caught");
});
