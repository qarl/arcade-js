// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand00 (ROM 0x0ecf, Pooyan) — "enqueue sound command 0
 * (silence) into the sound-command ring". It sets A:=0 then tail-jumps into the ring-enqueue
 * helper (enqueueSoundCommandRing), which stores the command byte into the slot named by SOUND_RING_WRITE_PTR
 * (0x8a40, an index onto the page-0x8a00 ring) and advances that pointer, wrapping 0x5e->0x43.
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState,
 * minus stack scratch below the entry SP). The routine's live-out is MEMORY ONLY — the filled slot plus the
 * advanced write pointer. The oracle also leaves A==0 and its xor-a flags, but none of the
 * four callers (stampSecondScrollColumn/705f/0b32/7fd6) reads A or the flags back after the call (each
 * overwrites A or jumps away), so A/flags are not part of the contract and are not compared.
 *
 * Jobs:
 *   1. EQUAL (crafted) — the first slot, a middle slot, and the last slot (0x5e, the wrap):
 *      oracle == module in RAM (−stack).
 *   2. WRITE-SET — the only writes are the pointed slot := 0 and the advanced write pointer.
 *   3. TEETH — a wrong stored byte and a wrong advanced pointer are each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0ecf.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ecf as oracle } from "../../translated/loc_0ecf.js";
import { queueSoundCommand00 } from "../queueSoundCommand00.js";
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
const COMMAND = 0x00; // silence

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the ring tail seated and the target slot pre-dirtied. */
function craft(tail) {
  const m = BASE.clone();
  m.mem.write8(SOUND_RING_WRITE_PTR, tail);
  m.mem.write8(RING_BASE + tail, 0xaa); // pre-dirty so a store of 0 is observable
  m.regs.sp = 0x8ffe; // the helper's push/pop of BC/DE/HL and its ret land inside STACK_SCRATCH
  return m;
}

const advanced = (tail) => (tail === TAIL_LAST ? TAIL_FIRST : tail + 1);
const TAILS = [TAIL_FIRST, 0x50, TAIL_LAST];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted ring tails — queueSoundCommand00 == oracle in RAM (−stack)", () => {
  for (const tail of TAILS) {
    const o = craft(tail);
    const c = craft(tail);
    oracle(o);
    queueSoundCommand00(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `tail=${hx(tail)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${TAILS.length} crafted tails identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: writes are the pointed slot := 0 and the advanced write pointer", () => {
  const tail = TAILS[0];
  const slot = RING_BASE + tail;
  const footprint = new Set([slot, SOUND_RING_WRITE_PTR]);

  const m = craft(tail);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  assert.equal(changed.length, 2, `expected 2 writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(m.mem.read8(slot), COMMAND, "slot must hold the command byte");
  assert.equal(m.mem.read8(SOUND_RING_WRITE_PTR), advanced(tail), "write pointer advanced");
  console.log(`  WRITE-SET: slot ${hx(slot)} := 0, ptr -> ${hx(advanced(tail))} (2 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong stored byte is CAUGHT by the RAM diff", () => {
  const tail = TAILS[1];
  const slot = RING_BASE + tail;
  const o = craft(tail);
  const c = craft(tail);
  oracle(o);
  queueSoundCommand00(c);
  c.mem.write8(slot, 0x01); // BUG: the stored command must be 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored byte — it is worthless");
  assert.equal(d.addr, slot, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(slot): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced pointer is CAUGHT by the RAM diff", () => {
  const tail = TAILS[2]; // the wrap slot: correct advance is 0x43
  const o = craft(tail);
  const c = craft(tail);
  oracle(o);
  queueSoundCommand00(c);
  c.mem.write8(SOUND_RING_WRITE_PTR, (tail + 1) & 0xff); // BUG: 0x5e must wrap to 0x43, not 0x5f
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong write pointer — it is worthless");
  assert.equal(d.addr, SOUND_RING_WRITE_PTR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(ptr): wrap miss caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
