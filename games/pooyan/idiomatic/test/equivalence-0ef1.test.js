// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand05 (ROM 0x0ef1) — "enqueue sound command 0x05":
 * store the fixed command byte into the sound-command ring at the write pointer and advance
 * that pointer (wrapping the last slot to the first).
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared.
 * There is NO register live-out: the frozen enqueue helper leaves an internal ring-pointer
 * value in A, but every enqueue site reloads A before use, so A is not part of the contract
 * and is deliberately excluded (the idiomatic form never writes A).
 *
 * All cases are CRAFTED: the write pointer (0x8a40) is the only input, poked identically on
 * both sides. The oracle push/pops BC/DE/HL and rets, all inside STACK_SCRATCH.
 *
 * Jobs:
 *   1. EQUAL — over a sweep of write-pointer values, oracle == queueSoundCommand05 in RAM (−stack).
 *   2. WRITE-SET — the only writes are the ring slot (:= 0x05) and the advanced pointer.
 *   3. CRAFTED — a pre-dirtied slot is overwritten to 0x05.
 *   4. TEETH — a wrong slot byte MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0ef1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ef1 as oracle } from "../../translated/loc_0ef1.js";
import { queueSoundCommand05 } from "../queueSoundCommand05.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SOUND_RING_WRITE_PTR, HIGH_SCORE_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SOUND_COMMAND = 0x05; // the byte this entry point enqueues
const RING_LAST = 0x5e; // last ring slot; the write pointer wraps back to the first
const RING_FIRST = 0x43;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the ring write pointer seated. */
function craft(ptr) {
  const m = BASE.clone();
  m.mem.write8(SOUND_RING_WRITE_PTR, ptr & 0xff);
  m.regs.sp = 0x8ff0; // in STACK_SCRATCH; the oracle's push/pop/ret stay inside it
  return m;
}

const nextPtr = (ptr) => (ptr === RING_LAST ? RING_FIRST : ptr + 1);
const PTRS = [RING_FIRST, 0x50, 0x5d, RING_LAST];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted write pointers — queueSoundCommand05 == oracle in RAM (−stack)", () => {
  for (const ptr of PTRS) {
    const o = craft(ptr);
    const c = craft(ptr);
    oracle(o);
    queueSoundCommand05(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (ptr=${hx(ptr)})`);
  }
  console.log(`  EQUAL: ${PTRS.length} crafted write-pointer cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the only writes are the ring slot := 0x05 and the advanced pointer", () => {
  const ptr = 0x50;
  const before = craft(ptr);
  const after = craft(ptr);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (b0[off] !== a1[off] && !inDeadStack(addr)) changed.push({ addr, from: b0[off], to: a1[off] });
  }
  const byAddr = new Map(changed.map((ch) => [ch.addr, ch]));
  assert.equal(changed.length, 2, `expected exactly 2 writes, got ${changed.length}`);
  assert.equal(byAddr.get(HIGH_SCORE_TABLE + ptr)?.to, SOUND_COMMAND, "ring slot must be 0x05");
  assert.equal(byAddr.get(SOUND_RING_WRITE_PTR)?.to, nextPtr(ptr), "write pointer must advance");
  console.log(`  WRITE-SET: slot ${hx(HIGH_SCORE_TABLE + ptr)} := 0x05, ptr := ${hx(nextPtr(ptr))}`);
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: a pre-dirtied ring slot is overwritten to 0x05", () => {
  const ptr = RING_LAST; // also exercises the wrap-to-first advance
  const slot = HIGH_SCORE_TABLE + ptr;
  const o = craft(ptr);
  const c = craft(ptr);
  o.mem.write8(slot, 0xaa);
  c.mem.write8(slot, 0xaa);
  oracle(o);
  queueSoundCommand05(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}`);
  assert.equal(c.mem.read8(slot), SOUND_COMMAND, "slot overwritten to 0x05");
  assert.equal(c.mem.read8(SOUND_RING_WRITE_PTR), RING_FIRST, "pointer wrapped to first slot");
  console.log(`  CRAFTED: slot ${hx(slot)} 0xAA -> 0x05, ptr wrapped to ${hx(RING_FIRST)}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong ring-slot byte is CAUGHT by the RAM diff", () => {
  const ptr = 0x50;
  const slot = HIGH_SCORE_TABLE + ptr;
  const o = craft(ptr);
  const c = craft(ptr);
  oracle(o);
  queueSoundCommand05(c);
  c.mem.write8(slot, 0x00); // BUG: the slot must be 0x05, not 0x00
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring-slot byte — it is worthless");
  assert.equal(d.addr, slot, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong slot byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
