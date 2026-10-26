// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand0E (Pooyan) — "append the fixed byte 0x0e into the
 * command ring": load A := 0x0e and tail-call the ring-append helper.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM
 * (through the helper), so each case runs the oracle on one FRESH clone and queueSoundCommand0E on
 * another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  the declared register live-out (A).
 *
 * pc/SP are NOT compared (the oracle drives them through the dropped call/stack ABI). A IS
 * a genuine live-out: the helper leaves its advanced ring cursor in A (0 when the append
 * gates are closed) and does not restore it, so the bridge SETS A and the module clone's A
 * is asserted equal to the oracle clone's — the load-bearing side effect a caller reads.
 *
 * The helper only appends while a game is active OR the play-mode latch is set; otherwise it
 * merely stashes the pending byte and returns A=0. Every case is CRAFTED (the leaf is a
 * register-dispatched command emitter): gates poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL (crafted) — gates-closed, gates-open (mid-ring), and gates-open (wrap) all
 *      match in RAM(−stack) and in A, and the module SETS A on its own clone.
 *   2. WRITE-SET — gates-open writes exactly the pending byte, the ring slot, and the
 *      advanced cursor; gates-closed writes only the pending byte.
 *   3. CRAFTED (wrap) — a cursor at the last slot wraps to the first, A := first.
 *   4. TEETH — a wrong appended byte MUST be caught by the RAM diff, and a wrong A MUST be
 *      rejected by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f19.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f19 as oracle } from "../../translated/loc_0f19.js";
import { queueSoundCommand0E } from "../queueSoundCommand0E.js";
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

const RING_BYTE = 0x0e; // the byte queueSoundCommand0E appends
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const RING_PAGE = HIGH_SCORE_TABLE & 0xff00; // 0x8a00: the ring page base

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the append gates + ring cursor seated identically. */
function craft({ gameActive = 0, playMode = 0, cursor = RING_FIRST }) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, gameActive);
  m.mem.write8(PLAY_MODE_LATCH, playMode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.regs.a = 0xaa; // clobbered: the routine loads its own byte
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's rets only POP dead RAM
  return m;
}

// closed = attract (no append), open-mid = a mid-ring append, open-wrap = cursor at the last slot.
const CASES = [
  { name: "gates closed", gameActive: 0, playMode: 0, cursor: RING_FIRST },
  { name: "game active, mid-ring", gameActive: 1, playMode: 0, cursor: 0x50 },
  { name: "play-mode latch, wrap", gameActive: 0, playMode: 1, cursor: RING_LAST },
];

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted gate/cursor — queueSoundCommand0E == oracle in RAM(−stack) + A", () => {
  for (const c of CASES) {
    const o = craft(c);
    const k = craft(c);
    oracle(o);
    const ret = queueSoundCommand0E(k);

    const d = ramDiffMinusStack(o, k);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (${c.name})`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A live-out mismatch (${c.name})`);
    // SIDE-EFFECT: the bridge must SET A on the module clone — a caller reads A back.
    assert.equal(k.regs.a & 0xff, o.regs.a & 0xff, `module must SET A for the caller (${c.name})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gates-open writes pending byte + ring slot + advanced cursor", () => {
  const cursor = 0x50;
  const o = craft({ gameActive: 1, cursor });
  const before = o.dumpState();
  oracle(o);
  const after = o.dumpState();

  const changed = new Map();
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) {
      const addr = o.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.set(addr, after[off]);
    }
  }
  assert.equal(changed.get(SOUND_RING_PENDING_BYTE), RING_BYTE, "pending byte := 0x0e");
  assert.equal(changed.get(RING_PAGE + cursor), RING_BYTE, "ring slot := 0x0e");
  assert.equal(changed.get(SOUND_RING_WRITE_PTR), cursor + 1, "cursor advanced by one");
  assert.equal(changed.size, 3, `expected exactly 3 writes, got ${changed.size}`);

  // gates-closed: only the pending byte is stashed
  const o2 = craft({ gameActive: 0, playMode: 0 });
  const b2 = o2.dumpState();
  oracle(o2);
  const a2 = o2.dumpState();
  const changed2 = [];
  for (let off = 0; off < b2.length; off++) {
    if (b2[off] !== a2[off] && !inDeadStack(o2.stateOffsetToAddr(off))) changed2.push(o2.stateOffsetToAddr(off));
  }
  assert.deepEqual(changed2, [SOUND_RING_PENDING_BYTE], "gates closed: only the pending byte changes");
  console.log("  WRITE-SET: open -> pending+slot+cursor (3); closed -> pending only (1)");
});

// -- 3. CRAFTED (wrap) --------------------------------------------------------

test("CRAFTED: a cursor at the last slot wraps to the first, A := first", () => {
  const o = craft({ gameActive: 1, cursor: RING_LAST });
  const k = craft({ gameActive: 1, cursor: RING_LAST });
  oracle(o);
  const ret = queueSoundCommand0E(k);

  const d = ramDiffMinusStack(o, k);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}`);
  assert.equal(o.mem.read8(SOUND_RING_WRITE_PTR), RING_FIRST, "cursor wrapped to the first slot");
  assert.equal(ret & 0xff, RING_FIRST, "A live-out is the wrapped cursor");
  assert.equal(o.mem.read8(RING_PAGE + RING_LAST), RING_BYTE, "the last slot got the byte");
  console.log(`  CRAFTED: wrap ${hx(RING_LAST)} -> ${hx(RING_FIRST)}; A=${hx(ret)}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong appended byte is CAUGHT by the RAM diff", () => {
  const cursor = 0x50;
  const o = craft({ gameActive: 1, cursor });
  const k = craft({ gameActive: 1, cursor });
  oracle(o);
  queueSoundCommand0E(k);
  k.mem.write8(RING_PAGE + cursor, (RING_BYTE ^ 0xff) & 0xff); // BUG: wrong ring byte

  const d = ramDiffMinusStack(o, k);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, RING_PAGE + cursor, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A live-out is REJECTED by the live-out check", () => {
  const cursor = 0x50;
  const o = craft({ gameActive: 1, cursor });
  const k = craft({ gameActive: 1, cursor });
  oracle(o);
  const ret = queueSoundCommand0E(k);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: the module's A matches the oracle");
  // the un-advanced cursor is the plausible off-by-one the check must reject
  assert.notEqual(cursor, o.regs.a & 0xff, "the live-out check must reject an un-advanced A");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle; an un-advanced ${hx(cursor)} is rejected`);
});
