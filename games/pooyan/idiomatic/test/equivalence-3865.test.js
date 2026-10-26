// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorStateOnTimerWithTamperCheck (ROM 0x3865) — "actor state handler with embedded tamper check".
 *
 * The cycle-free / memory-equivalence gate: oracle and module run on fresh clones and are
 * compared on RAM (dumpState, minus stack scratch below the entry SP) — the input register IX is seated
 * identically on both. pc/SP/cycles are not compared. The routine leaves no register a caller
 * reads (a dispatched handler), so the contract is memory only.
 *
 * The leaf is not reached in a plain boot/attract, so every case is CRAFTED: IX is pointed at
 * a record whose fields are poked, the frame gate is set, and the record's animation hold is
 * left non-zero so the animation player takes its decrement-and-return path deterministically.
 * The backward ROM sum reads fixed ROM, so both sides fold it identically.
 *
 * Jobs:
 *   1. EQUAL — timer-running, out-of-band by high byte, out-of-band by low byte, in-band with
 *      the frame gate closed, and the full checksum path: oracle == advanceActorStateOnTimerWithTamperCheck in RAM (−stack).
 *   2. WRITE-SET — the frame-gate-closed case writes only the six record fields it touches.
 *   3. TEETH — a wrong record field is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3865.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3865 as oracle } from "../../translated/loc_3865.js";
import { advanceActorStateOnTimerWithTamperCheck } from "../advanceActorStateOnTimerWithTamperCheck.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPRITE_OBJECT_TABLE, FRAME_COUNTER, SIGNATURE_MISMATCH_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

// A record with its animation hold (+0x0e) non-zero so the animation player just decrements it.
function craft(ix, fields, frame) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  m.regs.ix = ix;
  m.mem8[SIGNATURE_MISMATCH_FLAG] = 0; // observable/deterministic tamper counter
  m.mem8[FRAME_COUNTER] = frame;
  for (const [off, val] of fields) m.mem8[ix + off] = val;
  return m;
}

const IN_BAND = SPRITE_OBJECT_TABLE; // 0x8b70: high>=0x8b and low>=0x70
const LOW_SHORT = (SPRITE_OBJECT_TABLE & 0xff00) | 0x6f; // 0x8b6f: high ok, low short
const HIGH_SHORT = 0x8a80; // high byte below the band

const BASE_FIELDS = [[0x0e, 0x05], [0x02, 0x20], [0x08, 0x0f], [0x04, 0x10], [0x06, 0x10]];

const CASES = [
  { name: "timer running", ix: IN_BAND, fields: [[0x11, 0x03], ...BASE_FIELDS], frame: 0x00 },
  { name: "out-of-band (high byte short)", ix: HIGH_SHORT, fields: [[0x11, 0x01], ...BASE_FIELDS], frame: 0x00 },
  { name: "out-of-band (low byte short)", ix: LOW_SHORT, fields: [[0x11, 0x01], ...BASE_FIELDS], frame: 0x00 },
  { name: "in-band, frame gate closed", ix: IN_BAND, fields: [[0x11, 0x01], ...BASE_FIELDS], frame: 0x01 },
  { name: "full checksum path (frame gate open)", ix: IN_BAND, fields: [[0x11, 0x01], ...BASE_FIELDS], frame: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted record/gate states — advanceActorStateOnTimerWithTamperCheck == oracle in RAM (−stack)", () => {
  for (const { name, ix, fields, frame } of CASES) {
    const o = craft(ix, fields, frame);
    const c = craft(ix, fields, frame);
    oracle(o);
    advanceActorStateOnTimerWithTamperCheck(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (${name})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: frame-gate-closed path writes only the six touched record fields", () => {
  const ix = IN_BAND;
  const fields = [[0x11, 0x01], ...BASE_FIELDS];
  const before = craft(ix, fields, 0x01);
  const after = craft(ix, fields, 0x01);
  const b = before.dumpState();
  oracle(after);
  const a = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b.length; off++) {
    if (b[off] === a[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // exclude the oracle's own push/pop scratch (matches EQUAL's ramDiffMinusStack)
    changed.add(addr);
  }
  const expected = new Set([ix + 0x0e, ix + 0x11, ix + 0x02, ix + 0x08, ix + 0x04, ix + 0x06]);
  for (const addr of changed) assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(after.mem8[ix + 0x11], 0x00, "timer decremented to 0");
  assert.equal(after.mem8[ix + 0x02], 0x21, "sub-state advanced");
  assert.equal(after.mem8[ix + 0x08], 0x0e, "status bit0 cleared");
  assert.equal(after.mem8[ix + 0x0e], 0x04, "animation hold decremented");
  assert.equal(after.mem8[SIGNATURE_MISMATCH_FLAG], 0x00, "no tamper write when the frame gate is closed");
  console.log(`  WRITE-SET: ${[...changed].map(hx).join("/")}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong record field is CAUGHT by the RAM diff", () => {
  const ix = IN_BAND;
  const fields = [[0x11, 0x01], ...BASE_FIELDS];
  const o = craft(ix, fields, 0x01);
  const c = craft(ix, fields, 0x01);
  oracle(o);
  advanceActorStateOnTimerWithTamperCheck(c);
  c.mem8[ix + 0x02] = 0x20; // BUG: sub-state must advance to 0x21

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record field");
  assert.equal(d.addr, ix + 0x02, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong record field caught at ${hx(d.addr)}`);
});
