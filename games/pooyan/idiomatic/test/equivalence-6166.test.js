// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resetActorRecordQueueSoundAndAbortFrame (ROM 0x6166, Pooyan) — "reset the actor record", a
 * caller that dissolves the caller-skip clearActiveObjectTypeAndAbortHandler.
 *
 * The routine clears the record IY points at to its idle opening state (+0 := 0, +1 := 1,
 * +2 := 8, +0x16 := 7, +0x17 := 5, +0x14 := 0, +0x13 := 0), enqueues one of two fixed sound
 * commands chosen by ACTIVE_OBJECT_TYPE (!= 3 -> the sound-command ring; == 3 -> the text
 * ring), then continues into the caller-skip clearActiveObjectTypeAndAbortHandler, which clears the type and aborts the
 * frame. The idiomatic module composes the REAL idiomatic sound helper and idiomatic clearActiveObjectTypeAndAbortHandler.
 *
 * Cycle-free memory-equivalence gate: the oracle drives the translated chain (its own sound
 * helper + pop-af skip), the module drives the idiomatic chain; both compared on RAM
 * (dumpState, minus stack scratch below the entry SP). No register survives the terminating skip (its dropped
 * pop-af clobbers A/flags), so the register file is not compared; the module returns false.
 *
 * SP is parked in STACK_SCRATCH so the inner sound call's pushes and the skip's pop-af+ret all
 * land in the dead-stack region and drop out of the RAM diff. On an unbooted clone the text
 * ring's game-active/play-mode gates are shut, so the == 3 branch writes only its latch cell
 * (0x8d20) and no ring slot — reproduced identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — both object-type branches over several IY bases: oracle == module in RAM
 *      (−stack); the module returns false (always aborts).
 *   2. WRITE-SET — the record fields reset to their fixed opening values.
 *   3. TEETH — a wrong reset byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6166.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6166 as oracle } from "../../translated/loc_6166.js";
import { resetActorRecordQueueSoundAndAbortFrame } from "../resetActorRecordQueueSoundAndAbortFrame.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ACTIVE_OBJECT_TYPE = 0x8d44;
const SOUND_RING_PTR = 0x8a40;
const SP_SCRATCH = 0x8ff0;
// The record fields the routine resets, with the fixed opening value each takes.
const RESET_FIELDS = [
  [0x00, 0x00], [0x01, 0x01], [0x02, 0x08], [0x13, 0x00], [0x14, 0x00], [0x16, 0x07], [0x17, 0x05],
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SCRATCH);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with IY (record to reset), object type, and the ring cursor seated. */
function craft(iy, objType) {
  const m = BASE.clone();
  m.regs.iy = iy & 0xffff;
  for (const [off] of RESET_FIELDS) m.mem.write8((iy + off) & 0xffff, 0xee); // pre-dirty so writes show
  m.mem.write8(ACTIVE_OBJECT_TYPE, objType & 0xff);
  m.mem.write8(SOUND_RING_PTR, 0x43);
  m.regs.sp = SP_SCRATCH;
  return m;
}

const CASES = [
  { iy: 0x8c50, objType: 0x00 }, // != 3 -> sound-command ring
  { iy: 0x8c50, objType: 0x03 }, // == 3 -> text ring (gated shut here)
  { iy: 0x8be8, objType: 0x07 }, // != 3, different record base
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: resetActorRecordQueueSoundAndAbortFrame == oracle in RAM (−stack) over both branches / several IY bases", () => {
  for (const { iy, objType } of CASES) {
    const o = craft(iy, objType);
    const c = craft(iy, objType);
    oracle(o);
    const ret = resetActorRecordQueueSoundAndAbortFrame(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `iy=${hx(iy)} objType=${hx(objType)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, false, `chain ends in the caller-skip -> false (iy=${hx(iy)} objType=${hx(objType)})`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack), chain returns false`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the record fields reset to their fixed opening values", () => {
  const { iy, objType } = CASES[0];
  const c = craft(iy, objType);
  resetActorRecordQueueSoundAndAbortFrame(c);
  const o = craft(iy, objType);
  oracle(o);
  for (const [off, val] of RESET_FIELDS) {
    assert.equal(c.mem.read8((iy + off) & 0xffff), val, `module ${hx((iy + off) & 0xffff)} := ${hx(val)}`);
    assert.equal(o.mem.read8((iy + off) & 0xffff), val, `oracle ${hx((iy + off) & 0xffff)} := ${hx(val)}`);
  }
  console.log(`  WRITE-SET: ${RESET_FIELDS.length} record fields reset to opening state`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong reset byte is CAUGHT by the RAM diff", () => {
  const { iy, objType } = CASES[0];
  const o = craft(iy, objType);
  const c = craft(iy, objType);
  oracle(o);
  resetActorRecordQueueSoundAndAbortFrame(c);
  const victim = (iy + 0x02) & 0xffff;
  c.mem.write8(victim, 0x00); // BUG: +2 must be 0x08
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong reset byte — it is worthless");
  assert.equal(d.addr, victim, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
