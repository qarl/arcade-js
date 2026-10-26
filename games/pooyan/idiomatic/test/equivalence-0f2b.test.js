// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand11 (ROM 0x0f2b) — "enqueue command byte 0x11": force A=0x11
 * and tail into the ring-append helper appendSoundCommandGated, which stashes the byte, and (only while a game is
 * active OR the play-mode latch is set) writes it into the page-0x8a command ring at the current
 * cursor and steps the cursor, wrapping the last slot (0x5e) back to the first (0x43).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses a FRESH clone
 * per side. Contract: RAM (dumpState minus stack scratch below the entry SP) PLUS the register live-out A — the helper
 * leaves the advanced cursor in A (0 when both gates are closed) and callers read it. pc/SP/cycles
 * are NOT compared.
 *
 * The leaf is not reached in a plain attract boot, so every case is CRAFTED: the two append gates
 * (GAME_ACTIVE_FLAG, PLAY_MODE_LATCH) and the ring cursor (SOUND_RING_WRITE_PTR) poked identically
 * on both sides. queueSoundCommand11 supplies its own A, so nothing else is seated.
 *
 * Jobs:
 *   1. EQUAL — over the gate/cursor cases oracle == queueSoundCommand11 in RAM (−stack) AND in A; the module
 *      must SET A on its own clone (a return-only rewrite would fail the caller).
 *   2. WRITE-SET — the append path's only writes are the pending-byte cell, the ring slot, and the
 *      advanced cursor.
 *   3. TEETH — a twin that appends a WRONG byte MUST be caught by the RAM diff; a twin that returns
 *      a WRONG A MUST be caught by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f2b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f2b as oracle } from "../../translated/loc_0f2b.js";
import { queueSoundCommand11 } from "../queueSoundCommand11.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, GAME_ACTIVE_FLAG, PLAY_MODE_LATCH, SOUND_RING_WRITE_PTR, SOUND_RING_PENDING_BYTE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const CMD = 0x11;           // the byte queueSoundCommand11 appends
const RING_PAGE = 0x8a00;   // the cursor low byte indexes this page
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the two gates + the ring cursor seated identically. */
function craft(active, playMode, cursor) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, playMode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.regs.sp = 0x8ffe; // dead-stack scratch; the helper only POPs what it PUSHed
  return m;
}

const CASES = [
  { name: "gates-closed", active: 0, playMode: 0, cursor: 0x4a },
  { name: "game-active", active: 1, playMode: 0, cursor: 0x43 },
  { name: "play-mode", active: 0, playMode: 1, cursor: 0x50 },
  { name: "cursor-wrap", active: 1, playMode: 0, cursor: 0x5e },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — queueSoundCommand11 == oracle in RAM (−stack) + A", () => {
  for (const { name, active, playMode, cursor } of CASES) {
    const o = craft(active, playMode, cursor);
    const c = craft(active, playMode, cursor);
    oracle(o);
    const ret = queueSoundCommand11(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `${name}: A live-out mismatch (ret)`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: module must SET A (advanced cursor) for the caller`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the append path writes the pending byte, the ring slot, and the advanced cursor", () => {
  const c = craft(1, 0, 0x43);
  queueSoundCommand11(c);
  assert.equal(c.mem.read8(SOUND_RING_PENDING_BYTE), CMD, "pending-byte cell holds the command");
  assert.equal(c.mem.read8(RING_PAGE | 0x43), CMD, "ring slot 0x43 holds the command");
  assert.equal(c.mem.read8(SOUND_RING_WRITE_PTR), 0x44, "cursor advanced to 0x44");
  console.log(`  WRITE-SET: (0x8d20,0x8a43):=${hx(CMD)}, cursor->0x44`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong appended byte is CAUGHT by the RAM diff", () => {
  const { active, playMode, cursor } = CASES[1];
  const o = craft(active, playMode, cursor);
  const c = craft(active, playMode, cursor);
  oracle(o);
  queueSoundCommand11(c);
  const slot = RING_PAGE | cursor;
  c.mem.write8(slot, (CMD ^ 0x01) & 0xff); // BUG: corrupt the appended byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, slot, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(slot)})`);
  console.log(`  TEETH/RAM: wrong appended byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned A is CAUGHT by the live-out check", () => {
  const { active, playMode, cursor } = CASES[1];
  const o = craft(active, playMode, cursor);
  const c = craft(active, playMode, cursor);
  oracle(o);
  const ret = queueSoundCommand11(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: the module's A matches the oracle");
  assert.notEqual(cursor, o.regs.a & 0xff, "the live-out check must reject a non-advanced cursor");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle; the un-advanced ${hx(cursor)} is rejected`);
});
