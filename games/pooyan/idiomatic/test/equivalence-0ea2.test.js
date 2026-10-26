// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for appendSoundCommandGated (ROM 0x0ea2, Pooyan) — "append a byte into the
 * page-0x8a00 text ring". The incoming byte (A) is stashed at 0x8d20; the append then
 * runs only while GAME_ACTIVE_FLAG (0x8806) or PLAY_MODE_LATCH (0x8f50) is set. On
 * append it writes the byte at 0x8a00 + cursor (cursor = 0x8a40) and steps the cursor
 * 0x43..0x5e, wrapping 0x5e -> 0x43.
 *
 * This is the cycle-free memory-equivalence gate (docs/decompiler-pipeline). The routine
 * writes work RAM, so every case uses a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the A register live-out.
 *
 * A IS a live-out: the routine leaves A = the advanced cursor on the append path, and A = 0 on the
 * gates-closed early return (A survives because AF is not restored while BC/DE/HL are), and callers
 * read it — so the EQUAL job compares A in addition to RAM(−stack). The byte to append is the
 * incoming A, seated via the module's register-default bridge.
 *
 * Jobs:
 *   1. EQUAL (crafted) — gate-closed, gate-open via each flag, a mid cursor, and the
 *      0x5e->0x43 wrap: oracle == module in RAM (−stack).
 *   2. WRITE-SET — gate-open writes exactly {0x8d20, ring cell, 0x8a40}; gate-closed
 *      writes only 0x8d20.
 *   3. TEETH — a twin that writes the wrong ring byte, and a twin that fails to wrap the
 *      cursor, are both CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0ea2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ea2 as oracle } from "../../translated/loc_0ea2.js";
import { appendSoundCommandGated } from "../appendSoundCommandGated.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const LATCH = 0x8d20;
const CURSOR = 0x8a40;
const ACTIVE = 0x8806;
const MODE = 0x8f50;
const RING_PAGE = 0x8a00;
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with A seated and the gate/cursor/ring cells poked identically. */
function craft(a, active, mode, cursor) {
  const m = BASE.clone();
  m.regs.a = a & 0xff;
  m.mem.write8(ACTIVE, active);
  m.mem.write8(MODE, mode);
  m.mem.write8(CURSOR, cursor);
  m.mem.write8(LATCH, 0x00); // known start so the before/after WRITE-SET sees the latch write
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00); // clear the ring window
  m.regs.sp = 0x8ffe; // dead stack: the oracle's push/pop framing reads/writes excluded RAM
  return m;
}

const nextCursor = (c) => (c === RING_LAST ? RING_FIRST : c + 1);

const CASES = [
  { name: "gate closed", a: 0x41, active: 0, mode: 0, cursor: 0x50 },
  { name: "open via GAME_ACTIVE, first slot", a: 0x42, active: 1, mode: 0, cursor: RING_FIRST },
  { name: "open via PLAY_MODE, wrap slot", a: 0x43, active: 0, mode: 1, cursor: RING_LAST },
  { name: "open, mid cursor", a: 0x44, active: 1, mode: 0, cursor: 0x50 },
  { name: "both gates, second-to-last slot", a: 0x45, active: 1, mode: 1, cursor: 0x5d },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — appendSoundCommandGated == oracle in RAM (−stack)", () => {
  for (const { name, a, active, mode, cursor } of CASES) {
    const o = craft(a, active, mode, cursor);
    const c = craft(a, active, mode, cursor);
    oracle(o);
    appendSoundCommandGated(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    // A live-out: the oracle leaves A = advanced cursor (append) or 0 (gates closed); callers read it.
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: A live-out mismatch`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gate-open writes {0x8d20, ring cell, 0x8a40}; gate-closed writes only 0x8d20", () => {
  // gate-open
  const open = craft(0x42, 1, 0, RING_FIRST);
  const b0 = open.dumpState();
  oracle(open);
  const a1 = open.dumpState();
  const openChanged = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) openChanged.push(open.stateOffsetToAddr(off));
  }
  const openSet = new Set(openChanged);
  assert.equal(openChanged.length, 3, `gate-open expected 3 writes, got ${openChanged.length}`);
  for (const cell of [LATCH, RING_PAGE + RING_FIRST, CURSOR]) {
    assert.ok(openSet.has(cell), `gate-open missing a write at ${hx(cell)}`);
  }

  // gate-closed
  const shut = craft(0x41, 0, 0, 0x50);
  const s0 = shut.dumpState();
  oracle(shut);
  const s1 = shut.dumpState();
  const shutChanged = [];
  for (let off = 0; off < s0.length; off++) {
    if (s0[off] !== s1[off]) shutChanged.push(shut.stateOffsetToAddr(off));
  }
  assert.deepEqual(shutChanged, [LATCH], `gate-closed must write only 0x8d20, got ${shutChanged.map(hx)}`);
  console.log("  WRITE-SET: open -> 3 cells, closed -> only 0x8d20");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: appends the byte inverted. */
function brokenWrongByte(m, a = m.regs.a) {
  const cursor = m.mem.read8(CURSOR);
  m.mem.write8(LATCH, a);
  if (m.mem.read8(ACTIVE) === 0 && m.mem.read8(MODE) === 0) return;
  m.mem.write8(RING_PAGE + cursor, a ^ 0xff); // BUG: inverted byte
  m.mem.write8(CURSOR, nextCursor(cursor));
}

/** Broken twin: never wraps the cursor (0x5e -> 0x5f instead of 0x43). */
function brokenNoWrap(m, a = m.regs.a) {
  const cursor = m.mem.read8(CURSOR);
  m.mem.write8(LATCH, a);
  if (m.mem.read8(ACTIVE) === 0 && m.mem.read8(MODE) === 0) return;
  m.mem.write8(RING_PAGE + cursor, a);
  m.mem.write8(CURSOR, (cursor + 1) & 0xff); // BUG: no 0x5e -> 0x43 wrap
}

test("TEETH: a wrong appended byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x42, 1, 0, RING_FIRST);
  const c = craft(0x42, 1, 0, RING_FIRST);
  oracle(o);
  brokenWrongByte(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, RING_PAGE + RING_FIRST, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a missed cursor wrap is CAUGHT by the RAM diff", () => {
  const o = craft(0x43, 0, 1, RING_LAST);
  const c = craft(0x43, 0, 1, RING_LAST);
  oracle(o);
  brokenNoWrap(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missed cursor wrap — it is worthless");
  assert.equal(d.addr, CURSOR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(wrap): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
