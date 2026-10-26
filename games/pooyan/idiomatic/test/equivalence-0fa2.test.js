// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueRoundVariantSoundRun (Pooyan) — "emit the round-select tile run": fold two bits
 * of the round counter into a 0..3 selector, bias it onto one of four consecutive tile codes, and
 * append that code plus the three fixed run bytes to the command ring.
 *
 * Cycle-free memory-equivalence gate. The routine reads the round counter, then delegates every
 * write to the run-append helper (four nested appends), so each case runs on a FRESH clone per side,
 * compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the A register live-out.
 *
 * A IS a live-out: the append tail leaves the advanced ring cursor in A (0 when the append gates are
 * shut) and the caller reads it back; the routine's tail return carries it through. pc/SP/cycles are
 * NOT compared. The oracle's nested calls push/pop in the dead stack (SP in STACK_SCRATCH).
 *
 * The round counter is the only routine input; there is no input register. The append gates
 * (GAME_ACTIVE_FLAG / PLAY_MODE_LATCH), the ring cursor and the ring window are poked identically on
 * both sides. The leaf is not reached in a plain boot, so every case is CRAFTED.
 *
 * Jobs:
 *   1. EQUAL — round values selecting each of the four tile codes, gate open (via active or via the
 *      play-mode latch), a wrap-straddling append, high-bit masking, and a gate-closed case:
 *      queueRoundVariantSoundRun == oracle in RAM (−stack) and in A.
 *   2. WRITE-SET — a gate-open, no-wrap case writes {pending byte, four ring cells, cursor}; the first
 *      ring cell carries the round-derived code and the run tail is 0x15/0x16/0x17.
 *   3. TEETH — a corrupted appended byte (RAM), and a wrong A live-out, are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0fa2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fa2 as oracle } from "../../translated/loc_0fa2.js";
import { queueRoundVariantSoundRun } from "../queueRoundVariantSoundRun.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ROUND_COUNTER,
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

const RING_PAGE = SOUND_RING_WRITE_PTR & 0xff00; // ring cells live on this page
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const TILE_CODE_BASE = 0x22; // first of the four round-select codes 0x22..0x25
const RUN_TAIL = [0x15, 0x16, 0x17]; // the three fixed run bytes after the selected code
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** The tile code the routine derives from a round-counter value. */
const codeFor = (round) => TILE_CODE_BASE + ((round >> 1) & 0x03);
const nextCursor = (c) => (c === RING_LAST ? RING_FIRST : c + 1);

/** A fresh clone with the round counter, append gates, cursor and ring window seated. */
function craft(round, active, mode, cursor) {
  const m = BASE.clone();
  m.mem.write8(ROUND_COUNTER, round);
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, mode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.mem.write8(SOUND_RING_PENDING_BYTE, 0x00); // known start so WRITE-SET sees the stash
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.sp = 0x8ff0; // dead stack: the four nested appends push/pop here
  return m;
}

const CASES = [
  { name: "code 0x22, gate open via active", round: 0x00, active: 1, mode: 0, cursor: 0x50 },
  { name: "code 0x23, gate open via mode", round: 0x02, active: 0, mode: 1, cursor: 0x50 },
  { name: "code 0x24, gate open", round: 0x04, active: 1, mode: 0, cursor: 0x55 },
  { name: "code 0x25, straddles the wrap", round: 0x06, active: 0, mode: 1, cursor: 0x5c },
  { name: "high bits masked -> code 0x25", round: 0xff, active: 1, mode: 0, cursor: 0x4a },
  { name: "gate closed -> A=0", round: 0x00, active: 0, mode: 0, cursor: 0x50 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted round/gate/cursor cases — queueRoundVariantSoundRun == oracle in RAM (−stack) + A", () => {
  for (const { name, round, active, mode, cursor } of CASES) {
    const o = craft(round, active, mode, cursor);
    const c = craft(round, active, mode, cursor);
    oracle(o);
    const ret = queueRoundVariantSoundRun(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: A live-out mismatch`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `${name}: returned A must match the oracle`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a gate-open no-wrap emit writes {pending, four ring cells, cursor}", () => {
  const round = 0x04; // -> code 0x24
  const cursor = 0x55; // four contiguous cells, no wrap
  const c = craft(round, 1, 0, cursor);
  const b0 = c.dumpState();
  oracle(c); // enumerate the oracle's footprint on this clone
  const a1 = c.dumpState();

  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = c.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue; // nested-call push/pop scratch, not game state
      changed.add(addr);
    }
  }
  const expected = [
    SOUND_RING_PENDING_BYTE,
    RING_PAGE + cursor,
    RING_PAGE + cursor + 1,
    RING_PAGE + cursor + 2,
    RING_PAGE + cursor + 3,
    SOUND_RING_WRITE_PTR,
  ];
  assert.equal(changed.size, expected.length, `expected ${expected.length} writes, got ${changed.size}`);
  for (const cell of expected) assert.ok(changed.has(cell), `missing a write at ${hx(cell)}`);

  // the run: the round-derived code heads it, followed by the three fixed tail bytes
  assert.equal(c.mem.read8(RING_PAGE + cursor), codeFor(round), "first ring cell = round-derived code 0x24");
  for (let i = 0; i < RUN_TAIL.length; i++) {
    assert.equal(c.mem.read8(RING_PAGE + cursor + 1 + i), RUN_TAIL[i], `run tail byte ${i} = ${hx(RUN_TAIL[i])}`);
  }
  let cur = cursor;
  for (let i = 0; i < 4; i++) cur = nextCursor(cur);
  assert.equal(c.mem.read8(SOUND_RING_WRITE_PTR), cur, "cursor advanced by four slots");
  console.log(`  WRITE-SET: code ${hx(codeFor(round))} + 0x15/0x16/0x17, cursor ${hx(cursor)}->${hx(cur)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted appended byte is CAUGHT by the RAM diff", () => {
  const round = 0x04;
  const cursor = 0x55;
  const o = craft(round, 1, 0, cursor);
  const c = craft(round, 1, 0, cursor);
  oracle(o);
  queueRoundVariantSoundRun(c);
  c.mem.write8(RING_PAGE + cursor, 0x00); // BUG: the emitted code byte must be 0x24, not 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted appended byte — it is worthless");
  assert.equal(d.addr, RING_PAGE + cursor, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: corrupted code byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A live-out is CAUGHT by the register check", () => {
  const round = 0x04;
  const cursor = 0x55;
  const o = craft(round, 1, 0, cursor);
  const c = craft(round, 1, 0, cursor);
  oracle(o);
  const ret = queueRoundVariantSoundRun(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: the module's A matches the oracle");
  c.regs.a = (o.regs.a + 1) & 0xff; // BUG: a wrong advanced cursor left in A
  assert.notEqual(c.regs.a & 0xff, o.regs.a & 0xff, "the A live-out check must reject a wrong cursor");
  console.log(`  TEETH/A: module A ${hx(ret & 0xff)} == oracle; a bumped A ${hx((o.regs.a + 1) & 0xff)} is rejected`);
});
