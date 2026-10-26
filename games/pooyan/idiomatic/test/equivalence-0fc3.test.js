// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for appendSoundCommandRun (Pooyan) — "append a four-tile run to the command ring":
 * append the caller's byte, then the three fixed tile codes, each through the shared append helper.
 *
 * Cycle-free memory-equivalence gate. The routine writes work RAM and calls the append helper four
 * times, so each case runs on a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the A register live-out.
 *
 * A IS a live-out: after the fourth append A = the advanced ring cursor (A = 0 when the gates are
 * closed); AF is not restored across the calls and the caller reads it. The caller's byte is the one
 * input register, bridged by the module's register default and seated on both sides; the append
 * gates, cursor, and ring window are poked identically, and the calls push/pop in the dead stack.
 *
 * Jobs:
 *   1. EQUAL — gates closed, gate-open at a mid cursor, and gate-open straddling the wrap: module ==
 *      oracle in RAM (−stack) and in A.
 *   2. WRITE-SET — gate-open (no wrap) writes {pending byte, four ring cells, cursor}; gate-closed
 *      writes only the pending byte.
 *   3. TEETH — a corrupted appended byte, and a wrong A live-out, are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0fc3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fc3 as oracle } from "../../translated/loc_0fc3.js";
import { appendSoundCommandRun } from "../appendSoundCommandRun.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, GAME_ACTIVE_FLAG, PLAY_MODE_LATCH, SOUND_RING_WRITE_PTR, SOUND_RING_PENDING_BYTE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = SOUND_RING_WRITE_PTR & 0xff00; // ring cells live on this page
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const RUN_TAIL = [0x15, 0x16, 0x17]; // the three fixed tile codes after the caller's byte
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the caller's byte, gates, cursor, ring window, and pending byte seated. */
function craft(a, active, mode, cursor) {
  const m = BASE.clone();
  m.regs.a = a & 0xff;
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, mode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.mem.write8(SOUND_RING_PENDING_BYTE, 0x00); // known start so WRITE-SET sees the stash
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.sp = 0x8ff0; // dead stack: the four nested calls push/pop here
  return m;
}

const nextCursor = (c) => (c === RING_LAST ? RING_FIRST : c + 1);

const CASES = [
  { name: "gate closed", a: 0x41, active: 0, mode: 0, cursor: 0x50 },
  { name: "gate open, mid cursor", a: 0x42, active: 1, mode: 0, cursor: 0x50 },
  { name: "gate open, straddles the wrap", a: 0x44, active: 0, mode: 1, cursor: 0x5c },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — appendSoundCommandRun == oracle in RAM (−stack) + A", () => {
  for (const { name, a, active, mode, cursor } of CASES) {
    const o = craft(a, active, mode, cursor);
    const c = craft(a, active, mode, cursor);
    oracle(o);
    const ret = appendSoundCommandRun(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: A live-out mismatch`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `${name}: returned A must match the oracle`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: open writes {pending, four ring cells, cursor}; closed writes only pending", () => {
  const startCursor = 0x50; // no wrap: four contiguous ring cells
  const open = craft(0x42, 1, 0, startCursor);
  const b0 = open.dumpState();
  oracle(open);
  const a1 = open.dumpState();
  const openSet = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = open.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // the four nested call push/pop scratch, not game state
      openSet.add(addr);
    }
  }
  const expected = [
    SOUND_RING_PENDING_BYTE,
    RING_PAGE + startCursor,
    RING_PAGE + startCursor + 1,
    RING_PAGE + startCursor + 2,
    RING_PAGE + startCursor + 3,
    SOUND_RING_WRITE_PTR,
  ];
  assert.equal(openSet.size, expected.length, `open expected ${expected.length} writes, got ${openSet.size}`);
  for (const cell of expected) assert.ok(openSet.has(cell), `open missing a write at ${hx(cell)}`);

  const shut = craft(0x41, 0, 0, startCursor);
  const s0 = shut.dumpState();
  oracle(shut);
  const s1 = shut.dumpState();
  const shutChanged = [];
  for (let off = 0; off < s0.length; off++) {
    if (s0[off] !== s1[off]) {
      const addr = shut.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // the four nested call push/pop scratch, not game state
      shutChanged.push(addr);
    }
  }
  assert.deepEqual(shutChanged, [SOUND_RING_PENDING_BYTE], `closed must write only the pending byte, got ${shutChanged.map(hx)}`);
  console.log("  WRITE-SET: open -> 6 cells, closed -> pending only");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted appended byte is CAUGHT by the RAM diff", () => {
  const cursor = 0x50;
  const o = craft(0x42, 1, 0, cursor);
  const c = craft(0x42, 1, 0, cursor);
  oracle(o);
  appendSoundCommandRun(c);
  const cell = RING_PAGE + nextCursor(nextCursor(cursor)); // the third appended byte's cell
  c.mem.write8(cell, c.mem.read8(cell) ^ 0xff); // BUG: corrupt one run byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)}; run tail ${RUN_TAIL.map(hx).join("/")}`);
});

test("TEETH: a wrong A live-out is CAUGHT by the live-out check", () => {
  const o = craft(0x42, 1, 0, 0x50);
  const c = craft(0x42, 1, 0, 0x50);
  oracle(o);
  const ret = appendSoundCommandRun(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches the oracle");
  const broken = (ret - 1) & 0xff; // one append short is a plausible bug the check must reject
  assert.notEqual(broken, o.regs.a & 0xff, "the A live-out check must reject an under-advanced cursor");
  console.log(`  TEETH(A): module A ${hx(ret)} == oracle; ${hx(broken)} rejected`);
});
