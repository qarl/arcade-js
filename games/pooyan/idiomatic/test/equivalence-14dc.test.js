// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armEnemyState8AnimationAndTallyHudField (ROM 0x14dc, Pooyan) — launch/hunter state-1 handler.
 *
 * Setup picks an animation index and a countdown: with the global level byte live and the record's
 * select field != 0xff it clamps the level to 4, folds its bit into the packed field, bumps the
 * neighbour counter, and takes a long countdown; otherwise it uses the record's own index (or 0 when
 * select was 0xff) with a one-frame countdown. It installs the sequence and advances the sub-state.
 * Each frame it steps the animation and counts down (returning while it runs); on expiry it renders
 * the doubled packed field as a stacked-BCD HUD number (with a hundreds digit when present), then
 * either arms the turn animation (phase 7) or bumps the select and runs one retire step that blanks
 * the sprite band on its own expiry.
 *
 * SEATING: register-bridged on IX (the record); no register the caller reads, so equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP. SP is parked in STACK_SCRATCH so the oracle's nested call pushes
 * and its ret drop fall out of the diff. The oracle's m.call chain runs the frozen translated
 * callees; the module imports the idiomatic ones — both memory-equivalent, so RAM must match.
 *
 * Jobs: 1. EQUAL across the level-0 / select-0xff / mask / clamp / doubled-zero branches;
 *   2. WRITE-SET (mask path: packed field += bit, neighbour counter += 1, countdown loaded);
 *   3. TEETH (a corrupted packed-field byte is caught; the mask and level-0 branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-14dc.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_14dc as oracle } from "../../translated/loc_14dc.js";
import { armEnemyState8AnimationAndTallyHudField } from "../armEnemyState8AnimationAndTallyHudField.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_8d45,
  SUBSTATE_FIELD3_VALUE,
  SUBSTATE_FIELD2_VALUE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ba0; //   a spare object record base
const STATE = 0x02; //    sub-state index
const SELTURN = 0x07; //  select field read by the turn-animation arm
const ANIM_LO = 0x0c; //  installed sequence pointer low
const COUNTDOWN = 0x11; // frame/timer countdown
const SELECT = 0x12; //   animation-select field
const PHASE = 0x16; //    phase field (7 => turn animation)
const INDEX = 0x17; //    default animation index
const SP0 = 0x8ff0; //    inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record + global selectors; pre-dirty the written cells so a store is observable. */
function seat({
  level = 0x00,
  select = 0x00,
  index = 0x00,
  phase = 0x00,
  selturn = 0x01,
  field3 = 0x00,
  field2 = 0x00,
} = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  for (let off = 0; off <= 0x17; off++) m.mem.write8(REC + off, 0xee); // pre-dirty the whole record
  m.mem.write8(REC + SELECT, select);
  m.mem.write8(REC + INDEX, index);
  m.mem.write8(REC + PHASE, phase);
  m.mem.write8(REC + SELTURN, selturn);
  m.mem.write8(loc_8d45, level);
  m.mem.write8(SUBSTATE_FIELD3_VALUE, field3);
  m.mem.write8(SUBSTATE_FIELD2_VALUE, field2);
  return m;
}

const CASES = [
  { name: "level 0 -> default index, render, retire+blank", cfg: { level: 0x00, index: 0x02, phase: 0x03, field3: 0x05 } },
  { name: "level set, select 0xff -> index 0, phase 7 -> turn (hundreds)", cfg: { level: 0x01, select: 0xff, phase: 0x07, field3: 0x40 } },
  { name: "mask path -> long countdown, early return", cfg: { level: 0x03, select: 0x05, field3: 0x00, field2: 0x00 } },
  { name: "level >= 5 clamps to 4", cfg: { level: 0x07, select: 0x03, field3: 0x11, field2: 0x02 } },
  { name: "doubled == 0 -> skip render, retire+blank", cfg: { level: 0x00, index: 0x01, phase: 0x02, field3: 0x80 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: armEnemyState8AnimationAndTallyHudField == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    armEnemyState8AnimationAndTallyHudField(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: mask path folds the bit, bumps the counter, loads the countdown", () => {
  // level 3, select != 0xff -> clamp 3, bit index 2, mask 1<<2 = 4; long countdown 0x38, minus one
  // per the frame's own decrement before the early return.
  const m = seat({ level: 0x03, select: 0x05, field3: 0x00, field2: 0x00 });
  oracle(m);
  assert.equal(m.mem.read8(SUBSTATE_FIELD3_VALUE), 0x04, "packed field folds bit 1<<(level-1)");
  assert.equal(m.mem.read8(SUBSTATE_FIELD2_VALUE), 0x01, "neighbour counter bumped");
  assert.equal(m.mem.read8(REC + COUNTDOWN), 0x37, "long countdown 0x38 loaded, decremented once");

  // level >= 5 clamps to 4 -> bit index 3, mask 1<<3 = 8
  const clamp = seat({ level: 0x07, select: 0x03, field3: 0x00, field2: 0x00 });
  oracle(clamp);
  assert.equal(clamp.mem.read8(SUBSTATE_FIELD3_VALUE), 0x08, "level>=5 clamps to 4 -> mask 0x08");
  console.log("  WRITE-SET: field3 += 1<<(clamp-1); field2 += 1; countdown = 0x38-1");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted packed-field byte is CAUGHT; branches are load-bearing", () => {
  const o = seat({ level: 0x03, select: 0x05, field3: 0x00, field2: 0x00 });
  const c = seat({ level: 0x03, select: 0x05, field3: 0x00, field2: 0x00 });
  oracle(o);
  armEnemyState8AnimationAndTallyHudField(c);
  c.mem.write8(SUBSTATE_FIELD3_VALUE, (o.mem.read8(SUBSTATE_FIELD3_VALUE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted packed-field byte");
  assert.equal(d.addr, SUBSTATE_FIELD3_VALUE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // mask path vs level-0 path must diverge, or the guard is dead
  const mask = seat({ level: 0x03, select: 0x05, field3: 0x00 });
  const lvl0 = seat({ level: 0x00, index: 0x02, phase: 0x03, field3: 0x00 });
  oracle(mask);
  oracle(lvl0);
  assert.notEqual(ramDiffMinusStack(mask, lvl0), null, "mask and level-0 branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; guard branch load-bearing`);
});
