// SPDX-License-Identifier: GPL-3.0-only
/**
 * clearPlayerOneHomeBayGates — crafted-entry equivalence vs the frozen oracle at ROM 0x0534. Player-1
 * COLD board re-init: zero the player-1 slot byte 0x825c and the five primary-bank home-bay occupancy
 * gates 0x825e-0x8262, then tail DIRECTLY into the shared cold-start mid-entry 0x0567 (skipping the
 * player-2 alt-gate clears at 0x0557). Both sides route 0x0567 to the SAME idiomatic mid-entry so its
 * (large) contribution cancels, isolating 0x0534's own clears. The mid-entry's LDIR clears
 * 0x8100-0x825f, so primary gates 0x8260-0x8262 survive it — they are the differential signal; the
 * slot byte 0x825c and gates 0x825e-0x825f are additionally proven cleared. RAM compared, dead stack
 * scratch masked. Teeth: no-op, a twin skipping one surviving gate, a twin that omits the mid-entry
 * tail. Positive control: a seeded surviving gate 0x07 -> 0 and the tail really sets GAME_MODE = 3.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent, STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { buildRoutines } from "../../routines.js";
import { clearPlayerOneHomeBayGates as cand } from "../clearPlayerOneHomeBayGates.js";
import { coldStartClearPlayRamAndSetMode } from "../coldStartClearPlayRamAndSetMode.js";
import { loc_0534 as oracle } from "../../translated/loc_0534.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const SLOT = 0x825c;               // player-1 slot byte (cleared by 0x0534 AND the mid-entry LDIR)
const GATE0 = 0x825e;              // first primary gate; 0x825e-0x825f also fall in the mid-entry LDIR
const GATE_SURV = 0x8260;          // gates 0x8260-0x8262 survive the mid-entry -> differential signal
const GATE4 = 0x8262;
const GAME_MODE = 0x83d6, PLAY_FLAG = 0x83fe;

const balCall = (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; };
const noop = () => {};

// Both sides run the SAME idiomatic mid-entry at 0x0567 (so it cancels); the deep render/sound callees
// are stubbed balanced and the pace tail severed.
const MAP = buildRoutines();
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
  for (let i = 0; i < 5; i++) e.mem8[GATE0 + i] = 0x07;
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

test("EQUAL (crafted): clearPlayerOneHomeBayGates == oracle", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, craft()), null, "player-1 cold re-init diverged");

  const e = craft(); const a = e.clone(); a.routines = MAP; oracle(a);
  assert.equal(a.mem8[GATE_SURV], 0, "positive control: surviving gate 2 (0x07) -> 0");
  assert.equal(a.mem8[GATE4], 0, "positive control: surviving gate 4 (0x07) -> 0");
  assert.notEqual(e.mem8[GATE_SURV], 0, "positive control vacuous: the gate was already zero");
  assert.equal(a.mem8[SLOT], 0, "positive control: player-1 slot 0x09 -> 0");
  assert.equal(a.mem8[GAME_MODE], 0x03, "tail control: the mid-entry ran (GAME_MODE 0xff -> 3)");
  console.log(`  EQUAL: player-1 cold re-init; surviving gates 0x07->0, slot ${e.mem8[SLOT]}->0, mid-entry GAME_MODE->3`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const skipGate = (m) => { m.mem8[SLOT] = 0; for (let i = 0; i < 5; i++) m.mem8[GATE0 + i] = 0; m.mem8[GATE4] = 0x07; coldStartClearPlayRamAndSetMode(m); }; // one surviving gate left dirty
  const noTail = (m) => { m.mem8[SLOT] = 0; for (let i = 0; i < 5; i++) m.mem8[GATE0 + i] = 0; }; // omits the mid-entry tail
  assert.ok(ramDiff(oracle, noOp, craft()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, skipGate, craft()), "skip-gate twin escaped");
  assert.ok(ramDiff(oracle, noTail, craft()), "no-tail twin escaped (mid-entry transfer not exercised)");
  console.log("  TEETH: no-op, skip-gate, no-tail all caught");
});
