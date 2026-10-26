// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundRun1D (ROM 0x0f92, Pooyan) — "queue the phase-exhausted tile
 * run": supply the fixed lead tile 0x1d and tail into the four-tile run appender (appendSoundCommandRun),
 * which appends the lead then the three fixed tile codes 0x15/0x16/0x17 through the shared ring
 * helper (appendSoundCommandGated). Each append stashes the byte and (only while a game is active OR the
 * play-mode latch is set) writes it into the page-0x8a command ring at the cursor, wrapping the
 * last slot (0x5e) back to the first (0x43).
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) PLUS the A register. A is left as the advanced ring cursor by the tail-call (0
 * when the gates are closed); the immediate caller reloads A before reading it, so it is set but
 * not consumed — compared here defensively (it always matches, so it cannot false-fail) to pin
 * the tail-call's result to the four-append value.
 *
 * queueSoundRun1D supplies its own lead tile, so nothing is seated but the two append gates
 * (GAME_ACTIVE_FLAG, PLAY_MODE_LATCH), the ring cursor (SOUND_RING_WRITE_PTR), the pending-byte
 * cell, and the ring window — all poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — gates closed, gate-open at a mid cursor, and gate-open straddling the wrap:
 *      module == oracle in RAM (−stack) and in A.
 *   2. WRITE-SET — gate-open writes {pending byte, four ring cells, cursor}; gate-closed writes
 *      only the pending byte.
 *   3. TEETH — a corrupted appended byte and a wrong A are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f92.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f92 as oracle } from "../../translated/loc_0f92.js";
import { queueSoundRun1D } from "../queueSoundRun1D.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const GAME_ACTIVE_FLAG = 0x8806;
const PLAY_MODE_LATCH = 0x8f50;
const SOUND_RING_WRITE_PTR = 0x8a40;
const SOUND_RING_PENDING_BYTE = 0x8d20;
const RING_PAGE = 0x8a00;
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const APPENDED = [0x1d, 0x15, 0x16, 0x17]; // the lead tile then the three fixed run codes

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the gates, ring cursor, pending byte, and ring window seated. */
function craft(active, mode, cursor) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, mode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.mem.write8(SOUND_RING_PENDING_BYTE, 0x00);
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.sp = 0x8ff0; // dead stack: the nested appends push/pop here
  return m;
}

const nextCursor = (c) => (c === RING_LAST ? RING_FIRST : c + 1);

const CASES = [
  { name: "gate closed", active: 0, mode: 0, cursor: 0x50 },
  { name: "gate open, mid cursor", active: 1, mode: 0, cursor: 0x50 },
  { name: "gate open, straddles the wrap", active: 0, mode: 1, cursor: 0x5c },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — queueSoundRun1D == oracle in RAM (−stack) + A", () => {
  for (const { name, active, mode, cursor } of CASES) {
    const o = craft(active, mode, cursor);
    const c = craft(active, mode, cursor);
    oracle(o);
    const ret = queueSoundRun1D(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: A mismatch`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `${name}: returned A must match the oracle`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: open writes {pending, four ring cells, cursor}; closed writes only pending", () => {
  const startCursor = 0x50; // no wrap: four contiguous ring cells
  const open = craft(1, 0, startCursor);
  const b0 = open.dumpState();
  oracle(open);
  const a1 = open.dumpState();
  const openSet = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = open.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // the nested appends' push/pop scratch, not game state
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

  const shut = craft(0, 0, startCursor);
  const s0 = shut.dumpState();
  oracle(shut);
  const s1 = shut.dumpState();
  const shutChanged = [];
  for (let off = 0; off < s0.length; off++) {
    if (s0[off] !== s1[off]) {
      const addr = shut.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue;
      shutChanged.push(addr);
    }
  }
  assert.deepEqual(shutChanged, [SOUND_RING_PENDING_BYTE], `closed must write only the pending byte, got ${shutChanged.map(hx)}`);
  console.log("  WRITE-SET: open -> 6 cells, closed -> pending only");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted appended byte is CAUGHT by the RAM diff", () => {
  const cursor = 0x50;
  const o = craft(1, 0, cursor);
  const c = craft(1, 0, cursor);
  oracle(o);
  queueSoundRun1D(c);
  const cell = RING_PAGE + nextCursor(nextCursor(cursor)); // the third appended byte's cell
  c.mem.write8(cell, c.mem.read8(cell) ^ 0xff); // BUG: corrupt one run byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)}; appended run ${APPENDED.map(hx).join("/")}`);
});

test("TEETH: a wrong A is CAUGHT by the live-out check", () => {
  const o = craft(1, 0, 0x50);
  const c = craft(1, 0, 0x50);
  oracle(o);
  const ret = queueSoundRun1D(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches the oracle");
  const broken = (ret - 1) & 0xff; // one append short is a plausible bug the check must reject
  assert.notEqual(broken, o.regs.a & 0xff, "the A check must reject an under-advanced cursor");
  console.log(`  TEETH(A): module A ${hx(ret)} == oracle; ${hx(broken)} rejected`);
});
