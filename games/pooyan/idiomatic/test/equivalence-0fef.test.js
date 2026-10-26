// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for rearmMainLoopFrame (Pooyan) — the sub-state-0 main-loop handler.
 *
 * Reloads STAGE_COUNTDOWN := 0x0f; runs the integrity walker when ROUND_COUNTER bit 2 is set;
 * re-arms HUNTER_SPAWN_FLIP_FLAG / LAUNCH_ARMED_FLAG / MAINLOOP_SUBSTATE_SELECTOR to 1; enqueues
 * the frame-setup sound run; then reads the pending sub-state byte (TAMPER_STRIKES_SIG): zero
 * returns, nonzero latches it into the selector and runs the ten-step worker chain. The module
 * imports the idiomatic siblings; the oracle drives the same registry the Machine(ROM) builds,
 * so both sides execute identical implementations over one shared clone.
 *
 * The walker gate (0x89fb) is seated 0 so the walker takes its normal (non-tamper) arm. SP is
 * parked in STACK_SCRATCH so the oracle's push/ret traffic falls out of the RAM diff.
 *
 * Jobs: 1. EQUAL across idle / chain / walker+idle / walker+chain; 2. WRITE-SET (own writes on the
 * idle arm: countdown, three latches); 3. TEETH (a corrupted own write is caught; the pending
 * branch and the walker branch are load-bearing).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0fef.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fef as oracle } from "../../translated/loc_0fef.js";
import { rearmMainLoopFrame } from "../rearmMainLoopFrame.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  STAGE_COUNTDOWN,
  ROUND_COUNTER,
  HUNTER_SPAWN_FLIP_FLAG,
  LAUNCH_ARMED_FLAG,
  MAINLOOP_SUBSTATE_SELECTOR,
  TAMPER_STRIKES_SIG,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const WALKER_GATE = 0x89fb; // nonzero -> walker's tamper arm; seated 0 for the normal arm
const ROUND_BIT2 = 0x04;
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the branch selectors; pre-dirty rearmMainLoopFrame's own targets so each write is observable. */
function seat({ bit2 = false, pending = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[WALKER_GATE] = 0x00; // walker takes its normal arm, never the tamper trap
  m.mem8[ROUND_COUNTER] = bit2 ? ROUND_BIT2 : 0x00;
  m.mem8[TAMPER_STRIKES_SIG] = pending;
  m.mem8[STAGE_COUNTDOWN] = 0x77; // pre-dirty so the reload is visible
  m.mem8[HUNTER_SPAWN_FLIP_FLAG] = 0x00;
  m.mem8[LAUNCH_ARMED_FLAG] = 0x00;
  m.mem8[MAINLOOP_SUBSTATE_SELECTOR] = 0x00;
  return m;
}

const CASES = [
  { name: "idle (no walker, no pending)", cfg: { bit2: false, pending: 0x00 } },
  { name: "chain (pending, no walker)", cfg: { bit2: false, pending: 0x05 } },
  { name: "walker + idle", cfg: { bit2: true, pending: 0x00 } },
  { name: "walker + chain", cfg: { bit2: true, pending: 0x05 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: rearmMainLoopFrame == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    rearmMainLoopFrame(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: idle arm reloads the countdown and re-arms the three latches", () => {
  const m = seat({ bit2: false, pending: 0x00 });
  oracle(m);
  assert.equal(m.mem8[STAGE_COUNTDOWN], 0x0f, "stage countdown reloaded");
  assert.equal(m.mem8[HUNTER_SPAWN_FLIP_FLAG], 1, "hunter-spawn flip latch armed");
  assert.equal(m.mem8[LAUNCH_ARMED_FLAG], 1, "launch latch armed");
  assert.equal(m.mem8[MAINLOOP_SUBSTATE_SELECTOR], 1, "selector armed (no pending overwrite)");
  console.log("  WRITE-SET: countdown:=0x0f; flip/launch/selector := 1 on the idle arm");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted own write is CAUGHT; pending + walker branches load-bearing", () => {
  const o = seat({ bit2: false, pending: 0x00 });
  const c = seat({ bit2: false, pending: 0x00 });
  oracle(o);
  rearmMainLoopFrame(c);
  c.mem8[STAGE_COUNTDOWN] = (o.mem8[STAGE_COUNTDOWN] ^ 0xff) & 0xff;
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted countdown");
  assert.equal(d.addr, STAGE_COUNTDOWN, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // pending branch: idle vs chain must diverge (the worker chain ran)
  const idle = seat({ bit2: false, pending: 0x00 });
  const chain = seat({ bit2: false, pending: 0x05 });
  oracle(idle);
  oracle(chain);
  assert.notEqual(ramDiffMinusStack(idle, chain), null, "idle and chain branches must differ");

  // walker branch: bit2 clear vs set must diverge (the walker ran)
  const noWalk = seat({ bit2: false, pending: 0x00 });
  const walk = seat({ bit2: true, pending: 0x00 });
  oracle(noWalk);
  oracle(walk);
  assert.notEqual(ramDiffMinusStack(noWalk, walk), null, "walker branch must be load-bearing");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; pending + walker branches load-bearing`);
});
