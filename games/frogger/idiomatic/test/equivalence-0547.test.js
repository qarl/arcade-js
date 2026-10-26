// SPDX-License-Identifier: GPL-3.0-only
/**
 * coldStartClearSlotGates — crafted-entry equivalence vs the frozen oracle at ROM 0x0547. Cold-start
 * init part one: zero the player-1 slot byte 0x825c and the five primary-bank home-bay occupancy gates
 * 0x825e-0x8262, then tail (part two coldStartClearAltSlotGates) into the shared mid-entry. Both sides
 * route 0x0557 to the SAME idiomatic part-two and 0x0567 to the SAME idiomatic mid-entry, so those
 * (large) contributions cancel, isolating 0x0547's own clears. The primary gates 0x8260-0x8262 survive
 * the mid-entry's LDIR (which stops at 0x825f), so they are the differential signal; the slot byte
 * 0x825c and gates 0x825e-0x825f are re-cleared by the mid-entry so they are proven via oracle control.
 * RAM compared, dead stack scratch masked. Teeth: no-op, a twin that leaves one surviving gate dirty, a
 * twin that omits the mid-entry tail. Positive control: a seeded surviving gate 0x07 -> 0, the slot byte
 * reaches 0, and the tail really sets GAME_MODE = 3.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { buildRoutines } from "../../routines.js";
import { coldStartClearSlotGates as cand } from "../coldStartClearSlotGates.js";
import { coldStartClearAltSlotGates } from "../coldStartClearAltSlotGates.js";
import { coldStartClearPlayRamAndSetMode } from "../coldStartClearPlayRamAndSetMode.js";
import { loc_0547 as oracle } from "../../translated/loc_0547.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const SLOT = 0x825c, GATE0 = 0x825e, GATE4 = 0x8262, SURV = 0x8262, GAME_MODE = 0x83d6, PLAY_FLAG = 0x83fe;

const balCall = (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; };
const noop = () => {};

// Both sides run the SAME idiomatic part-two (0x0557) and mid-entry (0x0567) so they cancel; the render
// callees are stubbed balanced and the pace tail severed.
const MAP = buildRoutines();
MAP.set(0x0557, coldStartClearAltSlotGates);
MAP.set(0x0567, coldStartClearPlayRamAndSetMode);
for (const a of [0x0038, 0x0b67, 0x0f69, 0x0b1f]) MAP.set(a, balCall);
MAP.set(0x0368, noop);

let seed = null;
function seedMachine() {
  if (seed) return seed;
  const m = makeMachine();
  m.runFrames(ENTRY_FRAMES);
  if (m.stoppedBy !== null) throw new Error(`the seed run stopped early: ${m.stoppedBy}`);
  seed = m.clone();
  return seed;
}

function craft(mut) {
  const e = seedMachine().clone();
  e.routines = MAP;
  e.regs.sp = STACK_SCRATCH.hi;
  e.mem8[PLAY_FLAG] = 0;
  e.mem8[SLOT] = 0x09;
  e.mem8[GATE0] = 0x07; e.mem8[GATE0 + 1] = 0x07; e.mem8[GATE0 + 2] = 0x07; e.mem8[GATE0 + 3] = 0x07; e.mem8[GATE4] = 0x07;
  e.mem8[GAME_MODE] = 0xff;
  if (mut) mut(e.mem8, e);
  return e;
}

function ramDiff(orc, cnd, entry) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const a = entry.clone(); a.routines = MAP; orc(a);
  const b = entry.clone(); b.routines = MAP; cnd(b);
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

test("EQUAL (crafted): coldStartClearSlotGates == oracle", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, craft()), null, "slot-gate clear diverged");

  const e = craft(); const a = e.clone(); a.routines = MAP; oracle(a);
  assert.equal(a.mem8[SURV], 0, "positive control: surviving primary gate 0x2 (0x07) -> 0");
  assert.notEqual(e.mem8[SURV], 0, "positive control vacuous: the gate was already zero");
  assert.equal(a.mem8[SLOT], 0, "positive control: player-1 slot 0x09 -> 0");
  assert.equal(a.mem8[GAME_MODE], 0x03, "tail control: the mid-entry ran (GAME_MODE 0xff -> 3)");
  console.log(`  EQUAL: slot-gate clear; surviving gate 0x07->0, slot ${e.mem8[SLOT]}->0, mid-entry GAME_MODE->3`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const skipGate = (m) => { m.mem8[SLOT] = 0; for (let i = 0; i < 5; i++) m.mem8[GATE0 + i] = 0; m.mem8[SURV] = 0x07; coldStartClearAltSlotGates(m); }; // one surviving primary gate left dirty
  const noTail = (m) => { m.mem8[SLOT] = 0; for (let i = 0; i < 5; i++) m.mem8[GATE0 + i] = 0; }; // omits the mid-entry tail
  assert.ok(ramDiff(oracle, noOp, craft()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, skipGate, craft()), "skip-gate twin escaped");
  assert.ok(ramDiff(oracle, noTail, craft()), "no-tail twin escaped (mid-entry transfer not exercised)");
  console.log("  TEETH: no-op, skip-gate, no-tail all caught");
});
