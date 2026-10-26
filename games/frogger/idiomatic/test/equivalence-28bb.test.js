// SPDX-License-Identifier: GPL-3.0-only
/**
 * mountOrKillFrogOnTwoPairFigure — memory-equivalent to the frozen oracle at ROM 0x28BB.
 * GATE: crafted-entry. Attract NEVER dispatches this frog-vs-diver test (probe: 0 dispatches over
 * ENTRY_FRAMES; it runs only from the in-play collision orchestrator 0x1a55), so a post-boot attract
 * clone gets the arm bit (0x8150), dive phase (0x83b7), frog Y/X (0x8047/0x8044) and diver X (0x8101)
 * poked to drive each path: the two gate returns, the Y-band and X-window rejects, the outer-overlap
 * ride, and the inner-overlap kill. Both sides run on fresh clones so the real frog-kill callee 0x12d0
 * executes identically and its side effects are part of the compared live-out. The ride VRAM quad is
 * pre-dirtied. The one caller makes another call immediately, so LIVE-OUT is memory-only: RAM is
 * compared, registers/SP are not. The kill path's dissolved balanced trampoline is excluded from the RAM
 * diff (stack scratch below the entry SP, detailed below). Teeth: three broken twins.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { mountOrKillFrogOnTwoPairFigure } from "../mountOrKillFrogOnTwoPairFigure.js";
import { loc_28bb as oracle } from "../../translated/loc_28bb.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const ARM = 0x8150, PHASE = 0x83b7;
const FROG_Y = 0x8047, FROG_X = 0x8044, DIVER_X = 0x8101;
const MOUNT_FLAG = 0x8004;
const QUAD = 0xa846; // top-left of the 2x2 mounted-frog tile quad (+1, +32, +33)
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

// A post-boot clone with the collision inputs poked; the ride VRAM quad optionally pre-dirtied.
function craft({ arm, phase, y, fx, dx, dirty }) {
  const e = seedMachine().clone();
  e.mem8[ARM] = arm; e.mem8[PHASE] = phase;
  e.mem8[FROG_Y] = y; e.mem8[FROG_X] = fx; e.mem8[DIVER_X] = dx;
  e.mem8[MOUNT_FLAG] = 0;
  if (dirty) for (const off of [0, 1, 32, 33]) e.mem8[(QUAD + off) & 0xffff] = 0xee;
  return e;
}

// null == RAM-equivalent. Memory-only live-out: compare RAM, not registers or SP. The kill path
// dissolves the ROM's balanced push16(0x28ee)/call(0x12d0) trampoline into a direct killFrogAtLane
// call, so the candidate no longer writes the sentinel into the dead stack scratch below the entry SP;
// exclude that region — the same class the pixel manifest's stateExclude.stack drops.
function ramDiff(cand, machine) {
  const dead = deadStackBelow(STACK_SCRATCH, machine.regs.sp);
  const a = machine.clone(); oracle(a);
  const b = machine.clone(); cand(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), dead);
  return d ? `0x${(d.addr ?? 0).toString(16)}: ${d.a} vs ${d.b}` : null;
}

const RIDE = { arm: 1, phase: 2, y: 0x30, fx: 0x30, dx: 0x48, dirty: 1 };
const KILL = { arm: 1, phase: 2, y: 0x30, fx: 0x30, dx: 0x30 };
const PATHS = [
  ["arm bit0 clear -> ret", { arm: 0, phase: 2, y: 0x30, fx: 0x30, dx: 0x48 }],
  ["phase < 2 -> ret", { arm: 1, phase: 1, y: 0x30, fx: 0x30, dx: 0x48 }],
  ["frog Y below band -> ret", { arm: 1, phase: 2, y: 0x10, fx: 0x30, dx: 0x48 }],
  ["frog Y above band -> ret", { arm: 1, phase: 2, y: 0x40, fx: 0x30, dx: 0x48 }],
  ["diver right of frog -> ret", { arm: 1, phase: 2, y: 0x30, fx: 0x30, dx: 0x80 }],
  ["ride (outer overlap)", RIDE],
  ["kill (inner overlap, calls 0x12d0)", KILL],
];

// broken twins.
function brokenNoOp() {}
function brokenWrongTile(m) { // BUG: wrong top-left mounted-frog tile
  const { mem8 } = m;
  mem8[MOUNT_FLAG] = 1;
  mem8[QUAD] = 0x78; mem8[(QUAD + 1) & 0xffff] = 0x69;
  mem8[(QUAD + 32) & 0xffff] = 0x6a; mem8[(QUAD + 33) & 0xffff] = 0x6b;
}
function brokenAlwaysRide(m) { // BUG: rides instead of the kill tail (wrong branch)
  const { mem8 } = m;
  mem8[MOUNT_FLAG] = 1;
  mem8[QUAD] = 0x68; mem8[(QUAD + 1) & 0xffff] = 0x69;
  mem8[(QUAD + 32) & 0xffff] = 0x6a; mem8[(QUAD + 33) & 0xffff] = 0x6b;
}

test("EQUAL (crafted): mountOrKillFrogOnTwoPairFigure == oracle on every path", { skip }, () => {
  const entries = PATHS.map(([, cfg]) => craft(cfg));
  assert.ok(entries.length > 0, "vacuous: no crafted entries");
  for (let i = 0; i < entries.length; i++) assert.equal(ramDiff(mountOrKillFrogOnTwoPairFigure, entries[i]), null, `diverged: ${PATHS[i][0]}`);
  assert.ok(ramDiff(brokenNoOp, craft(RIDE)), "vacuous: oracle wrote nothing on the ride path");
  assert.ok(ramDiff(brokenNoOp, craft(KILL)), "vacuous: the kill callee 0x12d0 wrote nothing");
  console.log(`  EQUAL: ${entries.length} crafted paths, mountOrKillFrogOnTwoPairFigure == oracle`);
});

test("TEETH: broken twins are caught across ride, tile, and branch", { skip }, () => {
  assert.ok(ramDiff(brokenNoOp, craft(RIDE)), "the no-op twin escaped the ride path");
  assert.ok(ramDiff(brokenWrongTile, craft(RIDE)), "the wrong-tile twin escaped");
  assert.ok(ramDiff(brokenNoOp, craft(KILL)), "the no-op twin escaped the kill path (skipped call)");
  assert.ok(ramDiff(brokenAlwaysRide, craft(KILL)), "the always-ride twin escaped the kill path");
  console.log("  TEETH: no-op (ride+kill), wrong-tile, always-ride all caught");
});
