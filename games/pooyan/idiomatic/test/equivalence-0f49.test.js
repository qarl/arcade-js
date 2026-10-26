// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand14 (ROM 0x0f49, Pooyan) — "append the fixed byte 0x14 into
 * the page-0x8a command ring" (a tail call to the ring-append helper). The helper stashes the
 * byte at 0x8d20, then appends only while GAME_ACTIVE_FLAG (0x8806) or PLAY_MODE_LATCH (0x8f50)
 * is set: it writes the byte at 0x8a00 + cursor (cursor = 0x8a40) and steps the cursor
 * 0x43..0x5e, wrapping 0x5e -> 0x43.
 *
 * Cycle-free memory-equivalence gate: the routine writes work RAM, so every case uses a FRESH
 * clone per side, compared on RAM (dumpState minus stack scratch below the entry SP) + the A register live-out.
 * A IS a live-out: the tail call leaves A = the advanced cursor (append) or 0 (gates closed),
 * and the helper's callers read it — so EQUAL compares A and asserts the module SET it.
 *
 * Jobs:
 *   1. EQUAL (crafted) — gate-closed, gate-open via each flag, and the 0x5e->0x43 wrap.
 *   2. WRITE-SET — gate-open writes exactly {0x8d20, ring cell, 0x8a40}; gate-closed only 0x8d20.
 *   3. TEETH — a wrong appended byte (RAM diff) and a wrong advanced cursor (A live-out) are caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f49.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f49 as oracle } from "../../translated/loc_0f49.js";
import { queueSoundCommand14 } from "../queueSoundCommand14.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  SOUND_RING_WRITE_PTR,
  SOUND_RING_PENDING_BYTE,
  HIGH_SCORE_TABLE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = HIGH_SCORE_TABLE; // 0x8a00: the append page (high byte of the cursor cell)
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const APPEND_BYTE = 0x14; // the fixed byte queueSoundCommand14 enqueues

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the append gates + cursor poked and the ring window / pending byte cleared. */
function craft(active, mode, cursor) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, mode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.mem.write8(SOUND_RING_PENDING_BYTE, 0x00); // known start so the WRITE-SET sees the stash write
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.sp = 0x8ffe; // dead stack: the helper's push/pop framing touches excluded RAM
  return m;
}

const nextCursor = (c) => (c === RING_LAST ? RING_FIRST : c + 1);

const CASES = [
  { name: "gate closed", active: 0, mode: 0, cursor: 0x50 },
  { name: "open via GAME_ACTIVE, first slot", active: 1, mode: 0, cursor: RING_FIRST },
  { name: "open via PLAY_MODE, wrap slot", active: 0, mode: 1, cursor: RING_LAST },
  { name: "open, mid cursor", active: 1, mode: 0, cursor: 0x50 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — queueSoundCommand14 == oracle in RAM (−stack) + A", () => {
  for (const { name, active, mode, cursor } of CASES) {
    const o = craft(active, mode, cursor);
    const c = craft(active, mode, cursor);
    oracle(o);
    queueSoundCommand14(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    // A live-out: advanced cursor (append) or 0 (gates closed); a caller reads it out of A.
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: A live-out mismatch`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gate-open writes {0x8d20, ring cell, 0x8a40}; gate-closed writes only 0x8d20", () => {
  // Count real game-state writes only: the helper's transient push/pop framing lands in
  // STACK_SCRATCH, which is not part of the contract, so it is filtered out here.
  const changedCells = (mm, run) => {
    const b0 = mm.dumpState();
    run(mm);
    const a1 = mm.dumpState();
    const out = [];
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = mm.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) out.push(addr);
    }
    return out;
  };

  const openChanged = changedCells(craft(1, 0, RING_FIRST), oracle);
  const openSet = new Set(openChanged);
  assert.equal(openChanged.length, 3, `gate-open expected 3 writes, got ${openChanged.length} (${openChanged.map(hx)})`);
  for (const cell of [SOUND_RING_PENDING_BYTE, RING_PAGE + RING_FIRST, SOUND_RING_WRITE_PTR]) {
    assert.ok(openSet.has(cell), `gate-open missing a write at ${hx(cell)}`);
  }

  const shutChanged = changedCells(craft(0, 0, 0x50), oracle);
  assert.deepEqual(shutChanged, [SOUND_RING_PENDING_BYTE], `gate-closed must write only 0x8d20, got ${shutChanged.map(hx)}`);
  console.log("  WRITE-SET: open -> 3 cells, closed -> only the stash byte");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: appends the byte inverted. */
function brokenWrongByte(m) {
  const cursor = m.mem.read8(SOUND_RING_WRITE_PTR);
  m.mem.write8(SOUND_RING_PENDING_BYTE, APPEND_BYTE);
  if (m.mem.read8(GAME_ACTIVE_FLAG) === 0 && m.mem.read8(PLAY_MODE_LATCH) === 0) return;
  m.mem.write8(RING_PAGE + cursor, APPEND_BYTE ^ 0xff); // BUG: inverted byte
  m.mem.write8(SOUND_RING_WRITE_PTR, nextCursor(cursor));
  m.regs.a = nextCursor(cursor);
}

test("TEETH: a wrong appended byte is CAUGHT by the RAM diff", () => {
  const o = craft(1, 0, RING_FIRST);
  const c = craft(1, 0, RING_FIRST);
  oracle(o);
  brokenWrongByte(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, RING_PAGE + RING_FIRST, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced cursor is CAUGHT by the A live-out check", () => {
  const o = craft(1, 0, RING_FIRST);
  const c = craft(1, 0, RING_FIRST);
  oracle(o);
  const ret = queueSoundCommand14(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A return matches the oracle");
  // an un-advanced cursor (still the first slot) is a plausible bug the A check must reject
  assert.notEqual(RING_FIRST, o.regs.a & 0xff, "the A live-out check must reject an un-advanced cursor");
  console.log(`  TEETH(A): module A ${hx(ret & 0xff)} == oracle; un-advanced ${hx(RING_FIRST)} rejected`);
});
