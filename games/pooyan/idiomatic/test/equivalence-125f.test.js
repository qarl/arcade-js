// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorStateOnTimerAndRestartAnim (Pooyan) — countdown-driven phase transition for the actor
 * record at IX. Decrements the per-phase timer (rec+0x11); while non-zero it returns untouched. On
 * expiry it advances the phase field (rec+0x02), sets rec+0x08 := 1, and points the record at
 * animation table ANIM_TABLE_3838 via the (already idiomatic) setActorAnimation, which writes
 * rec+0x0C..rec+0x0E.
 *
 * REGISTER BRIDGE: rec = m.regs.ix. Cases are CRAFTED (a boot does not seat this record geometry).
 * Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH so the oracle's
 * tail-call ret drops out of the diff.
 *
 * Jobs: 1. EQUAL (counting + expiry); 2. WRITE-SET (timer always; phase/latch/anim on expiry);
 * 3. TEETH (a corrupted anim byte is caught; the branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-125f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_125f as oracle } from "../../translated/loc_125f.js";
import { advanceActorStateOnTimerAndRestartAnim } from "../advanceActorStateOnTimerAndRestartAnim.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ANIM_TABLE_3838 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b00; // an actor record (safe RAM, clear of STACK_SCRATCH)
const SP0 = 0x8ff0; // inside STACK_SCRATCH
const TIMER = REC + 0x11;
const PHASE = REC + 0x02;
const LATCH = REC + 0x08;
const ANIM_LO = REC + 0x0c;
const ANIM_HI = REC + 0x0d;
const ANIM_IDX = REC + 0x0e;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat({ timer = 0x01, phase = 0x03 } = {}) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = SP0;
  m.mem.write8(TIMER, timer);
  m.mem.write8(PHASE, phase);
  m.mem.write8(LATCH, 0xee); // pre-dirty so the := 1 is visible
  m.mem.write8(ANIM_LO, 0xaa); // pre-dirty the anim field
  m.mem.write8(ANIM_HI, 0xaa);
  m.mem.write8(ANIM_IDX, 0xaa);
  return m;
}

const craftCount = () => seat({ timer: 0x05 });
const craftExpire = () => seat({ timer: 0x01 });

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceActorStateOnTimerAndRestartAnim == oracle in RAM (−stack)", () => {
  for (const [name, craft] of [["counting", craftCount], ["expiry", craftExpire]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    advanceActorStateOnTimerAndRestartAnim(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: counting + expiry identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: timer always ticks; expiry advances phase, latches, sets the anim table", () => {
  const c = craftCount();
  oracle(c);
  assert.equal(c.mem.read8(TIMER), 0x04, "timer 0x05 -> 0x04");
  assert.equal(c.mem.read8(PHASE), 0x03, "phase untouched while counting");
  assert.equal(c.mem.read8(LATCH), 0xee, "latch untouched while counting");

  const e = craftExpire();
  oracle(e);
  assert.equal(e.mem.read8(TIMER), 0x00, "timer 0x01 -> 0x00 on expiry");
  assert.equal(e.mem.read8(PHASE), 0x04, "phase advanced 0x03 -> 0x04");
  assert.equal(e.mem.read8(LATCH), 0x01, "advance latch set to 1");
  assert.equal(e.mem.read8(ANIM_LO), ANIM_TABLE_3838 & 0xff, "anim pointer low := 0x38");
  assert.equal(e.mem.read8(ANIM_HI), (ANIM_TABLE_3838 >> 8) & 0xff, "anim pointer high := 0x38");
  assert.equal(e.mem.read8(ANIM_IDX), 0x00, "anim frame index reset to 0");
  console.log("  WRITE-SET: timer-- always; phase+1, latch:=1, anim:=0x3838, idx:=0 (expiry)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted anim byte is CAUGHT; the branches are load-bearing", () => {
  const o = craftExpire();
  const c = craftExpire();
  oracle(o);
  advanceActorStateOnTimerAndRestartAnim(c);
  c.mem.write8(ANIM_LO, (o.mem.read8(ANIM_LO) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted anim byte");
  assert.equal(d.addr, ANIM_LO, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  const count = craftCount();
  const expire = craftExpire();
  oracle(count);
  oracle(expire);
  assert.notEqual(ramDiffMinusStack(count, expire), null, "counting and expiry branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; branch load-bearing`);
});
