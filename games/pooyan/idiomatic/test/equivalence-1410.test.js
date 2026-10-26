// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for latchActorStepThenDispatchByStageCountdown (Pooyan) — stash the actor's step value into the record
 * at rec+5, latch it, then branch on the stage countdown: below three tails into the state-timer
 * dispatch (which reads the latch), otherwise tails into the spawn/queue gate.
 *
 * SEATING: TAIL-CALL. The frozen entry has no ret of its own — both exits tail-jp to a delegate;
 * its seating is the delegate's, and the module returns the delegate's result directly. latchActorStepThenDispatchByStageCountdown
 * WIREs as an override (the dispatcher reads the delegate's result back through it). Compared on
 * RAM (dumpState) minus stack scratch below the entry SP; the delegates carry their own register live-out, checked by
 * their own gates. SP is parked in STACK_SCRATCH so nested pushes drop out of the diff.
 *
 * Cases are CRAFTED: a plain boot does not seat this record/countdown geometry.
 *
 * NOTE: the below-three branch delegates to dispatchActorSpawnBySubStateAndPaceCadence, which is not yet lifted in this batch, so the
 * module imports it by its expected sibling path. This test loads (and its below-three case runs)
 * only once that sibling module exists; the at-or-above-three (spawn/queue) branch is fully
 * covered here against the already-lifted gate.
 *
 * Jobs:
 *   1. EQUAL — spawn/queue write, spawn/queue gate-hit (no-op delegate), and timer-dispatch:
 *      frozen == module in RAM (−stack).
 *   2. WRITE-SET — every branch stamps rec+5; the write branch also clears rec+8.
 *   3. TEETH — a corrupted delegate byte is caught by the RAM diff; a twin that skips the rec+5
 *      stash diverges there; the two branches produce different RAM (the countdown gate is
 *      load-bearing).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1410.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1410 as oracle } from "../../translated/loc_1410.js";
import { latchActorStepThenDispatchByStageCountdown } from "../latchActorStepThenDispatchByStageCountdown.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, STAGE_COUNTDOWN } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b00; // an actor record (safe RAM, clear of STACK_SCRATCH)
const SP0 = 0x8ff0; // inside STACK_SCRATCH
const VALUE = 0x42; // the step value to stash + latch

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record + registers; countdown and phase select the branch/delegate outcome. */
function seat(m, { countdown = 0x05, phase = 0x00, value = VALUE } = {}) {
  m.regs.ix = REC;
  m.regs.a = value;
  m.regs.b = 0x00;
  m.regs.sp = SP0;
  m.mem.write8(STAGE_COUNTDOWN, countdown);
  m.mem.write8(REC + 0x06, phase); // spawn/queue gate + timer-dispatch both read rec+6
  m.mem.write8(REC + 0x08, 0xee); // pre-dirty the field the write branch clears
  return m;
}

const craftWrite = () => seat(BASE.clone(), { countdown: 0x05, phase: 0x00 }); // spawn/queue writes
const craftGate = () => seat(BASE.clone(), { countdown: 0x05, phase: 0x03 }); // spawn/queue no-op
const craftTimer = () => seat(BASE.clone(), { countdown: 0x01, phase: 0x00 }); // timer-dispatch

const CASES = [
  { name: "spawn/queue write", craft: craftWrite },
  { name: "spawn/queue gate-hit", craft: craftGate },
  { name: "timer-dispatch (below three)", craft: craftTimer },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: latchActorStepThenDispatchByStageCountdown == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    latchActorStepThenDispatchByStageCountdown(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: every branch stamps rec+5; the write branch clears rec+8", () => {
  const w = craftWrite();
  oracle(w);
  assert.equal(w.mem.read8(REC + 0x05), VALUE, "rec+5 stamped with the step value");
  assert.equal(w.mem.read8(REC + 0x08), 0x00, "write branch clears rec+8");

  const g = craftGate();
  oracle(g);
  assert.equal(g.mem.read8(REC + 0x05), VALUE, "gate-hit still stamps rec+5");
  assert.equal(g.mem.read8(REC + 0x08), 0xee, "gate-hit leaves rec+8 untouched");
  console.log("  WRITE-SET: rec+5 always; rec+8 only on the write branch");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted delegate byte is CAUGHT by the RAM diff", () => {
  const o = craftWrite();
  const c = craftWrite();
  oracle(o);
  latchActorStepThenDispatchByStageCountdown(c);
  c.mem.write8(REC + 0x08, (o.mem.read8(REC + 0x08) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted delegate byte");
  assert.equal(d.addr, REC + 0x08, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a corrupted rec+5 stash is caught; the countdown branch is load-bearing", () => {
  const o = craftWrite();
  const c = craftWrite();
  oracle(o);
  latchActorStepThenDispatchByStageCountdown(c);
  c.mem.write8(REC + 0x05, (o.mem.read8(REC + 0x05) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a corrupted rec+5 stash must be caught");
  assert.equal(d.addr, REC + 0x05, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // the two branches must produce different RAM, or the countdown gate is dead
  const above = craftWrite();
  const below = craftTimer();
  oracle(above);
  oracle(below);
  assert.notEqual(ramDiffMinusStack(above, below), null, "the two branches must differ — countdown gate load-bearing");
  console.log("  TEETH: rec+5 stash + branch selection both load-bearing");
});
