// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for adjustCounterAndPaintBcdHudFields (ROM 0x10c2, Pooyan) — adjust a counter and repaint a
 * three-field BCD display. Inputs are B (the counter), A (the signed adjustment), and the entry carry
 * (direction: set = up, clear = down). The counter is walked one step at a time until the adjustment
 * reaches zero, then stored to 0x8f62 and drawn doubled as field 1. Field 2 (source 0x8f5e) draws a
 * single-digit value directly, else re-encodes it to packed BCD. Field 3 (source 0x8f60), when
 * nonzero, folds into the counter and draws doubled, mirroring its hundreds digit to 0x85f2 when
 * nonzero. Finally the main-loop sub-state selector 0x8f5c is bumped and queueSoundCommand13 queues a sound.
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) PLUS the declared register live-out A — the ring cursor the closing queueSoundCommand13 append
 * leaves, which flows through the tail call so a register-dispatched caller reads it back. Both sides'
 * m.call push/ret land in STACK_SCRATCH (SP seated there) and are diff-excluded.
 *
 * NOTE FOR THE LEAD: 0x8f62/0x8f5e/0x8f60/0x8f5c and the four VRAM cells are not yet in names.js; this
 * test carries them as local consts. The module imports the proposed idents; merge them before running.
 *
 * GAME_ACTIVE_FLAG is set so queueSoundCommand13's ring append advances the cursor (a nonzero, checkable A).
 *
 * Jobs:
 *   1. EQUAL — up/down, field3 absent/present, a hundreds carry, field2 below/at ten, and the
 *      adjustment==0 full-wrap: oracle == module in RAM (−stack) AND in HL + A; the module SETS both.
 *   2. WRITE-SET — a field3-absent, single-digit-field2 call writes only its determined footprint.
 *   3. TEETH — a wrong VRAM tile (RAM) and a wrong returned A (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-10c2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_10c2 as oracle } from "../../translated/loc_10c2.js";
import { adjustCounterAndPaintBcdHudFields } from "../adjustCounterAndPaintBcdHudFields.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, GAME_ACTIVE_FLAG, SOUND_RING_WRITE_PTR, SOUND_RING_PENDING_BYTE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

// Proposed names.js additions (see NOTE above).
const FIELD1_COUNTER = 0x8f62;
const FIELD2_VALUE = 0x8f5e;
const FIELD3_VALUE = 0x8f60;
const SUBSTATE_SELECTOR = 0x8f5c;
const FIELD1_VRAM = 0x85d0;
const FIELD2_VRAM = 0x8652;
const FIELD3_VRAM = 0x85d2;
const FIELD3_HUNDREDS_VRAM = 0x85f2;
const ROW_UP = 0x20; // drawStackedBcdDigits writes the tens at dst and the units one row up (dst-0x20)
const RING_PTR = 0x50;
const RING_PAGE = 0x8a00;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: clear this routine's cells + VRAM targets, seat the register inputs and the ring. */
function craft({ counter, adjust, dirUp, v2, v3, gameActive = 1 }) {
  const m = BASE.clone();
  m.mem.write8(FIELD1_COUNTER, 0);
  m.mem.write8(FIELD2_VALUE, v2);
  m.mem.write8(FIELD3_VALUE, v3);
  m.mem.write8(SUBSTATE_SELECTOR, 0);
  for (const base of [FIELD1_VRAM, FIELD2_VRAM, FIELD3_VRAM]) {
    m.mem.write8(base, 0);
    m.mem.write8(base - ROW_UP, 0);
  }
  m.mem.write8(FIELD3_HUNDREDS_VRAM, 0);
  m.mem.write8(GAME_ACTIVE_FLAG, gameActive);
  m.mem.write8(SOUND_RING_WRITE_PTR, RING_PTR);
  m.regs.b = counter & 0xff;
  m.regs.a = adjust & 0xff;
  m.regs.fC = dirUp; // entry carry = direction
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  return m;
}

