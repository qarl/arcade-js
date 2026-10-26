// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommands82And03 (ROM 0x0eda) — "queue two sound commands": enqueue command
 * 0x82 then 0x03 into the sound-command ring (slots HIGH_SCORE_TABLE+tail, tail at
 * SOUND_RING_WRITE_PTR, wrapping 0x5e -> 0x43) via the enqueue helper.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES work RAM, so every case
 * uses a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP/cycles are NOT compared. The contract is MEMORY ONLY: the enqueue helper round-trips
 * BC/DE/HL and its A leftover (the advanced tail) is not consumed — queueSoundCommands82And03's sole caller (advanceFallingEnemyAndTallyCatchOnLanding)
 * reloads HL and never reads A after the call — so no register live-out is declared or checked.
 * The one input is the ring tail cell, poked identically per side; the wrap edge is crafted.
 *
 * Jobs: 1. EQUAL over curated tails incl. the wrap edge; 2. WRITE-SET (two slots + the tail cell);
 * 3. CRAFTED (the wrap case in detail); 4. TEETH (a wrong enqueued byte).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0eda.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0eda as oracle } from "../../translated/loc_0eda.js";
import { queueSoundCommands82And03 } from "../queueSoundCommands82And03.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SOUND_RING_WRITE_PTR, HIGH_SCORE_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const CMD_A = 0x82;
const CMD_B = 0x03;
const RING_LAST = 0x5e;
const RING_FIRST = 0x43;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const slot = (tail) => (HIGH_SCORE_TABLE & 0xff00) + tail; // ring slot cell for a tail index
const nextTail = (tail) => (tail === RING_LAST ? RING_FIRST : tail + 1);

/** Fresh clone with the ring tail seated; optionally pre-dirty the two slots the commands land in. */
function craft(tail, dirtySlots) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  m.mem.write8(SOUND_RING_WRITE_PTR, tail);
  if (dirtySlots) {
    m.mem.write8(slot(tail), 0xaa);
    m.mem.write8(slot(nextTail(tail)), 0xaa);
  }
  return m;
}

// Curated tails: a normal run, mid-ring, the slot just before wrap, and the wrap slot itself.
const TAILS = [RING_FIRST, 0x50, RING_LAST - 1, RING_LAST];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: curated ring tails — queueSoundCommands82And03 == oracle in RAM (−stack)", () => {
  for (const tail of TAILS) {
    const o = craft(tail);
    const c = craft(tail);
    oracle(o);
    queueSoundCommands82And03(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (tail=${hx(tail)}): oracle=${d.a} idiom=${d.b}`);
  }
  console.log(`  EQUAL: ${TAILS.length} tails identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only writes are the two slots + the advanced tail", () => {
  const tail = RING_FIRST;
  const before = craft(tail, true);
  const after = craft(tail, true);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.set(after.stateOffsetToAddr(off), a1[off]);
  }
  const s0 = slot(tail), s1 = slot(nextTail(tail));
  assert.equal(changed.size, 3, `expected 3 writes (2 slots + tail), got ${changed.size}`);
  assert.equal(changed.get(s0), CMD_A, `slot ${hx(s0)} must hold 0x82`);
  assert.equal(changed.get(s1), CMD_B, `slot ${hx(s1)} must hold 0x03`);
  assert.equal(changed.get(SOUND_RING_WRITE_PTR), nextTail(nextTail(tail)), "tail advanced by two");
  console.log(`  WRITE-SET: ${hx(s0)}:=0x82, ${hx(s1)}:=0x03, tail ${hx(SOUND_RING_WRITE_PTR)}:=${hx(nextTail(nextTail(tail)))}`);
});

// -- 3. CRAFTED (wrap edge) ---------------------------------------------------

test("CRAFTED: at the last slot the tail wraps 0x5e -> 0x43 identically", () => {
  const o = craft(RING_LAST, true);
  const c = craft(RING_LAST, true);
  oracle(o);
  queueSoundCommands82And03(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(c.mem.read8(slot(RING_LAST)), CMD_A, "0x82 lands in the last slot");
  assert.equal(c.mem.read8(slot(RING_FIRST)), CMD_B, "0x03 lands in the first slot after wrap");
  assert.equal(c.mem.read8(SOUND_RING_WRITE_PTR), nextTail(RING_FIRST), "tail is one past the first slot");
  console.log(`  CRAFTED: last-slot wrap -> ${hx(slot(RING_LAST))}=0x82, ${hx(slot(RING_FIRST))}=0x03, tail=${hx(nextTail(RING_FIRST))}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong enqueued byte is CAUGHT by the RAM diff", () => {
  const tail = RING_FIRST;
  const o = craft(tail, true);
  const c = craft(tail, true);
  oracle(o);
  queueSoundCommands82And03(c);
  const bug = slot(nextTail(tail));
  c.mem.write8(bug, 0x00); // BUG: second slot must hold 0x03

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong enqueued byte — it is worthless");
  assert.equal(d.addr, bug, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(bug)})`);
  console.log(`  TEETH: wrong enqueued byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
