// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearActorArenaAndCounters (ROM 0x2ae8) — the actor-state
 * teardown (dispatch state 7): zero the 0x241-byte actor arena from ACTOR_TABLE
 * (0x8a80..0x8cc0 inclusive: the seeding store + a 0x240-byte ldir), clear
 * SPAWN_PHASE_COUNTER / WAVE_ARRIVAL_COUNTER / ROPE_SEGMENT_COUNT, and force
 * PLAY_STATE_INDEX to 6.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case
 * uses a FRESH clone per side and the contract is RAM (dumpState, minus stack scratch below the entry SP).
 * There is no register live-out (memory-only teardown), so only RAM is compared.
 *
 * Jobs:
 *   1. EQUAL / CRAFTED — pre-dirty the arena, the counters, and the sub-state to 0xAA on
 *      both sides; oracle == module across all RAM (−stack), and the module's arena is
 *      fully zeroed with the counters cleared and PLAY_STATE_INDEX == 6.
 *   2. BOUNDARY — the byte just past the arena (0x8cc1) keeps its 0xAA dirt (surgical: the
 *      clear stops at 0x8cc0), and the byte just before (0x8a7f) is untouched.
 *   3. TEETH — a twin that leaves one arena byte non-zero MUST be caught by the RAM diff,
 *      and a twin that writes the WRONG sub-state MUST be caught at PLAY_STATE_INDEX.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2ae8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ae8 as oracle } from "../../translated/loc_2ae8.js";
import { clearActorArenaAndCounters } from "../clearActorArenaAndCounters.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ACTOR_TABLE,
  SPAWN_PHASE_COUNTER,
  WAVE_ARRIVAL_COUNTER,
  ROPE_SEGMENT_COUNT,
  PLAY_STATE_INDEX,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ARENA_LEN = 0x241;              // 0x8a80..0x8cc0 inclusive
const ARENA_LAST = ACTOR_TABLE + ARENA_LEN - 1; // 0x8cc0, last cleared byte
const ARENA_PAST = ACTOR_TABLE + ARENA_LEN;     // 0x8cc1, first uncleared byte
const COUNTERS = [SPAWN_PHASE_COUNTER, WAVE_ARRIVAL_COUNTER, ROPE_SEGMENT_COUNT];
const STATE_AFTER = 6;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

/** First RAM difference minus the stack scratch below the entry SP. firstStateDiff's own excludeAddr
 * skips dead-stack cells in a single pass. */
function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// A booted machine's frame machinery is neutralised by clone() (nextNmi/nextBoundary = Infinity).
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the arena, counters, sub-state and both boundary bytes pre-dirtied to 0xAA. */
function craft() {
  const m = BASE.clone();
  for (let i = 0; i < ARENA_LEN; i++) m.mem.write8((ACTOR_TABLE + i) & 0xffff, 0xaa);
  for (const c of COUNTERS) m.mem.write8(c, 0xaa);
  m.mem.write8(PLAY_STATE_INDEX, 0xaa);
  m.mem.write8(ARENA_PAST, 0xaa);   // just past the arena — must survive
  m.mem.write8(ACTOR_TABLE - 1, 0xaa); // just before — must survive
  m.regs.sp = 0x8ffe;               // dead-stack scratch; the oracle's ret only POPs
  return m;
}

// -- 1. EQUAL / CRAFTED -------------------------------------------------------

test("CRAFTED: pre-dirtied arena+counters — module == oracle in RAM (−stack), arena zeroed", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  clearActorArenaAndCounters(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

  // The module's arena is fully zeroed.
  for (let i = 0; i < ARENA_LEN; i++) {
    assert.equal(c.mem.read8((ACTOR_TABLE + i) & 0xffff), 0, `arena byte ${hx(ACTOR_TABLE + i)} not zeroed`);
  }
  for (const cell of COUNTERS) assert.equal(c.mem.read8(cell), 0, `counter ${hx(cell)} not cleared`);
  assert.equal(c.mem.read8(PLAY_STATE_INDEX), STATE_AFTER, "PLAY_STATE_INDEX must be forced to 6");
  console.log(`  CRAFTED: arena ${hx(ACTOR_TABLE)}..${hx(ARENA_LAST)} zeroed, 3 counters cleared, sub-state=6`);
});

// -- 2. BOUNDARY --------------------------------------------------------------

test("BOUNDARY: the clear stops at the arena edge (0x8cc1 and 0x8a7f keep their dirt)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  clearActorArenaAndCounters(c);

  assert.equal(c.mem.read8(ARENA_PAST), 0xaa, `${hx(ARENA_PAST)} (past the arena) must be untouched`);
  assert.equal(o.mem.read8(ARENA_PAST), 0xaa, "oracle also leaves the past-arena byte");
  assert.equal(c.mem.read8(ACTOR_TABLE - 1), 0xaa, `${hx(ACTOR_TABLE - 1)} (before the arena) must be untouched`);
  console.log(`  BOUNDARY: ${hx(ARENA_LAST)} cleared, ${hx(ARENA_PAST)} kept 0xAA`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a non-zero arena byte is CAUGHT by the RAM diff", () => {
  const probe = ACTOR_TABLE + 0x100; // some interior arena byte
  const o = craft();
  const c = craft();
  oracle(o);
  clearActorArenaAndCounters(c);
  c.mem.write8(probe, 0x01); // BUG: arena byte must be 0

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-zero arena byte — it is worthless");
  assert.equal(d.addr, probe, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(probe)})`);
  console.log(`  TEETH/RAM: non-zero arena byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong sub-state is CAUGHT at PLAY_STATE_INDEX", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  clearActorArenaAndCounters(c);
  c.mem.write8(PLAY_STATE_INDEX, 5); // BUG: must be 6

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sub-state — it is worthless");
  assert.equal(d.addr, PLAY_STATE_INDEX, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/STATE: wrong sub-state caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
