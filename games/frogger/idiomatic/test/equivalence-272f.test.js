// SPDX-License-Identifier: GPL-3.0-only
/**
 * driveFlyPatrol — memory-equivalent to the frozen oracle at ROM 0x272F.
 * GATE: crafted-entry + attract-state capture. Plain attract does not dispatch the fly driver
 * within ENTRY_FRAMES, so realistic states are harvested via a high-frequency neighbour (0x0028)
 * and driven directly — valid because driveFlyPatrol takes no register live-in (it reads only work RAM).
 * The timer (0x833E) and direction/step byte (0x833D) are poked to reach every path: countdown
 * re-render, midpoint sprite (both directions), step advance forward/backward, endpoint wrap, and
 * hold. The routine pushes a transient return slot for a folded add helper, so the diff masks the
 * dead stack scratch below the entry SP. Live-out is memory-only; registers/SP are not compared.
 * Teeth: four broken twins (no-op, no lane-base add, midpoint drops the flip bit, wrap drops the
 * direction flip).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { driveFlyPatrol } from "../driveFlyPatrol.js";
import { loc_272f as oracle } from "../../translated/loc_272f.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const TIMER = 0x833e;
const DIR = 0x833d;
const XPOS = 0x8040;
const SPRITE = 0x8041;
const LANE = 0x811c;
const HARVEST = 0x0028;
const CAP = 40;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

let captured = null;
function capture() {
  if (captured) return captured;
  const entries = [];
  const real = TRANSLATED.get(HARVEST);
  const m = makeMachine(new Map([[HARVEST, (mm) => {
    if (entries.length < CAP) entries.push(mm.clone());
    return real(mm);
  }]]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  captured = entries;
  return captured;
}

// RAM diff that neutralizes the dead stack window in both dumps, so the first-diff-only helper
// reports the first REAL divergence rather than the transient push residue.
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

// A captured attract state with the driver cells poked to a chosen path.
function poked(base, kv) {
  const e = base.clone();
  for (const [a, v] of Object.entries(kv)) e.mem8[Number(a)] = v;
  return e;
}

// path pokes: table[18]=0 (endpoint), table[9]=1 (hold), table[1]=238 and table[19]=208 (>=2).
const PATHS = {
  "fwd advance -> writeX": { [TIMER]: 0, [DIR]: 0, [LANE]: 100 },
  "backward advance -> writeX": { [TIMER]: 0, [DIR]: 0x94, [LANE]: 100 },
  "fwd advance -> endpoint wrap": { [TIMER]: 0, [DIR]: 17, [SPRITE]: 0x99 },
  "backward advance -> wrap+flip": { [TIMER]: 0, [DIR]: 0x93, [SPRITE]: 0x99 },
  "fwd advance -> hold": { [TIMER]: 0, [DIR]: 8 },
  "midpoint forward sprite": { [TIMER]: 31, [DIR]: 5, [SPRITE]: 0x99 },
  "midpoint backward sprite": { [TIMER]: 31, [DIR]: 0x85, [SPRITE]: 0x99 },
  "countdown re-render X": { [TIMER]: 50, [DIR]: 5, [LANE]: 100 },
  "countdown re-render, dir bit set": { [TIMER]: 50, [DIR]: 0x85, [LANE]: 70 },
  "countdown re-render, index high edge": { [TIMER]: 50, [DIR]: 0x7f, [LANE]: 10 },
};

// broken twins.
function brokenNoOp() {}
function brokenNoLane(m) { // advances but writes X without the lane base
  const { mem8 } = m;
  if (mem8[TIMER] !== 0) return;
  mem8[DIR] = (mem8[DIR] + 1) & 0xff;
  const v = mem8[(0x279f + (mem8[DIR] & 0x7f)) & 0xffff];
  if (v === 0) { mem8[DIR] ^= 0x80; mem8[TIMER] = 60; mem8[SPRITE] = 30; return; }
  if (v === 1) { mem8[TIMER] = 60; return; }
  mem8[XPOS] = v & 0xff;
}
function brokenMidNoFlip(m) { // midpoint sprite drops the flip bit
  const { mem8 } = m;
  const timer = mem8[TIMER];
  if (timer === 0) return;
  const t = (timer - 1) & 0xff;
  mem8[TIMER] = t;
  if (t === 30) { mem8[SPRITE] = 33; return; }
  const idx = (mem8[DIR] & 0x7f) + 1;
  mem8[XPOS] = (mem8[(0x279f + idx) & 0xffff] + mem8[LANE]) & 0xff;
}
function brokenWrapNoDirFlip(m) { // endpoint wrap forgets to reverse the direction
  const { mem8 } = m;
  if (mem8[TIMER] !== 0) return;
  mem8[DIR] = (mem8[DIR] + 1) & 0xff;
  const v = mem8[(0x279f + (mem8[DIR] & 0x7f)) & 0xffff];
  if (v === 0) { mem8[TIMER] = 60; mem8[SPRITE] = 30; return; }
  if (v === 1) { mem8[TIMER] = 60; return; }
  mem8[XPOS] = (v + mem8[LANE]) & 0xff;
}

test("CAPTURE: driveFlyPatrol == oracle on real attract states (timer-0 advance path)", { skip }, () => {
  const entries = capture();
  assert.ok(entries.length > 0, "vacuous: no attract states harvested");
  for (const e of entries) assert.equal(ramDiff(driveFlyPatrol, e), null, "a captured machine diverged");
  console.log(`  CAPTURE: ${entries.length} states, driveFlyPatrol == oracle`);
});

test("PATHS: every branch equals the oracle", { skip }, () => {
  const base = capture()[0];
  for (const [name, kv] of Object.entries(PATHS)) {
    assert.equal(ramDiff(driveFlyPatrol, poked(base, kv)), null, `path diverged: ${name}`);
  }
  console.log(`  PATHS: ${Object.keys(PATHS).length} branches all equal`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  const base = capture()[0];
  assert.ok(ramDiff(brokenNoOp, poked(base, PATHS["fwd advance -> writeX"])), "the no-op twin escaped");
  assert.ok(ramDiff(brokenNoLane, poked(base, PATHS["fwd advance -> writeX"])), "the no-lane twin escaped");
  assert.ok(ramDiff(brokenMidNoFlip, poked(base, PATHS["midpoint backward sprite"])), "the mid-no-flip twin escaped");
  assert.ok(ramDiff(brokenWrapNoDirFlip, poked(base, PATHS["fwd advance -> endpoint wrap"])), "the wrap-no-dirflip twin escaped");
  console.log("  TEETH: no-op, no-lane, mid-no-flip, wrap-no-dirflip all caught");
});
