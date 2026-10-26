// SPDX-License-Identifier: GPL-3.0-only
/**
 * tickAttractCellFrameClock — memory-equivalent to the frozen oracle at ROM 0x0F3E.
 * The ROM routine is a double caller-skip; the idiomatic module DISSOLVES that into a plain boolean
 * (false = tick not elapsed, so the caller skips its remainder; true = elapsed, with the frame tile in
 * A), called directly by driveAttractDemoSequencer. So the gate compares the memory-equivalence contract
 * — RAM (stack masked), the boolean return, and the register live-out (the tile in A, the pointer in HL
 * on the normal exit where the caller reads them) — NOT SP/PC, which the JS boolean deliberately does not
 * reproduce. The oracle still manipulates the stack, so the crafted entry supplies the call frame it needs
 * (a saved-pointer slot it pushes itself, a synthetic arm return, and a caller-of-caller return for the
 * skip-out); the candidate ignores that frame. Teeth: five broken twins, each positive-controlled.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { tickAttractCellFrameClock } from "../tickAttractCellFrameClock.js";
import { loc_0f3e as oracle } from "../../translated/loc_0f3e.js";
import { u8 } from "../../../../core/int.js";


const FRAME_TIMER = 0x83bd;
const FRAME_INDEX = 0x83be;
const TILE_TABLE = 0x2e1b;

const STACK_TOP = 0x8800;
const ARM_RET = 0x0f01;
const CALLER_RET = 0x012e;
const CELL_PTR = 0x8040;

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

// The oracle's stack frame: a synthetic arm return the normal exit rets to, and (for the skip-out) a
// caller-of-caller return below it. The saved-pointer slot is pushed by the oracle itself. The dissolved
// candidate is a direct boolean and ignores this frame.
function entry({ path, timer, index }) {
  const e = seedMachine().clone();
  e.regs.sp = STACK_TOP;
  if (path === "skip") e.push16(CALLER_RET);
  e.push16(ARM_RET);
  e.regs.hl = CELL_PTR;
  e.mem8[FRAME_TIMER] = timer;
  if (index !== undefined) e.mem8[FRAME_INDEX] = index;
  return e;
}

// Run oracle and candidate on independent clones; return the memory-equivalence contract divergences:
// RAM (stack masked), the boolean return, and — on the normal exit only — the register live-out A and HL.
// SP/PC are not part of the dissolved contract.
function contractDiffs(e, fn, regLive) {
  const dead = deadStackBelow(STACK_SCRATCH, e.regs.sp);
  const a = e.clone();
  const b = e.clone();
  const ra = oracle(a);
  const rb = fn(b);
  const out = [];
  const A = a.dumpState(), B = b.dumpState();
  for (let off = 0; off < A.length; off++) {
    if (A[off] === B[off]) continue;
    const addr = a.stateOffsetToAddr(off);
    if (dead(addr)) continue; // mask dead stack scratch
    out.push(`RAM 0x${(addr ?? 0).toString(16)}: ${A[off]} vs ${B[off]}`);
    break;
  }
  if (ra !== rb) out.push(`ret: ${ra} vs ${rb}`);
  if (regLive) {
    if (a.regs.a !== b.regs.a) out.push(`A: ${a.regs.a} vs ${b.regs.a}`);
    if (a.regs.hl !== b.regs.hl) out.push(`HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`);
  }
  return out;
}

// Broken twins: the dissolved boolean form with a single knobbed defect each.
function broken(bug) {
  return (m) => {
    const { regs, mem8 } = m;
    const timer = u8(mem8[FRAME_TIMER] - 1);
    mem8[FRAME_TIMER] = timer;
    if (timer !== 0) return bug === "wrongReturn"; // wrongReturn reports true where not-elapsed owes false
    mem8[FRAME_TIMER] = bug === "wrongTimerReload" ? 7 : 8;
    let index = bug === "offByOneIndex" ? mem8[FRAME_INDEX] : u8(mem8[FRAME_INDEX] - 1);
    if (index === 0) index = bug === "wrongWrapReload" ? 3 : 4;
    mem8[FRAME_INDEX] = index;
    const base = bug === "wrongTileBase" ? TILE_TABLE + 1 : TILE_TABLE;
    regs.a = mem8[(base & 0xff00) | u8((base & 0xff) + index)];
    return true;
  };
}
const brokenNoOp = () => undefined;

test("VACUITY: the crafted frame reaches both of the oracle's exits", { skip }, () => {
  assert.equal(oracle(entry({ path: "skip", timer: 3 })), false, "not-elapsed returns false");
  const on = entry({ path: "normal", timer: 1, index: 4 });
  assert.equal(oracle(on), true, "elapsed returns true");
  assert.equal(on.mem8[FRAME_TIMER], 8, "timer reloaded");
  assert.equal(on.mem8[FRAME_INDEX], 3, "frame cursor stepped down");
});

test("EQUAL: skip-out entries — cand == oracle (returns false)", { skip }, () => {
  const entries = [entry({ path: "skip", timer: 3 }), entry({ path: "skip", timer: 2 })];
  for (const e of entries) {
    const d = contractDiffs(e, tickAttractCellFrameClock, false);
    assert.deepEqual(d, [], `skip-out diverged: ${d.join("; ")}`);
  }
  console.log(`  EQUAL: ${entries.length} skip-out entries, cand == oracle`);
});

test("EQUAL: normal entries incl. the cursor wrap — cand == oracle (returns the tile)", { skip }, () => {
  const entries = [
    entry({ path: "normal", timer: 1, index: 4 }), // steps 4 -> 3
    entry({ path: "normal", timer: 1, index: 2 }), // steps 2 -> 1
    entry({ path: "normal", timer: 1, index: 1 }), // steps 1 -> 0 -> wrap to 4
  ];
  for (const e of entries) {
    const d = contractDiffs(e, tickAttractCellFrameClock, true);
    assert.deepEqual(d, [], `normal path diverged: ${d.join("; ")}`);
  }
  assert.ok(
    contractDiffs(entry({ path: "normal", timer: 1, index: 4 }), brokenNoOp, true).length > 0,
    "vacuous: a no-op twin was not caught on the normal path",
  );
  console.log(`  EQUAL: ${entries.length} normal entries (incl. wrap), cand == oracle`);
});

test("TEETH: five broken twins caught, each positive-controlled", { skip }, () => {
  const cases = [
    ["wrongTimerReload", entry({ path: "normal", timer: 1, index: 4 }), true],
    ["wrongWrapReload", entry({ path: "normal", timer: 1, index: 1 }), true],
    ["wrongTileBase", entry({ path: "normal", timer: 1, index: 4 }), true],
    ["offByOneIndex", entry({ path: "normal", timer: 1, index: 4 }), true],
    ["wrongReturn", entry({ path: "skip", timer: 3 }), false],
  ];
  const bit = [];
  for (const [bug, e, regLive] of cases) {
    const real = contractDiffs(e, tickAttractCellFrameClock, regLive);
    assert.deepEqual(real, [], `positive control failed: real module diverged on the ${bug} entry: ${real.join("; ")}`);
    const mut = contractDiffs(e, broken(bug), regLive);
    assert.ok(mut.length > 0, `the ${bug} twin escaped`);
    bit.push(`${bug} [${mut.join(", ")}]`);
  }
  console.log(`  TEETH: ${bit.join("  |  ")}`);
});
