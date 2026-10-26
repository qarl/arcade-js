// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommands19And15 (ROM 0x0f6c) — "enqueue sound commands 0x19 then 0x15".
 *
 * The cycle-free / memory-equivalence gate: oracle and module run on fresh clones and are
 * compared on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are not compared.
 *
 * LIVE-OUT: memory only — the two filled ring slots and the advanced write pointer. The
 * enqueuer clobbers A but every enqueue site reloads it (established for the sibling enqueueSoundCommandRing),
 * so A is not part of the contract and is not compared.
 *
 * The leaf is not reached in a plain boot/attract, so every case is CRAFTED: the ring write
 * pointer (and the touched slots) are poked identically on both clones, spanning the wrap.
 *
 * Jobs:
 *   1. EQUAL — over crafted write-pointer positions oracle == queueSoundCommands19And15 in RAM (−stack).
 *   2. WRITE-SET — the only writes are the two enqueued ring slots (:= 0x19, 0x15) and the
 *      advanced write pointer.
 *   3. TEETH — a wrong enqueued byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f6c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f6c as oracle } from "../../translated/loc_0f6c.js";
import { queueSoundCommands19And15 } from "../queueSoundCommands19And15.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SOUND_RING_WRITE_PTR, HIGH_SCORE_TABLE } from "../names.js";

const RING_BASE = HIGH_SCORE_TABLE; // the sound-command ring shares the page-0x8a00 base
const CMD_FIRST = 0x19;
const CMD_SECOND = 0x15;
const LAST_SLOT = 0x5e;
const FIRST_SLOT = 0x43;

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
const next = (slot) => (slot === LAST_SLOT ? FIRST_SLOT : slot + 1);

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(tail) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  m.mem8[SOUND_RING_WRITE_PTR] = tail;
  m.mem8[RING_BASE + tail] = 0x00; // clear the two slots the enqueues will fill
  m.mem8[RING_BASE + next(tail)] = 0x00;
  return m;
}

const TAILS = [0x43, 0x50, 0x5d, 0x5e]; // includes the two wrap-adjacent positions

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted write-pointer positions — queueSoundCommands19And15 == oracle in RAM (−stack)", () => {
  for (const tail of TAILS) {
    const o = craft(tail);
    const c = craft(tail);
    oracle(o);
    queueSoundCommands19And15(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (tail=${hx(tail)})`);
  }
  console.log(`  EQUAL: ${TAILS.length} crafted tail positions identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: only the two ring slots (0x19,0x15) and the write pointer change", () => {
  const tail = 0x5d; // straddles the wrap: slot 0x5d then 0x5e, pointer -> 0x43
  const before = craft(tail);
  const after = craft(tail);
  const b = before.dumpState();
  oracle(after);
  const a = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b.length; off++) if (b[off] !== a[off]) changed.add(after.stateOffsetToAddr(off));
  const expected = new Set([RING_BASE + 0x5d, RING_BASE + 0x5e, SOUND_RING_WRITE_PTR]);
  for (const addr of changed) assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(after.mem8[RING_BASE + 0x5d], CMD_FIRST, "first slot := 0x19");
  assert.equal(after.mem8[RING_BASE + 0x5e], CMD_SECOND, "second slot := 0x15");
  assert.equal(after.mem8[SOUND_RING_WRITE_PTR], FIRST_SLOT, "write pointer wrapped to 0x43");
  console.log(`  WRITE-SET: ${[...changed].map(hx).join("/")}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong enqueued byte is CAUGHT by the RAM diff", () => {
  const tail = 0x50;
  const o = craft(tail);
  const c = craft(tail);
  oracle(o);
  queueSoundCommands19And15(c);
  c.mem8[RING_BASE + tail] = 0x00; // BUG: first slot must be 0x19

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong enqueued byte");
  assert.equal(d.addr, RING_BASE + tail, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong enqueued byte caught at ${hx(d.addr)}`);
});
