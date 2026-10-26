// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueHitSound (ROM 0x5f02, Pooyan) — "enqueue the fixed sound-effect
 * command, then return". A trampoline that defers to the sound-command enqueue entry, whose only
 * effect is to store one fixed command byte (0x05) into the sound-command ring slot named by the
 * write pointer (0x8a40), then advance that pointer, wrapping the last slot (0x5e) to the first
 * (0x43).
 *
 * Cycle-free memory-equivalence gate (docs/decompiler-pipeline). Each case runs the oracle on one
 * FRESH clone and the module on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * There is NO register live-out: the enqueue helper round-trips BC/DE/HL and every use site reloads
 * A, so A is not a consumed live-out (the sound-ring modules established this). The write pointer is
 * the only input and is poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — a mid cursor, the last slot (wrap), and the first slot: module == oracle in RAM (−stack).
 *   2. WRITE-SET — the writes are exactly {the ring slot := 0x05, the advanced write pointer}.
 *   3. TEETH — a corrupted enqueued slot byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5f02.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5f02 as oracle } from "../../translated/loc_5f02.js";
import { queueHitSound } from "../queueHitSound.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SOUND_RING_WRITE_PTR, HIGH_SCORE_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = HIGH_SCORE_TABLE; // sound-ring slots live on this page (0x8a00)
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const SOUND_CMD = 0x05; // the fixed command this entry enqueues
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the ring write pointer seated and every ring slot cleared. */
function craft(cursor) {
  const m = BASE.clone();
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.sp = 0x8ff0; // dead stack: the call chain's push/pop land here
  return m;
}

const nextCursor = (c) => (c === RING_LAST ? RING_FIRST : c + 1);
const CASES = [
  { name: "mid cursor", cursor: 0x50 },
  { name: "last slot (wrap)", cursor: 0x5e },
  { name: "first slot", cursor: 0x43 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted cursors — queueHitSound == oracle in RAM (−stack)", () => {
  for (const { name, cursor } of CASES) {
    const o = craft(cursor);
    const c = craft(cursor);
    oracle(o);
    queueHitSound(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} cursors identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: writes are exactly {ring slot := 0x05, advanced write pointer}", () => {
  const cursor = 0x50;
  const m = craft(cursor);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the call chain's push/pop scratch, not game state
    changed.push({ addr, to: a1[off] });
  }
  const addrs = new Set(changed.map((ch) => ch.addr));
  assert.equal(changed.length, 2, `expected 2 writes, got ${changed.length}`);
  assert.ok(addrs.has(RING_PAGE + cursor), `expected the ring slot write at ${hx(RING_PAGE + cursor)}`);
  assert.ok(addrs.has(SOUND_RING_WRITE_PTR), "expected the write-pointer advance");
  assert.equal(m.mem.read8(RING_PAGE + cursor), SOUND_CMD, "ring slot must hold the fixed command");
  assert.equal(m.mem.read8(SOUND_RING_WRITE_PTR), nextCursor(cursor), "write pointer advanced");
  console.log(`  WRITE-SET: slot ${hx(RING_PAGE + cursor)} := ${hx(SOUND_CMD)}, ptr -> ${hx(nextCursor(cursor))}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted enqueued slot byte is CAUGHT by the RAM diff", () => {
  const cursor = 0x5e; // exercise the wrap slot
  const o = craft(cursor);
  const c = craft(cursor);
  oracle(o);
  queueHitSound(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  const cell = RING_PAGE + cursor;
  c.mem.write8(cell, c.mem.read8(cell) ^ 0xff); // BUG: corrupt the enqueued command
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong enqueued byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
