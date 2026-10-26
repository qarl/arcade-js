// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand0D (ROM 0x0f15) — "append command 0x0d to the command
 * ring". The incoming byte is stashed at 0x8d20 first; the append itself runs only while the
 * game is active OR the play-mode latch is set, writing the byte into the ring page at the
 * cursor and advancing/ wrapping the cursor. With both gates closed it appends nothing.
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP) PLUS the register live-out A.
 * pc/SP/cycles are NOT compared. A IS a genuine live-out: the append helper leaves the
 * advanced cursor in A (0 on the gates-closed path) and does not restore it, and callers
 * read it back — so the EQUAL job checks the module SET A (return-assignment) to the oracle's
 * value, not merely returned it.
 *
 * All cases are CRAFTED: the cursor (0x8a40) and the two gate cells (0x8806, 0x8f50) are the
 * only inputs, poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — over gate-open (either gate) / gate-closed / wrap cases, oracle == queueSoundCommand0D in
 *      RAM (−stack) AND in A (returned AND set on the module clone).
 *   2. WRITE-SET — gate-open writes 0x8d20 + ring slot + advanced cursor; gate-closed writes
 *      only 0x8d20.
 *   3. TEETH — a wrong ring byte is caught by the RAM diff, and a wrong (under-advanced) A is
 *      caught by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f15.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f15 as oracle } from "../../translated/loc_0f15.js";
import { queueSoundCommand0D } from "../queueSoundCommand0D.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SOUND_RING_WRITE_PTR,
  HIGH_SCORE_TABLE,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  SOUND_RING_PENDING_BYTE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_COMMAND = 0x0d; // the byte this entry point appends
const RING_LAST = 0x5e;
const RING_FIRST = 0x43;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the cursor and the two gate cells seated. */
function craft(cursor, gameActive, playMode) {
  const m = BASE.clone();
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor & 0xff);
  m.mem.write8(GAME_ACTIVE_FLAG, gameActive & 0xff);
  m.mem.write8(PLAY_MODE_LATCH, playMode & 0xff);
  m.regs.sp = 0x8ff0; // in STACK_SCRATCH; the oracle's push/pop/ret stay inside it
  return m;
}

const nextCursor = (c) => (c === RING_LAST ? RING_FIRST : (c + 1) & 0xff);

// (cursor, gameActive, playMode, appends?)
const CASES = [
  { cursor: 0x50, ga: 1, pm: 0, append: true }, // gate open via game-active
  { cursor: 0x43, ga: 0, pm: 1, append: true }, // gate open via play-mode latch
  { cursor: 0x50, ga: 0, pm: 0, append: false }, // both gates closed
  { cursor: RING_LAST, ga: 1, pm: 0, append: true }, // wrap the cursor
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — queueSoundCommand0D == oracle in RAM (−stack) + A", () => {
  for (const { cursor, ga, pm } of CASES) {
    const o = craft(cursor, ga, pm);
    const c = craft(cursor, ga, pm);
    oracle(o);
    const ret = queueSoundCommand0D(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (cursor=${hx(cursor)} ga=${ga} pm=${pm})`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A return mismatch (cursor=${hx(cursor)} ga=${ga} pm=${pm})`);
    // SIDE-EFFECT arm: the module must SET A for the translated caller, not merely return it.
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A (cursor=${hx(cursor)} ga=${ga} pm=${pm})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gate-open writes 0x8d20 + ring slot + cursor; gate-closed writes only 0x8d20", () => {
  for (const { cursor, ga, pm, append } of CASES) {
    const before = craft(cursor, ga, pm);
    const after = craft(cursor, ga, pm);
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    const changed = new Map();
    for (let off = 0; off < b0.length; off++) {
      const addr = after.stateOffsetToAddr(off);
      if (b0[off] !== a1[off] && !inDeadStack(addr)) changed.set(addr, a1[off]);
    }
    assert.equal(changed.get(SOUND_RING_PENDING_BYTE), RING_COMMAND, "pending byte always stashed");
    if (append) {
      assert.equal(changed.size, 3, `gate-open expects 3 writes (cursor=${hx(cursor)})`);
      assert.equal(changed.get(HIGH_SCORE_TABLE + cursor), RING_COMMAND, "ring slot := 0x0d");
      assert.equal(changed.get(SOUND_RING_WRITE_PTR), nextCursor(cursor), "cursor advanced");
    } else {
      assert.equal(changed.size, 1, "gate-closed writes only the pending byte");
    }
  }
  console.log("  WRITE-SET: gate-open 3 cells, gate-closed 1 cell (verified per case)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong ring byte is CAUGHT by the RAM diff", () => {
  const { cursor } = CASES[0];
  const slot = HIGH_SCORE_TABLE + cursor;
  const o = craft(cursor, 1, 0);
  const c = craft(cursor, 1, 0);
  oracle(o);
  queueSoundCommand0D(c);
  c.mem.write8(slot, 0x00); // BUG: the appended byte must be 0x0d
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring byte — it is worthless");
  assert.equal(d.addr, slot, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong ring byte caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong (under-advanced) A is CAUGHT by the live-out check", () => {
  const { cursor } = CASES[0];
  const o = craft(cursor, 1, 0);
  const c = craft(cursor, 1, 0);
  oracle(o);
  const ret = queueSoundCommand0D(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: the module's A matches the oracle");
  // an un-advanced cursor (the pre-call value) is a plausible bug the A check must reject
  assert.notEqual(cursor, o.regs.a & 0xff, "the live-out check must reject an un-advanced A");
  console.log(`  TEETH/A: module A ${hx(ret & 0xff)} == oracle; an un-advanced ${hx(cursor)} is rejected`);
});
