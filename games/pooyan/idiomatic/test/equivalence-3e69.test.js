// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedEnemyFromDescriptorAndEnterFlight (ROM 0x3e69, Pooyan) — the object state-11 handler for the
 * record based at IX. It decrements the frame timer (IX+0x11) and returns while it is still
 * counting. On expiry it follows the record's linked pointer (IX+0x14:0x15) two bytes in to a
 * descriptor whose first byte is a type: outside 5..6 it blanks the sprite band and stops;
 * in-range it seeds the object's position (IX+0x03..0x06, the +0x04 byte one less than the source),
 * clears the pointer high byte, advances the state (IX+0x02), and falls through into the state-12
 * in-flight mover.
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles are NOT compared, and there is NO register/flag live-out — a
 * table-dispatched handler whose whole result lives in the record's memory. The oracle's band-blank
 * and fall-through call/push/ret all land inside STACK_SCRATCH.
 *
 * All cases are CRAFTED: the record (and, for expiry cases, a 5-byte descriptor in work-RAM scratch)
 * is poked identically on both sides. Fall-through cases seat a free-flight (drift) record and IX+0x0e
 * non-zero so the animation tick just decrements the frame-hold — no valid animation stream needed.
 *
 * Jobs:
 *   1. EQUAL — timer-still-counting; expiry with an out-of-range type (below 5, at/above 7) -> band
 *      blank; expiry with an in-range type (5, 6) -> seed + fall-through: oracle == seedEnemyFromDescriptorAndEnterFlight in RAM.
 *   2. WRITE-SET — the timer-still-counting path writes exactly IX+0x11.
 *   3. TEETH — a wrong timer byte and a wrong state-advance byte are each caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3e69.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3e69 as oracle } from "../../translated/loc_3e69.js";
import { seedEnemyFromDescriptorAndEnterFlight } from "../seedEnemyFromDescriptorAndEnterFlight.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX_BASE = 0x8bc0; // isolated work-RAM record base (band 0x8bc0..0x8bd6), clear of the descriptor + stack
const SCRIPT_BASE = 0x8e00; // work-RAM scratch holding the crafted descriptor
const SCRIPT_LO = SCRIPT_BASE & 0xff;
const SCRIPT_HI = SCRIPT_BASE >> 8;
const TIMER = IX_BASE + 0x11;
const STATE = IX_BASE + 0x02;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record band cleared (or dirtied to make a band-blank observable), overrides applied,
 *  optional descriptor written to scratch. */
function craft(rec, desc, dirty = false) {
  const m = BASE.clone();
  for (let off = 0; off <= 0x17; off++) m.mem.write8(IX_BASE + off, dirty ? 0xaa : 0x00);
  for (const [off, val] of Object.entries(rec)) m.mem.write8(IX_BASE + Number(off), val & 0xff);
  if (desc) desc.forEach((b, i) => m.mem.write8(SCRIPT_BASE + i, b & 0xff));
  m.regs.ix = IX_BASE;
  m.regs.sp = 0x8fe0; // deep in STACK_SCRATCH: band-blank / fall-through push/call/ret stay inside
  return m;
}

// A free-flight (drift) record seat for the in-range fall-through: pointer -> the descriptor, hold
// non-zero (animation tick just decrements), drift mode (rec+0x01 bit0 clear, rec+0x08 bit0 clear).
const FREE_REC = {
  0x11: 0x01, 0x14: SCRIPT_LO, 0x15: SCRIPT_HI, 0x0e: 0x05,
  0x01: 0x00, 0x08: 0x00, 0x12: 0x08, 0x13: 0x10, 0x16: 0x00, 0x02: 0x03,
};
// descriptor: [pad, pad, type, x03, x04, x05, x06]; x06=0 keeps the free-mode land gate shut.
const POS = [0x40, 0x30, 0x50, 0x00];

const CASES = [
  { label: "timer still counting (ret, no descriptor)", rec: { 0x11: 0x03 }, desc: null, dirty: false },
  { label: "expiry, type 4 (below range) -> band blank", rec: { 0x11: 0x01, 0x14: SCRIPT_LO, 0x15: SCRIPT_HI }, desc: [0, 0, 0x04], dirty: true },
  { label: "expiry, type 7 (at/above range) -> band blank", rec: { 0x11: 0x01, 0x14: SCRIPT_LO, 0x15: SCRIPT_HI }, desc: [0, 0, 0x07], dirty: true },
  { label: "expiry, type 5 -> seed + fall-through (free drift)", rec: FREE_REC, desc: [0, 0, 0x05, ...POS], dirty: false },
  { label: "expiry, type 6 -> seed + fall-through (free drift)", rec: FREE_REC, desc: [0, 0, 0x06, ...POS], dirty: false },
  // pointer low byte 0xfe: two `inc l` steps wrap it to 0x00 with NO carry into the high byte, so the
  // descriptor is read from SCRIPT_BASE+0 (type at offset 0). Exercises the L-only increment.
  { label: "expiry, type 5, pointer low wraps (inc l, no carry)", rec: { ...FREE_REC, 0x14: 0xfe }, desc: [0x05, ...POS], dirty: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted timer/type cases — seedEnemyFromDescriptorAndEnterFlight == oracle in RAM (−stack)", () => {
  for (const { label, rec, desc, dirty } of CASES) {
    const o = craft(rec, desc, dirty);
    const c = craft(rec, desc, dirty);
    oracle(o);
    seedEnemyFromDescriptorAndEnterFlight(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the timer-still-counting path writes exactly IX+0x11", () => {
  const { rec } = CASES[0];
  const m = craft(rec, null, false);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
  }
  assert.deepEqual(changed, [TIMER], `unexpected write footprint: ${changed.map(hx).join(",")}`);
  assert.equal(m.mem.read8(TIMER), 0x02, "timer decremented 0x03 -> 0x02");
  console.log(`  WRITE-SET: timer-still-counting touches only ${hx(TIMER)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong timer byte is CAUGHT by the RAM diff", () => {
  const { rec } = CASES[0];
  const o = craft(rec, null, false);
  const c = craft(rec, null, false);
  oracle(o);
  seedEnemyFromDescriptorAndEnterFlight(c);
  c.mem.write8(TIMER, 0xee); // BUG: the timer must be the decremented value
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong timer byte — it is worthless");
  assert.equal(d.addr, TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/timer: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong state-advance byte (in-range fall-through) is CAUGHT by the RAM diff", () => {
  const { rec, desc } = CASES[3]; // type 5 -> state IX+0x02 advanced 0x03 -> 0x04
  const o = craft(rec, desc, false);
  const c = craft(rec, desc, false);
  oracle(o);
  seedEnemyFromDescriptorAndEnterFlight(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: the fall-through path is RAM-equal before the twin breaks it");
  assert.equal(c.mem.read8(STATE), 0x04, "sanity: the state byte was advanced to 0x04");
  c.mem.write8(STATE, 0x00); // BUG: clobber the advanced state
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong state byte — it is worthless");
  assert.equal(d.addr, STATE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/state: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
