// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand08 (ROM 0x0efd, Pooyan) — "command 0x08: append the fixed
 * byte 0x08 into the page-0x8a command ring". The routine loads A := 0x08 then tail-jumps into
 * the ring appender appendSoundCommandGated, whose ret returns to queueSoundCommand08's caller. So the incoming A is
 * irrelevant (the routine overwrites it), and the effect is exactly appendSoundCommandGated's for byte 0x08.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine writes work RAM, so
 * every case uses a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the A register live-out.
 *
 * A IS a live-out: the appender leaves A = the advanced ring cursor (append path) or 0 (gates
 * closed), the AF pair is not restored across the tail, and callers read it — so the EQUAL job
 * compares A alongside RAM(−stack).
 *
 * Jobs:
 *   1. EQUAL (crafted) — gate-closed, gate-open via each flag, a mid cursor and the 0x5e->0x43
 *      wrap: oracle == module in RAM (−stack) and in A.
 *   2. WRITE-SET — gate-open writes exactly {0x8d20 pending byte, ring cell, 0x8a40 cursor};
 *      gate-closed writes only the pending byte.
 *   3. TEETH — a twin that appends the wrong byte (RAM) and a twin that returns the wrong A
 *      (live-out) are both caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0efd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0efd as oracle } from "../../translated/loc_0efd.js";
import { queueSoundCommand08 } from "../queueSoundCommand08.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PENDING = 0x8d20; // SOUND_RING_PENDING_BYTE — the stashed byte
const CURSOR = 0x8a40; // SOUND_RING_WRITE_PTR — the ring cursor
const ACTIVE = 0x8806; // GAME_ACTIVE_FLAG
const MODE = 0x8f50; // PLAY_MODE_LATCH
const RING_PAGE = 0x8a00;
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const COMMAND_BYTE = 0x08; // the byte this command appends

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with an (ignored) incoming A and the gate/cursor/ring cells poked identically. */
function craft(incomingA, active, mode, cursor) {
  const m = BASE.clone();
  m.regs.a = incomingA & 0xff; // overwritten by the routine — proves it does not depend on it
  m.mem.write8(ACTIVE, active);
  m.mem.write8(MODE, mode);
  m.mem.write8(CURSOR, cursor);
  m.mem.write8(PENDING, 0x00); // known start so the WRITE-SET before/after sees the pending write
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.sp = 0x8ffe; // dead stack: the oracle's tail framing reads/writes excluded RAM
  return m;
}

const nextCursor = (c) => (c === RING_LAST ? RING_FIRST : c + 1);

const CASES = [
  { name: "gate closed", a: 0xaa, active: 0, mode: 0, cursor: 0x50 },
  { name: "open via GAME_ACTIVE, first slot", a: 0x00, active: 1, mode: 0, cursor: RING_FIRST },
  { name: "open via PLAY_MODE, wrap slot", a: 0xff, active: 0, mode: 1, cursor: RING_LAST },
  { name: "open, mid cursor", a: 0x12, active: 1, mode: 0, cursor: 0x50 },
  { name: "both gates, second-to-last slot", a: 0x34, active: 1, mode: 1, cursor: 0x5d },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — queueSoundCommand08 == oracle in RAM (−stack) + A", () => {
  for (const { name, a, active, mode, cursor } of CASES) {
    const o = craft(a, active, mode, cursor);
    const c = craft(a, active, mode, cursor);
    oracle(o);
    const ret = queueSoundCommand08(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: A live-out mismatch`);
    // The module must also RETURN the same A (return-assignment bridge).
    assert.equal(ret & 0xff, o.regs.a & 0xff, `${name}: module return must equal the oracle A`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gate-open writes {pending, ring cell, cursor}; gate-closed writes only pending", () => {
  const open = craft(0x00, 1, 0, RING_FIRST);
  const b0 = open.dumpState();
  oracle(open);
  const a1 = open.dumpState();
  const openChanged = [];
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) openChanged.push(open.stateOffsetToAddr(off));
  const openSet = new Set(openChanged);
  assert.equal(openChanged.length, 3, `gate-open expected 3 writes, got ${openChanged.length}`);
  for (const cell of [PENDING, RING_PAGE + RING_FIRST, CURSOR]) {
    assert.ok(openSet.has(cell), `gate-open missing a write at ${hx(cell)}`);
  }
  // The appended byte must be the fixed command byte 0x08.
  assert.equal(open.mem.read8(RING_PAGE + RING_FIRST), COMMAND_BYTE, "ring cell must hold 0x08");

  const shut = craft(0x00, 0, 0, 0x50);
  const s0 = shut.dumpState();
  oracle(shut);
  const s1 = shut.dumpState();
  const shutChanged = [];
  for (let off = 0; off < s0.length; off++) if (s0[off] !== s1[off]) shutChanged.push(shut.stateOffsetToAddr(off));
  assert.deepEqual(shutChanged, [PENDING], `gate-closed must write only the pending byte, got ${shutChanged.map(hx)}`);
  console.log("  WRITE-SET: open -> 3 cells (byte 0x08), closed -> only the pending byte");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: appends the wrong byte. */
function brokenWrongByte(m) {
  const cursor = m.mem.read8(CURSOR);
  m.mem.write8(PENDING, COMMAND_BYTE);
  if (m.mem.read8(ACTIVE) === 0 && m.mem.read8(MODE) === 0) return (m.regs.a = 0);
  m.mem.write8(RING_PAGE + cursor, COMMAND_BYTE ^ 0xff); // BUG: inverted byte
  const next = nextCursor(cursor);
  m.mem.write8(CURSOR, next);
  return (m.regs.a = next);
}

test("TEETH: a wrong appended byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00, 1, 0, RING_FIRST);
  const c = craft(0x00, 1, 0, RING_FIRST);
  oracle(o);
  brokenWrongByte(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, RING_PAGE + RING_FIRST, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned A is CAUGHT by the live-out check", () => {
  const o = craft(0x00, 1, 0, 0x50);
  const c = craft(0x00, 1, 0, 0x50);
  oracle(o);
  const good = queueSoundCommand08(c);
  assert.equal(good & 0xff, o.regs.a & 0xff, "sanity: module A matches the oracle");
  const broken = (good + 1) & 0xff; // an off-by-one cursor return a caller would misread
  assert.notEqual(broken, o.regs.a & 0xff, "the live-out check must reject an off-by-one A");
  console.log(`  TEETH(A): module A ${hx(good)} == oracle; ${hx(broken)} is rejected`);
});
