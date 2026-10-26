// SPDX-License-Identifier: GPL-3.0-only
/**
 * blitFrogAnimColumnOnTrigger — memory-equivalent to the frozen oracle at ROM 0x0F8C.
 * GATE: crafted-entry. Attract never dispatches this frog-anim pre-helper (probe: 0 dispatches over
 * ENTRY_FRAMES), so a post-boot attract machine is cloned and its trigger cell (0x8118) poked to
 * drive the blit path (several non-zero triggers) and the clear-trigger early-return (trigger 0).
 * The 8-row destination column is pre-cleared so the blit is observable. The routine reads no live
 * register and its live-out is memory-only, so registers/SP are not compared — but the oracle's
 * internal push/pop dirties the dead stack window below the entry SP, which is neutralized in both
 * dumps before the first-difference scan so a stack ghost cannot mask a real VRAM divergence.
 * Teeth: three broken RAM twins.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { blitFrogAnimColumnOnTrigger } from "../blitFrogAnimColumnOnTrigger.js";
import { loc_0f8c as oracle } from "../../translated/loc_0f8c.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const TRIGGER = 0x8118;
const DEST_BASE = 0xa806;
const SRC_BASE = 0x1413;
const ROWS = 8;
const ROW_STRIDE = 32;
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

// A post-boot machine with a chosen trigger and a cleared destination column, so a blit is visible.
function entryWithTrigger(trigger) {
  const e = seedMachine().clone();
  e.mem8[TRIGGER] = trigger;
  for (let row = 0; row < ROWS; row++) {
    const d = (DEST_BASE + row * ROW_STRIDE) & 0xffff;
    e.mem8[d] = 0;
    e.mem8[(d + 1) & 0xffff] = 0;
  }
  return e;
}

// null == RAM-equivalent. The dead stack window is equalized in both dumps FIRST, because
// firstStateDiff returns only the first divergence and the oracle's push/pop lives there.
function ramDiff(cand, machine) {
  const dead = deadStackBelow(STACK_SCRATCH, machine.regs.sp);
  const a = machine.clone(); oracle(a);
  const b = machine.clone(); cand(b);
  const da = a.dumpState(), db = b.dumpState();
  for (let off = 0; off < db.length; off++) {
    const addr = a.stateOffsetToAddr(off);
    if (dead(addr)) db[off] = da[off];
  }
  const d = firstStateDiff(da, db, (o) => a.stateOffsetToAddr(o));
  return d ? `0x${(d.addr ?? 0).toString(16)}: ${d.a} vs ${d.b}` : null;
}

const TRIGGERS = [1, 0xff, 0x80, 0]; // three blit paths + the clear-trigger early return

// broken twins, each leaving wrong RAM the diff must catch.
function brokenNoOp() {}
function brokenWrongTile(m) {
  const { mem, mem8 } = m;
  if (mem8[TRIGGER] === 0) return;
  for (let row = 0; row < ROWS; row++) {
    const d = (DEST_BASE + row * ROW_STRIDE) & 0xffff;
    const s = (SRC_BASE + row * 2) & 0xffff;
    mem8[d] = (mem.read8(s) + 1) & 0xff; // BUG: corrupts the first tile byte
    mem8[(d + 1) & 0xffff] = mem.read8((s + 1) & 0xffff);
  }
  mem8[TRIGGER] = 0;
}
function brokenNoClear(m) {
  const { mem, mem8 } = m;
  if (mem8[TRIGGER] === 0) return;
  for (let row = 0; row < ROWS; row++) {
    const d = (DEST_BASE + row * ROW_STRIDE) & 0xffff;
    const s = (SRC_BASE + row * 2) & 0xffff;
    mem8[d] = mem.read8(s);
    mem8[(d + 1) & 0xffff] = mem.read8((s + 1) & 0xffff);
  }
  // BUG: never clears the trigger, so the blit would fire again
}

test("EQUAL (crafted): blitFrogAnimColumnOnTrigger == oracle on every trigger path", { skip }, () => {
  const entries = TRIGGERS.map(entryWithTrigger);
  assert.ok(entries.length > 0, "vacuous: no crafted entries");
  for (const e of entries) assert.equal(ramDiff(blitFrogAnimColumnOnTrigger, e), null, "a crafted entry diverged");
  // non-vacuous: the no-op twin diverging proves the oracle actually writes on a blit entry.
  assert.ok(ramDiff(brokenNoOp, entryWithTrigger(1)), "vacuous: oracle wrote nothing");
  console.log(`  EQUAL: ${entries.length} crafted trigger paths, blitFrogAnimColumnOnTrigger == oracle`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  const e = entryWithTrigger(1); // a blit path: exercises the full 8-row copy and the clear
  assert.ok(ramDiff(brokenNoOp, e), "the no-op twin escaped");
  assert.ok(ramDiff(brokenWrongTile, e), "the wrong-tile twin escaped");
  assert.ok(ramDiff(brokenNoClear, e), "the no-clear-trigger twin escaped");
  console.log("  TEETH: no-op, wrong-tile, no-clear-trigger all caught");
});