const CASES = [
  { name: "up, field3 absent, field2<10", counter: 0x0c, adjust: 0xff, dirUp: true, v2: 0x05, v3: 0x00 },
  { name: "down, field3 present, field2>=10", counter: 0x40, adjust: 0x05, dirUp: false, v2: 0x2a, v3: 0x08 },
  { name: "field3 with hundreds carry", counter: 0x10, adjust: 0xfe, dirUp: true, v2: 0x09, v3: 0x50 },
  { name: "field2 exactly ten", counter: 0x01, adjust: 0x01, dirUp: false, v2: 0x0a, v3: 0x00 },
  { name: "adjustment 0 -> full wrap up", counter: 0x22, adjust: 0x00, dirUp: true, v2: 0x03, v3: 0x00 },
  { name: "adjustment 0 -> full wrap down", counter: 0x22, adjust: 0x00, dirUp: false, v2: 0x03, v3: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted (counter,adjust,dir,fields) — adjustCounterAndPaintBcdHudFields == oracle in RAM (−stack) + HL + A", () => {
  for (const c of CASES) {
    const o = craft(c);
    oracle(o);
    const m = craft(c);
    const [retHl, retA] = adjustCounterAndPaintBcdHudFields(m);
    const d = ramDiffMinusStack(o, m);
    assert.equal(d, null, d && `${c.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(retHl & 0xffff, o.regs.hl & 0xffff, `${c.name}: HL return mismatch`);
    assert.equal(retA & 0xff, o.regs.a & 0xff, `${c.name}: A return mismatch`);
    // SIDE-EFFECT arm: the module must SET HL and A on its own clone, not merely return them —
    // a register-dispatched caller reads both straight out of the registers.
    assert.equal(m.regs.hl & 0xffff, o.regs.hl & 0xffff, `${c.name}: module must SET HL`);
    assert.equal(m.regs.a & 0xff, o.regs.a & 0xff, `${c.name}: module must SET A`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + HL + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a field3-absent, single-digit-field2 call writes only its footprint", () => {
  const c = CASES[0];
  const before = craft(c);
  const after = craft(c);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const footprint = new Set([
    FIELD1_COUNTER, SUBSTATE_SELECTOR,
    FIELD1_VRAM, FIELD1_VRAM - ROW_UP, FIELD2_VRAM, FIELD2_VRAM - ROW_UP,
    SOUND_RING_PENDING_BYTE, SOUND_RING_WRITE_PTR, RING_PAGE + RING_PTR,
  ]);
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  for (const addr of changed) {
    if (inDeadStack(addr)) continue;
    assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  }
  assert.equal(after.mem.read8(FIELD1_COUNTER), 0x0d, "counter walked up by one (adjust 0xff -> +1)");
  assert.equal(after.mem.read8(SUBSTATE_SELECTOR), 0x01, "sub-state selector bumped");
  assert.equal(after.mem.read8(FIELD3_VRAM), 0x00, "field 3 untouched when its source is zero");
  console.log("  WRITE-SET: footprint confined to counter + two fields + sub-state + ring");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong field-1 VRAM tile is CAUGHT by the RAM diff", () => {
  const c = CASES[1];
  const o = craft(c);
  const m = craft(c);
  oracle(o);
  adjustCounterAndPaintBcdHudFields(m);
  m.mem.write8(FIELD1_VRAM, (o.mem.read8(FIELD1_VRAM) ^ 0x01) & 0xff); // BUG: corrupt the tens tile
  const d = ramDiffMinusStack(o, m);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong VRAM tile — it is worthless");
  assert.equal(d.addr, FIELD1_VRAM, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): wrong field-1 tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned A is CAUGHT by the live-out check", () => {
  const c = CASES[0];
  const o = craft(c);
  const m = craft(c);
  oracle(o);
  const [, retA] = adjustCounterAndPaintBcdHudFields(m);
  assert.equal(retA & 0xff, o.regs.a & 0xff, "sanity: module A matches the oracle");
  assert.notEqual((o.regs.a + 1) & 0xff, o.regs.a & 0xff, "the A live-out check must reject an off-by-one cursor");
  console.log(`  TEETH(A): module A ${hx(retA & 0xff)} == oracle; an off-by-one cursor is rejected`);
});
