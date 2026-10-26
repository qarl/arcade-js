// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommands96And97And18And15 (Pooyan) — "queue four fixed commands": two text-ring
 * appends (0x96, 0x97) then two sound-ring enqueues (0x18, 0x15), all through one shared ring
 * cursor on the 0x8a00 page.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM, so
 * each case runs the oracle on one FRESH clone and queueSoundCommands96And97And18And15 on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The live-out is MEMORY ONLY. pc/SP are not compared. A is deliberately NOT compared: the two
 * text appends leave the text cursor (or 0) in A while the final enqueue leaves the sound-ring
 * pointer there, and enqueue sites reload A — so A is not a consumed result of this routine, and
 * the tail enqueue helper's own contract already declares its A non-live. Comparing A would demand
 * that helper set a register it (correctly) does not.
 *
 * The two text appends run only while a game is active OR the play-mode latch is set; the two
 * sound enqueues always run. Every case is CRAFTED (a register-dispatched command emitter): the
 * gates and the shared cursor are poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL (crafted) — gates-closed (enqueues only), gates-open (all four), and a wrap case
 *      match in RAM(−stack).
 *   2. WRITE-SET — gates-open writes exactly the pending byte, four ring slots, and the cursor
 *      (advanced by four); gates-closed writes the pending byte, two slots, and the cursor.
 *   3. CRAFTED (wrap) — a cursor near the end wraps 0x5e -> 0x43 mid-sequence.
 *   4. TEETH — a wrong enqueued byte MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f58.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f58 as oracle } from "../../translated/loc_0f58.js";
import { queueSoundCommands96And97And18And15 } from "../queueSoundCommands96And97And18And15.js";
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

const TEXT_A = 0x96;
const TEXT_B = 0x97;
const SOUND_A = 0x18;
const SOUND_B = 0x15;
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const RING_PAGE = HIGH_SCORE_TABLE & 0xff00; // 0x8a00

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}
function changedMinusStack(m, before, after) {
  const out = new Map();
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) {
      const addr = m.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) out.set(addr, after[off]);
    }
  }
  return out;
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the append gates + shared ring cursor seated identically. */
function craft({ gameActive = 0, playMode = 0, cursor = RING_FIRST }) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, gameActive);
  m.mem.write8(PLAY_MODE_LATCH, playMode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's rets only POP dead RAM
  return m;
}

const CASES = [
  { name: "gates closed", gameActive: 0, playMode: 0, cursor: RING_FIRST },
  { name: "game active", gameActive: 1, playMode: 0, cursor: RING_FIRST },
  { name: "play-mode, wrap mid-sequence", gameActive: 0, playMode: 1, cursor: 0x5c },
];

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted gate/cursor — queueSoundCommands96And97And18And15 == oracle in RAM(−stack)", () => {
  for (const c of CASES) {
    const o = craft(c);
    const k = craft(c);
    oracle(o);
    queueSoundCommands96And97And18And15(k);
    const d = ramDiffMinusStack(o, k);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (${c.name})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gates-open = pending + 4 slots + cursor; gates-closed = pending + 2 slots + cursor", () => {
  // gates open: all four commands land
  const open = craft({ gameActive: 1, cursor: RING_FIRST });
  const b1 = open.dumpState();
  oracle(open);
  const a1 = open.dumpState();
  const c1 = changedMinusStack(open, b1, a1);
  assert.equal(c1.get(SOUND_RING_PENDING_BYTE), TEXT_B, "pending byte := 0x97 (last text byte)");
  assert.equal(c1.get(RING_PAGE + RING_FIRST + 0), TEXT_A, "slot0 := 0x96");
  assert.equal(c1.get(RING_PAGE + RING_FIRST + 1), TEXT_B, "slot1 := 0x97");
  assert.equal(c1.get(RING_PAGE + RING_FIRST + 2), SOUND_A, "slot2 := 0x18");
  assert.equal(c1.get(RING_PAGE + RING_FIRST + 3), SOUND_B, "slot3 := 0x15");
  assert.equal(c1.get(SOUND_RING_WRITE_PTR), RING_FIRST + 4, "cursor advanced by four");
  assert.equal(c1.size, 6, `expected exactly 6 writes, got ${c1.size}`);

  // gates closed: only the two sound enqueues write ring slots
  const closed = craft({ gameActive: 0, playMode: 0, cursor: RING_FIRST });
  const b2 = closed.dumpState();
  oracle(closed);
  const a2 = closed.dumpState();
  const c2 = changedMinusStack(closed, b2, a2);
  assert.equal(c2.get(SOUND_RING_PENDING_BYTE), TEXT_B, "pending byte still stashed");
  assert.equal(c2.get(RING_PAGE + RING_FIRST + 0), SOUND_A, "slot0 := 0x18");
  assert.equal(c2.get(RING_PAGE + RING_FIRST + 1), SOUND_B, "slot1 := 0x15");
  assert.equal(c2.get(SOUND_RING_WRITE_PTR), RING_FIRST + 2, "cursor advanced by two");
  assert.equal(c2.size, 4, `expected exactly 4 writes, got ${c2.size}`);
  console.log("  WRITE-SET: open -> 6 writes; closed -> 4 writes");
});

// -- 3. CRAFTED (wrap) --------------------------------------------------------

test("CRAFTED: a cursor near the end wraps 0x5e -> 0x43 mid-sequence", () => {
  const cursor = 0x5c; // 0x5c, 0x5d, 0x5e(->0x43 wrap), 0x43
  const o = craft({ gameActive: 1, cursor });
  const k = craft({ gameActive: 1, cursor });
  oracle(o);
  queueSoundCommands96And97And18And15(k);
  const d = ramDiffMinusStack(o, k);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}`);
  assert.equal(o.mem.read8(RING_PAGE + RING_LAST), SOUND_A, "the last slot took the 3rd byte");
  assert.equal(o.mem.read8(RING_PAGE + RING_FIRST), SOUND_B, "the wrapped-to first slot took the 4th byte");
  assert.equal(o.mem.read8(SOUND_RING_WRITE_PTR), RING_FIRST + 1, "cursor ends one past the first slot");
  console.log(`  CRAFTED: cursor ${hx(cursor)} wrapped through ${hx(RING_LAST)} -> ${hx(RING_FIRST)}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong enqueued byte is CAUGHT by the RAM diff", () => {
  const o = craft({ gameActive: 1, cursor: RING_FIRST });
  const k = craft({ gameActive: 1, cursor: RING_FIRST });
  oracle(o);
  queueSoundCommands96And97And18And15(k);
  const badSlot = RING_PAGE + RING_FIRST + 3; // the last (0x15) enqueue slot
  k.mem.write8(badSlot, (SOUND_B ^ 0xff) & 0xff); // BUG: wrong enqueued byte

  const d = ramDiffMinusStack(o, k);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong enqueued byte — it is worthless");
  assert.equal(d.addr, badSlot, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
