// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runPhase1LauncherThenDriver (ROM 0x6e75, Pooyan) — phase-1 spawner gate: with neither
 * guard flag set, run the single-object launcher then the per-record driver, then return.
 *
 * SEATING: BALANCED (plain ret, net SP 0). The module calls its two idiomatic siblings directly;
 * the oracle drives the two translated siblings through the routines map. runPhase1LauncherThenDriver is a void
 * sequencer — no register survives (both callers overwrite/ignore the register file), so the
 * register file is not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP, with SP parked
 * in STACK_SCRATCH so each sub-pass's nested pushes drop out of the diff.
 *
 * The crafted state keeps both sub-passes in a bounded branch: the launcher's countdown is left
 * running so it merely decrements and returns, and every actor record holds a running frame so the
 * driver's sweep merely decrements each and the launch script (non-terminator) short-circuits the
 * completion tail. That isolates runPhase1LauncherThenDriver's own job — ORDER + WIRING + the trap — from the
 * sub-passes' internals, which their own equivalence gates cover.
 *
 * Jobs:
 *   1. EQUAL — module == oracle in RAM (−stack) on the bounded state.
 *   2. WRITE-SET — the launcher's countdown ticks and the first record's hold ticks.
 *   3. TEETH(RAM) — a sequencer missing the launcher diverges at the countdown; missing the driver
 *      diverges at the first record's hold; a corrupted output byte is caught by the diff.
 *   4. TEETH(TRAP) — a set guard flag makes both oracle and module throw.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6e75.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6e75 as oracle } from "../../translated/loc_6e75.js";
import { runPhase1LauncherThenDriver } from "../runPhase1LauncherThenDriver.js";
import { launchNextScriptedObjectOnDelay } from "../launchNextScriptedObjectOnDelay.js";
import { drivePhase1RecordsThenCheckCompletion } from "../drivePhase1RecordsThenCheckCompletion.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FREEZE = 0x881e; //   TAMPER_FREEZE_FLAG  (guard 1)
const PAUSE = 0x8ef0; //    SIGNATURE_MISMATCH_FLAG  (guard 2)
const DELAY = 0x8f48; //    INTRO_DELAY_CKSUM_WORD  (launcher countdown)
const SPTR = 0x8f4a; //     LAUNCH_SCRIPT_PTR
const SCRIPT_CELL = 0x8f40; // spare RAM the script pointer aims at (non-terminator)
const EAT = 0x8ae0; //      ENEMY_ACTOR_TABLE
const STRIDE = 0x18;
const STATE = 0x02; //      record state byte -> the generic mover branch
const HOLD = 0x0e; //       record frame-hold counter
const ACTORS = 0x0e; //     records swept (14)
const SP0 = 0x8ff0; //      inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Bounded state: guards clear, launcher countdown running, every record holding, script unfinished. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(FREEZE, 0x00);
  m.mem.write8(PAUSE, 0x00);
  m.mem.write8(DELAY, 0x05); //         countdown running -> launcher decrements and returns
  m.mem.write8(SPTR, SCRIPT_CELL & 0xff);
  m.mem.write8(SPTR + 1, (SCRIPT_CELL >> 8) & 0xff);
  m.mem.write8(SCRIPT_CELL, 0x00); //   != 0xff -> driver's completion tail short-circuits
  for (let i = 0; i < ACTORS; i++) {
    m.mem.write8(EAT + i * STRIDE + STATE, 0x00); // generic-mover branch
    m.mem.write8(EAT + i * STRIDE + HOLD, 0x05); //  frame holding -> mover decrements and returns
  }
  return m;
}

const craftTrap = () => {
  const m = craft();
  m.mem.write8(PAUSE, 0x01); // a set guard flag arms the dead trap
  return m;
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: runPhase1LauncherThenDriver == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  runPhase1LauncherThenDriver(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: RAM identical");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the launcher countdown and the first record's hold both tick", () => {
  const o = craft();
  oracle(o);
  assert.equal(o.mem.read8(DELAY), 0x04, "launcher countdown must decrement 0x05 -> 0x04");
  assert.equal(o.mem.read8(EAT + HOLD), 0x04, "first record hold must decrement 0x05 -> 0x04");
  console.log("  WRITE-SET: countdown and hold ticked");
});

// -- 3. TEETH(RAM) ------------------------------------------------------------

const DROPS = [
  { name: "drop launcher", run: (twin) => drivePhase1RecordsThenCheckCompletion(twin), addr: DELAY },
  { name: "drop driver", run: (twin) => launchNextScriptedObjectOnDelay(twin), addr: EAT + HOLD },
];

test("TEETH: a sequencer missing either pass diverges at that pass's footprint", () => {
  for (const { name, run, addr } of DROPS) {
    const o = craft();
    const twin = craft();
    oracle(o);
    run(twin); // a broken sequencer that runs only one of the two passes
    const d = ramDiffMinusStack(o, twin);
    assert.notEqual(d, null, `${name}: the gate FAILED to catch a missing pass — worthless`);
    assert.equal(d.addr, addr, `${name}: teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(addr)})`);
    console.log(`  TEETH ${name}: caught at ${hx(d.addr)}`);
  }
});

test("TEETH: a corrupted output byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  runPhase1LauncherThenDriver(c);
  c.mem.write8(DELAY, (o.mem.read8(DELAY) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted output byte");
  assert.equal(d.addr, DELAY, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

// -- 4. TEETH(TRAP) -----------------------------------------------------------

test("TEETH: a set guard flag makes both oracle and module throw", () => {
  assert.throws(() => oracle(craftTrap()), "oracle must trap on a set guard flag");
  assert.throws(() => runPhase1LauncherThenDriver(craftTrap()), "module must trap on a set guard flag");
  console.log("  TEETH(TRAP): both throw");
});
