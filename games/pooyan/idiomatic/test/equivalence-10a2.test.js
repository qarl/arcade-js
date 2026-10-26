// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintSubstateHudDigitsAndAdvancePhase (Pooyan) — repaint the three sub-state HUD digit fields,
 * then bump the phase selector and queue the phase sound.
 *
 * Field 1 draws its subcounter (packed to BCD when >= 10), plus a re-centred second field
 * (12 - value, doubled) when the value is 1..11. Field 2 draws its own source the same way.
 * Field 3, only when nonzero, folds into the field-1 counter, draws doubled, and latches a
 * nonzero hundreds tally. The routine takes NO register inputs — every case is a memory poke.
 *
 * Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH so the oracle's
 * ret/call stack traffic falls out of the diff. No register live-out (the tail's ring cursor is
 * idiomatic-only), so no side-effect arms.
 *
 * Jobs: 1. EQUAL across the field-1/2/3 branch matrix; 2. WRITE-SET (the drawn digit cells carry
 * the expected values); 3. TEETH (a corrupted digit cell is caught; branches are load-bearing).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-10a2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_10a2 as oracle } from "../../translated/loc_10a2.js";
import { paintSubstateHudDigitsAndAdvancePhase } from "../paintSubstateHudDigitsAndAdvancePhase.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  HUNTER_SPAWN_SUBCOUNTER,
  HUNTER_SPAWN_SUBCOUNTER_VRAM,
  SUBSTATE_FIELD1_COUNTER,
  SUBSTATE_FIELD1_VRAM,
  SUBSTATE_FIELD2_VALUE,
  SUBSTATE_FIELD2_VRAM,
  SUBSTATE_FIELD3_VALUE,
  SUBSTATE_FIELD3_VRAM,
  SUBSTATE_FIELD3_HUNDREDS_VRAM,
  MAINLOOP_SUBSTATE_SELECTOR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; // inside STACK_SCRATCH
const ROW_UP = 0x20; // units digit drawn one tilemap row up (lower address)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Seat the three source bytes; pre-dirty every cell the routine may draw so a write is visible. */
function seat({ f1 = 0x00, f2 = 0x00, f3 = 0x00, counter = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(HUNTER_SPAWN_SUBCOUNTER, f1);
  m.mem.write8(SUBSTATE_FIELD2_VALUE, f2);
  m.mem.write8(SUBSTATE_FIELD3_VALUE, f3);
  m.mem.write8(SUBSTATE_FIELD1_COUNTER, counter);
  for (const base of [HUNTER_SPAWN_SUBCOUNTER_VRAM, SUBSTATE_FIELD1_VRAM, SUBSTATE_FIELD2_VRAM, SUBSTATE_FIELD3_VRAM]) {
    m.mem.write8(base, 0xee);
    m.mem.write8((base - ROW_UP) & 0xffff, 0xee);
  }
  m.mem.write8(SUBSTATE_FIELD3_HUNDREDS_VRAM, 0xee);
  m.mem.write8(MAINLOOP_SUBSTATE_SELECTOR, 0x40);
  return m;
}

const CASES = [
  { name: "all zero -> field1 blank, no second, no field3", cfg: {} },
  { name: "f1=5 raw, second field re-centred", cfg: { f1: 0x05 } },
  { name: "f1=7 -> centre stays 5", cfg: { f1: 0x07 } },
  { name: "f1=0x0a packed + second field", cfg: { f1: 0x0a } },
  { name: "f1=0x0b packed + second field", cfg: { f1: 0x0b } },
  { name: "f1=0x0c packed, no second (>= limit)", cfg: { f1: 0x0c } },
  { name: "f1=0x2f packed, no second", cfg: { f1: 0x2f } },
  { name: "f2=9 raw", cfg: { f2: 0x09 } },
  { name: "f2=0x37 packed", cfg: { f2: 0x37 } },
  { name: "f3=3 present, no hundreds", cfg: { f3: 0x03, counter: 0x10 } },
  { name: "f3=0x64 present, hundreds=2 latched", cfg: { f3: 0x64 } },
  { name: "f3=0x7f present, doubled wrap", cfg: { f3: 0x7f } },
  { name: "full: f1=3, f2=0x1c, f3=0x50", cfg: { f1: 0x03, f2: 0x1c, f3: 0x50, counter: 0x08 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: paintSubstateHudDigitsAndAdvancePhase == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    paintSubstateHudDigitsAndAdvancePhase(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: drawn digit cells carry the expected values", () => {
  // f1=5 raw: field1 draws blank tens (0x10) + units 5; second field 12-5=7, x2=14 -> BCD 0x14.
  const one = seat({ f1: 0x05 });
  oracle(one);
  assert.equal(one.mem.read8(HUNTER_SPAWN_SUBCOUNTER_VRAM), 0x10, "f1 tens blanked");
  assert.equal(one.mem.read8(HUNTER_SPAWN_SUBCOUNTER_VRAM - ROW_UP), 0x05, "f1 units");
  assert.equal(one.mem.read8(SUBSTATE_FIELD1_COUNTER), 0x07, "re-centred counter 12-5");
  assert.equal(one.mem.read8(SUBSTATE_FIELD1_VRAM), 0x01, "second-field tens");
  assert.equal(one.mem.read8(SUBSTATE_FIELD1_VRAM - ROW_UP), 0x04, "second-field units");
  assert.equal(one.mem.read8(MAINLOOP_SUBSTATE_SELECTOR), 0x41, "selector bumped");

  // f3=0x64 -> x2=200 -> hundreds 2 latched, digits 00.
  const three = seat({ f3: 0x64 });
  oracle(three);
  assert.equal(three.mem.read8(SUBSTATE_FIELD3_HUNDREDS_VRAM), 0x02, "hundreds latched");
  assert.equal(three.mem.read8(SUBSTATE_FIELD3_VRAM), 0x10, "field3 tens blanked (00)");
  assert.equal(three.mem.read8(SUBSTATE_FIELD3_VRAM - ROW_UP), 0x00, "field3 units");

  // f3 absent leaves the hundreds cell untouched (only latched when nonzero).
  const none = seat({ f3: 0x00 });
  oracle(none);
  assert.equal(none.mem.read8(SUBSTATE_FIELD3_HUNDREDS_VRAM), 0xee, "hundreds untouched when f3=0");
  console.log("  WRITE-SET: field1/second/field3 digits + hundreds latch + selector bump verified");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted digit cell is CAUGHT; branches are load-bearing", () => {
  const o = seat({ f1: 0x0a, f3: 0x64 });
  const c = seat({ f1: 0x0a, f3: 0x64 });
  oracle(o);
  paintSubstateHudDigitsAndAdvancePhase(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: equal before corruption");
  c.mem.write8(SUBSTATE_FIELD3_VRAM, (o.mem.read8(SUBSTATE_FIELD3_VRAM) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted digit cell");
  assert.equal(d.addr, SUBSTATE_FIELD3_VRAM, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // field3-present vs absent must differ, or the guard is dead
  const present = seat({ f3: 0x64 });
  const absent = seat({ f3: 0x00 });
  oracle(present);
  oracle(absent);
  assert.notEqual(ramDiffMinusStack(present, absent), null, "field3 present/absent must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; field3 branch load-bearing`);
});
