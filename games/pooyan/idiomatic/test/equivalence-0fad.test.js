// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundRun26 (ROM 0x0fad, Pooyan) — "queue the four-tile run opening
 * with tile code 0x26".
 *
 * The routine loads A := 0x26 and tail-calls the four-tile run emitter (appendSoundCommandRun), which appends
 * 0x26, 0x15, 0x16, 0x17 into the page-0x8a command ring through the shared appender (appendSoundCommandGated).
 * Each append is gated on a game being active or the play-mode latch being set; when both are
 * clear only the pending-byte cell is touched and A comes back 0.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). Each case runs the oracle on
 * one FRESH clone and queueSoundRun26 on another and compares:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  the declared register live-out (A).
 *
 * A — the advanced ring cursor — IS a genuine live-out: the flag/accumulator pair is not restored
 * across the tail, and a caller reads it out of the register, so it is asserted AND the module must
 * SET it on its own clone (a return-only rewrite would pass the ret check but fail the caller). pc/SP
 * are NOT compared (dropped call/stack ABI); SP is seated in the dead stack. The oracle dispatches
 * its m.call sub-routines through the TRANSLATED registry; queueSoundRun26 imports the idiomatic ones.
 *
 * Jobs:
 *   1. EQUAL — gates OPEN (game active: four tiles appended, cursor advanced) and gates CLOSED
 *      (only the pending byte written, A = 0) both agree in RAM(−stack) and in A, module SETTING A.
 *   2. WRITE-SET — with the cursor seeded to the ring start, the OPEN run's only writes are the four
 *      ring slots := 0x26/0x15/0x16/0x17, the advanced write pointer, and the pending-byte cell.
 *   3. TEETH — a wrong ring byte is caught by the RAM diff; an under-advanced returned A is rejected
 *      by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0fad.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fad as oracle } from "../../translated/loc_0fad.js";
import { queueSoundRun26 } from "../queueSoundRun26.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  SOUND_RING_WRITE_PTR,
  SOUND_RING_PENDING_BYTE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RUN_TILES = [0x26, 0x15, 0x16, 0x17]; // the leading tile then the three fixed run tiles
const RING_START = 0x43; // first ring slot (cursor low byte)
const RING_PAGE = SOUND_RING_WRITE_PTR & 0xff00; // the ring shares the pointer cell's page
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const DIRT = 0xff; // != every run tile, so each append is an observable change

/** A fresh clone with SP in the dead stack, the ring cursor at RING_START, and the append gates set. */
function craft(gatesOpen) {
  const m = BASE.clone();
  m.regs.sp = STACK_SCRATCH.hi;
  m.regs.a = 0xaa; // sentinel: a bridge that fails to SET A is caught
  m.mem.write8(GAME_ACTIVE_FLAG, gatesOpen ? 0x01 : 0x00);
  m.mem.write8(PLAY_MODE_LATCH, 0x00);
  m.mem.write8(SOUND_RING_WRITE_PTR, RING_START);
  m.mem.write8(SOUND_RING_PENDING_BYTE, DIRT);
  for (let i = 0; i < RUN_TILES.length; i++) m.mem.write8(RING_PAGE + RING_START + i, DIRT);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: queueSoundRun26 == oracle in RAM (−stack) + A, gates open and closed", () => {
  for (const gatesOpen of [true, false]) {
    const o = craft(gatesOpen);
    const c = craft(gatesOpen);
    oracle(o);
    const ret = queueSoundRun26(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `open=${gatesOpen}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `open=${gatesOpen}: A return matches oracle`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `open=${gatesOpen}: module must SET A for the caller`);
  }
  console.log("  EQUAL: gates open + closed identical (RAM −stack + A)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the OPEN run writes four ring slots, the write pointer, and the pending byte", () => {
  const before = craft(true);
  const after = craft(true);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.set(addr, a1[off]);
    }
  }
  for (let i = 0; i < RUN_TILES.length; i++) {
    const cell = RING_PAGE + RING_START + i;
    assert.equal(changed.get(cell), RUN_TILES[i], `ring slot ${hx(cell)} must hold ${hx(RUN_TILES[i])}`);
  }
  assert.equal(changed.get(SOUND_RING_WRITE_PTR), (RING_START + RUN_TILES.length) & 0xff, "write pointer advanced by four");
  assert.equal(changed.get(SOUND_RING_PENDING_BYTE), RUN_TILES[RUN_TILES.length - 1], "pending byte = last appended tile");
  assert.equal(changed.size, RUN_TILES.length + 2, `expected exactly ${RUN_TILES.length + 2} cells, got ${changed.size}`);
  console.log(`  WRITE-SET: 4 ring slots + write pointer + pending byte (${changed.size} cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong ring byte is CAUGHT by the RAM diff", () => {
  const o = craft(true);
  const c = craft(true);
  oracle(o);
  queueSoundRun26(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  const cell = RING_PAGE + RING_START + 2; // the third appended slot
  c.mem.write8(cell, 0x00); // BUG: this slot must hold 0x16
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH/RAM: wrong ring byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an under-advanced returned A is REJECTED by the live-out check", () => {
  const o = craft(true);
  const c = craft(true);
  oracle(o);
  const ret = queueSoundRun26(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: the module's A matches the oracle");
  // One append short (cursor advanced by three, not four) is a plausible bug the check must reject.
  assert.notEqual((RING_START + RUN_TILES.length - 1) & 0xff, o.regs.a & 0xff, "the check must reject an under-advanced A");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle; an under-advanced ${hx((RING_START + RUN_TILES.length - 1) & 0xff)} is rejected`);
});
