// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceFallingEnemyAndTallyCatchOnLanding (ROM 0x3f7c, Pooyan) — object state-15 (catch) handler on IX.
 *
 * SEATING: BALANCED (plain ret / tail-calls) -> WIRE. advanceObjectStateOnFrameTimerExpiry (its fall-through caller) documents the
 * delegate yields nothing the caller reads, so LIVE-OUT is memory only; comparison is RAM (dumpState)
 * minus stack scratch below the entry SP, register file not compared. SP parked in STACK_SCRATCH.
 *
 * The module drives idiomatic siblings directly; the oracle drives the translated siblings through the
 * routines map (each pair covered by its own gate). Crafted paths: still-airborne early return; landing
 * on the normal path with the stage countdown running and with it already zero; and the special path
 * (rec+0x0b bit0 set) that clears the countdown and runs the ROM checksum guard over real ROM.
 *
 * Jobs:
 *   1. EQUAL — every crafted path: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a landing resets rec+2/rec+0x11 and drops the active-enemy count.
 *   3. TEETH — a corrupted post-run byte is caught by the RAM diff; a twin that skips the fall diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3f7c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3f7c as oracle } from "../../translated/loc_3f7c.js";
import { advanceFallingEnemyAndTallyCatchOnLanding } from "../advanceFallingEnemyAndTallyCatchOnLanding.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c50; // IX record base, clear of the sprite table and named cells
const STAGE_COUNTDOWN = 0x8901;
const ACTIVE_ENEMY = 0x8d40;
const SOUND_PTR = 0x8a40;
const PLAY_LATCH = 0x8f50;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the IX record + the world the landing path touches. `land` picks the fall geometry. */
function seat(m, { fields = {}, land = true, countdown = 0x05 } = {}) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.ix = REC;
  for (let i = 0; i < 0x18; i++) m.mem.write8(REC + i, 0x00);
  m.mem.write8(REC + 0x0e, 0x03); // anim frame-hold nonzero -> advanceObjectAnimationFrame just decrements
  m.mem.write8(REC + 0x07, 0x01); // caught kind -> splash anim index 0
  m.mem.write8(REC + 0x09, land ? 0x20 : 0x01); // fall velocity
  m.mem.write8(REC + 0x03, land ? 0xf0 : 0x00); // fall fraction
  m.mem.write8(REC + 0x04, land ? 0x1d : 0x10); // integer row (0x1d -> 0x1e = landed)
  for (const [off, v] of Object.entries(fields)) m.mem.write8(REC + Number(off), v);
  m.mem.write8(STAGE_COUNTDOWN, countdown);
  m.mem.write8(ACTIVE_ENEMY, 0x05);
  m.mem.write8(SOUND_PTR, 0x43); // sound-ring cursor in range
  m.mem.write8(PLAY_LATCH, 0x00);
  return m;
}

const CASES = {
  "still airborne -> early return": (m) => seat(m, { land: false }),
  "land: normal, countdown running": (m) => seat(m, { fields: { 0x0b: 0x00 }, countdown: 0x05 }),
  "land: normal, countdown already 0": (m) => seat(m, { fields: { 0x0b: 0x00 }, countdown: 0x00 }),
  "land: special path (checksum guard)": (m) => seat(m, { fields: { 0x0b: 0x01 }, countdown: 0x05 }),
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceFallingEnemyAndTallyCatchOnLanding == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    advanceFallingEnemyAndTallyCatchOnLanding(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a landing resets rec+2/rec+0x11 and drops the active-enemy count", () => {
  const land = CASES["land: normal, countdown running"](BASE.clone());
  oracle(land);
  assert.equal(land.mem.read8(REC + 0x02), 0x02, "state reset to 2");
  assert.equal(land.mem.read8(REC + 0x11), 0x20, "splash timer reset to 0x20");
  assert.equal(land.mem.read8(ACTIVE_ENEMY), 0x04, "active-enemy count 5 -> 4");

  const air = CASES["still airborne -> early return"](BASE.clone());
  oracle(air);
  assert.equal(air.mem.read8(REC + 0x02), 0x00, "airborne must not reset state");
  console.log("  WRITE-SET: land resets fields + drops count; airborne inert of that");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["land: normal, countdown running"](BASE.clone());
  const c = CASES["land: normal, countdown running"](BASE.clone());
  oracle(o);
  advanceFallingEnemyAndTallyCatchOnLanding(c);
  c.mem.write8(REC + 0x11, (o.mem.read8(REC + 0x11) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, REC + 0x11, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the fall (never lands) diverges from the oracle", () => {
  const o = CASES["land: normal, countdown running"](BASE.clone());
  const c = CASES["land: normal, countdown running"](BASE.clone());
  oracle(o); // lands: resets state, scores, drops count
  advanceFallingEnemyAndTallyCatchOnLanding(seat(c, { land: false, fields: { 0x0b: 0x00 } })); // twin never lands -> different footprint
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a never-landing twin must diverge from a landing oracle");
  console.log(`  TEETH(fall): caught at ${hx(d.addr ?? 0)}`);
});
