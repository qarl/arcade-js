// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommands27And15 (ROM 0x0fb2, Pooyan) — "enqueue two sound commands":
 * enqueue 0x27 then 0x15 into the sound-command ring, each through the ring-enqueue helper that
 * stores the byte at RING_BASE + tail (tail = the write pointer at 0x8a40) and advances the tail,
 * wrapping 0x5e -> 0x43.
 *
 * Cycle-free gate: a fresh clone per side, compared on RAM (dumpState) minus stack scratch below the entry SP. The
 * live-out is MEMORY ONLY — two filled ring slots plus the twice-advanced write pointer. The
 * helper leaves the ring pointer in A, which enqueue sites reload, so A is not part of the
 * contract and is not compared. Every case is CRAFTED: the ring tail is poked identically on both
 * sides (the leaf never runs during a plain boot).
 *
 * Jobs:
 *   1. EQUAL — over several tails (incl. tails where the first or second enqueue wraps), oracle ==
 *      module in RAM (−stack).
 *   2. WRITE-SET — exactly three cells change: slot[tail] := 0x27, slot[tail+1] := 0x15, pointer
 *      := tail+2 (with wraps).
 *   3. TEETH — a wrong first stored byte and a wrong final pointer are each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0fb2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fb2 as oracle } from "../../translated/loc_0fb2.js";
import { queueSoundCommands27And15 } from "../queueSoundCommands27And15.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SOUND_RING_WRITE_PTR = 0x8a40;
const RING_BASE = 0x8a00; // slot address = RING_BASE + tail
const TAIL_FIRST = 0x43;
const TAIL_LAST = 0x5e;
const CMD_FIRST = 0x27;
const CMD_SECOND = 0x15;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const advanced = (tail) => (tail === TAIL_LAST ? TAIL_FIRST : tail + 1);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the ring tail seated and both target slots pre-dirtied. */
function craft(tail) {
  const m = BASE.clone();
  m.mem.write8(SOUND_RING_WRITE_PTR, tail);
  m.mem.write8(RING_BASE + tail, 0xaa);
  m.mem.write8(RING_BASE + advanced(tail), 0xaa);
  m.regs.sp = 0x8ffe; // the helper's push/pop of BC/DE/HL and its ret land inside STACK_SCRATCH
  return m;
}

// 0x5d exercises the wrap on the SECOND enqueue; 0x5e on the first.
const TAILS = [TAIL_FIRST, 0x50, 0x5d, TAIL_LAST];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted ring tails — queueSoundCommands27And15 == oracle in RAM (−stack)", () => {
  for (const tail of TAILS) {
    const o = craft(tail);
    const c = craft(tail);
    oracle(o);
    queueSoundCommands27And15(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `tail=${hx(tail)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${TAILS.length} crafted tails identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: slot[tail] := 0x27, slot[tail+1] := 0x15, pointer advanced twice", () => {
  const tail = 0x50;
  const slot0 = RING_BASE + tail;
  const slot1 = RING_BASE + advanced(tail);
  const footprint = new Set([slot0, slot1, SOUND_RING_WRITE_PTR]);

  const m = craft(tail);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  assert.equal(changed.length, 3, `expected 3 writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(m.mem.read8(slot0), CMD_FIRST, "first slot holds 0x27");
  assert.equal(m.mem.read8(slot1), CMD_SECOND, "second slot holds 0x15");
  assert.equal(m.mem.read8(SOUND_RING_WRITE_PTR), advanced(advanced(tail)), "pointer advanced twice");
  console.log(`  WRITE-SET: ${hx(slot0)}:=0x27, ${hx(slot1)}:=0x15, ptr -> ${hx(advanced(advanced(tail)))} (3 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong first stored byte is CAUGHT by the RAM diff", () => {
  const tail = 0x50;
  const slot0 = RING_BASE + tail;
  const o = craft(tail);
  const c = craft(tail);
  oracle(o);
  queueSoundCommands27And15(c);
  c.mem.write8(slot0, 0x00); // BUG: the first slot must hold 0x27
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored byte — it is worthless");
  assert.equal(d.addr, slot0, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(slot): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong final pointer is CAUGHT by the RAM diff", () => {
  const tail = TAIL_LAST; // first enqueue wraps -> second at 0x43 -> pointer ends 0x44
  const o = craft(tail);
  const c = craft(tail);
  oracle(o);
  queueSoundCommands27And15(c);
  c.mem.write8(SOUND_RING_WRITE_PTR, 0x00); // BUG: pointer must be advanced(advanced(0x5e)) = 0x44
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong write pointer — it is worthless");
  assert.equal(d.addr, SOUND_RING_WRITE_PTR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(ptr): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
