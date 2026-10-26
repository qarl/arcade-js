// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand01 (Pooyan) — "queue display command 0x01": load the fixed
 * command code and append it to the command ring through the shared append helper.
 *
 * Cycle-free memory-equivalence gate. The routine writes work RAM and tail-calls the append helper,
 * so each case runs on a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the A register live-out.
 *
 * A IS a live-out: the append helper leaves A = the advanced ring cursor on the append path and A = 0
 * on the gates-closed early return (AF is not restored while BC/DE/HL are), and callers read it. The
 * routine takes no input register; the append gates, cursor, and ring window are poked identically on
 * both sides, and the tail call pushes/pops in the dead stack.
 *
 * Jobs:
 *   1. EQUAL — gates closed, open via each gate, a mid cursor, and the wrap slot: module == oracle in
 *      RAM (−stack) and in A.
 *   2. WRITE-SET — gate-open writes {pending byte, ring cell, cursor}; gate-closed writes only the
 *      pending byte.
 *   3. TEETH — a corrupted appended byte, and a wrong A live-out, are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0ed2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ed2 as oracle } from "../../translated/loc_0ed2.js";
import { queueSoundCommand01 } from "../queueSoundCommand01.js";
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
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the append gates, cursor, ring window, and pending byte seated. */
function craft(active, mode, cursor) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, mode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.mem.write8(SOUND_RING_PENDING_BYTE, 0x00); // known start so WRITE-SET sees the stash
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.sp = 0x8ffe; // dead stack: the tail call's push/pop
  return m;
}

const CASES = [
  { name: "gate closed", active: 0, mode: 0, cursor: 0x50 },
  { name: "open via game-active, first slot", active: 1, mode: 0, cursor: RING_FIRST },
  { name: "open via play-mode, mid cursor", active: 0, mode: 1, cursor: 0x50 },
  { name: "open, wrap slot", active: 1, mode: 0, cursor: RING_LAST },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — queueSoundCommand01 == oracle in RAM (−stack) + A", () => {
  for (const { name, active, mode, cursor } of CASES) {
    const o = craft(active, mode, cursor);
    const c = craft(active, mode, cursor);
    oracle(o);
    const ret = queueSoundCommand01(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: A live-out mismatch`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `${name}: returned A must match the oracle`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: open writes {pending, ring cell, cursor}; closed writes only pending", () => {
  const open = craft(1, 0, RING_FIRST);
  const b0 = open.dumpState();
  oracle(open);
  const a1 = open.dumpState();
  const openSet = new Set();
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) openSet.add(open.stateOffsetToAddr(off));
  assert.equal(openSet.size, 3, `open expected 3 writes, got ${openSet.size}`);
  for (const cell of [SOUND_RING_PENDING_BYTE, RING_PAGE + RING_FIRST, SOUND_RING_WRITE_PTR]) {
    assert.ok(openSet.has(cell), `open missing a write at ${hx(cell)}`);
  }

  const shut = craft(0, 0, 0x50);
  const s0 = shut.dumpState();
  oracle(shut);
  const s1 = shut.dumpState();
  const shutChanged = [];
  for (let off = 0; off < s0.length; off++) if (s0[off] !== s1[off]) shutChanged.push(shut.stateOffsetToAddr(off));
  assert.deepEqual(shutChanged, [SOUND_RING_PENDING_BYTE], `closed must write only the pending byte, got ${shutChanged.map(hx)}`);
  console.log("  WRITE-SET: open -> 3 cells, closed -> pending only");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted appended byte is CAUGHT by the RAM diff", () => {
  const o = craft(1, 0, RING_FIRST);
  const c = craft(1, 0, RING_FIRST);
  oracle(o);
  queueSoundCommand01(c);
  const cell = RING_PAGE + RING_FIRST;
  c.mem.write8(cell, c.mem.read8(cell) ^ 0xff); // BUG: corrupt the appended byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong A live-out is CAUGHT by the live-out check", () => {
  const o = craft(1, 0, RING_FIRST);
  const c = craft(1, 0, RING_FIRST);
  oracle(o);
  const ret = queueSoundCommand01(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches the oracle");
  const broken = (ret + 1) & 0xff; // an off-by-one cursor is a plausible bug the check must reject
  assert.notEqual(broken, o.regs.a & 0xff, "the A live-out check must reject an off-by-one cursor");
  console.log(`  TEETH(A): module A ${hx(ret)} == oracle; ${hx(broken)} rejected`);
});
