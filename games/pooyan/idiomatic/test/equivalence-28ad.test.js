// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceLaunchOnDelayAndClearHunterRecord (ROM 0x28ad) — launch state-3 handler. Runs the state-3
 * hold countdown (HUNTER_SPAWN_COUNTDOWN): while non-zero it just decrements and returns. On expiry it
 * bumps LAUNCH_STATE and — unless PLAY_MODE_LATCH is set — clears the 0x18-byte record addressed by
 * HUNTER_RECORD_PTR (rst 0x10 fill = 0, landing on the bare-ret idleLaunchStateNoop).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses a FRESH clone
 * per side. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — there is no register live-out: the
 * oracle leaves scratch in A/HL/B across its three exits and the per-frame launch dispatcher reads
 * none of them back. pc/SP/cycles are NOT compared.
 *
 * The leaf is reached only from the live launch state machine, so every case is CRAFTED: the hold
 * counter, the launch state, the play-mode latch, and the clear pointer are poked identically on
 * both sides, with the pointed-to record pre-dirtied to 0xAA so the clear (or its absence) is visible.
 *
 * Jobs:
 *   1. EQUAL — over all three exits (still-holding, expiry+clear, expiry+latched-skip) oracle ==
 *      advanceLaunchOnDelayAndClearHunterRecord in RAM (−stack).
 *   2. WRITE-SET — the expiry+clear case advances LAUNCH_STATE by one and zeroes exactly the
 *      0x18-byte record (its edges surviving).
 *   3. TEETH — a twin that leaves one record byte non-zero MUST be caught by the RAM diff; a twin
 *      that mis-decrements the hold counter MUST be caught too.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-28ad.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_28ad as oracle } from "../../translated/loc_28ad.js";
import { advanceLaunchOnDelayAndClearHunterRecord } from "../advanceLaunchOnDelayAndClearHunterRecord.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, LAUNCH_STATE, PLAY_MODE_LATCH, HUNTER_SPAWN_COUNTDOWN, HUNTER_RECORD_PTR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b00;        // work-RAM record the clear pointer targets (disjoint from 0x8f3x)
const REC_LEN = 0x18;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: hold/state/latch seated, clear pointer -> REC, record + edges pre-dirtied. */
function craft(scn) {
  const m = BASE.clone();
  m.mem.write8(HUNTER_SPAWN_COUNTDOWN, scn.hold);
  m.mem.write8(LAUNCH_STATE, scn.state);
  m.mem.write8(PLAY_MODE_LATCH, scn.mode);
  m.mem.write8(HUNTER_RECORD_PTR, REC & 0xff);
  m.mem.write8(HUNTER_RECORD_PTR + 1, (REC >> 8) & 0xff);
  for (let i = -1; i <= REC_LEN; i++) m.mem.write8(REC + i, 0xaa); // record + both edges
  m.regs.sp = 0x8ffe; // dead-stack scratch
  return m;
}

const CASES = [
  { name: "still-holding", hold: 0x05, state: 0x03, mode: 0x00 },
  { name: "expiry+clear", hold: 0x00, state: 0x03, mode: 0x00 },
  { name: "expiry+latched-skip", hold: 0x00, state: 0x03, mode: 0x01 },
  { name: "hold-to-zero", hold: 0x01, state: 0x03, mode: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: all three exits — advanceLaunchOnDelayAndClearHunterRecord == oracle in RAM (−stack)", () => {
  for (const scn of CASES) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    advanceLaunchOnDelayAndClearHunterRecord(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted exits identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: expiry+clear bumps LAUNCH_STATE and zeroes exactly the record", () => {
  const scn = CASES[1];
  const c = craft(scn);
  advanceLaunchOnDelayAndClearHunterRecord(c);
  assert.equal(c.mem.read8(LAUNCH_STATE), (scn.state + 1) & 0xff, "LAUNCH_STATE advanced by 1");
  assert.equal(c.mem.read8(HUNTER_SPAWN_COUNTDOWN), 0x00, "hold counter left at 0 (expired, not decremented past)");
  for (let i = 0; i < REC_LEN; i++) assert.equal(c.mem.read8(REC + i), 0x00, `record byte ${hx(REC + i)} zeroed`);
  assert.equal(c.mem.read8(REC - 1), 0xaa, "byte before the record survives");
  assert.equal(c.mem.read8(REC + REC_LEN), 0xaa, "byte after the record survives");
  console.log(`  WRITE-SET: LAUNCH_STATE ${hx(scn.state)}->${hx(scn.state + 1)}, record ${hx(REC)}..${hx(REC + REC_LEN - 1)} zeroed`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a non-zero record byte is CAUGHT by the RAM diff", () => {
  const scn = CASES[1]; // expiry+clear
  const probe = REC + 0x10;
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advanceLaunchOnDelayAndClearHunterRecord(c);
  c.mem.write8(probe, 0x01); // BUG: record byte must be 0

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-zero record byte — it is worthless");
  assert.equal(d.addr, probe, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(probe)})`);
  console.log(`  TEETH/RAM: non-zero record byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a mis-decremented hold counter is CAUGHT by the RAM diff", () => {
  const scn = CASES[0]; // still-holding
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advanceLaunchOnDelayAndClearHunterRecord(c);
  c.mem.write8(HUNTER_SPAWN_COUNTDOWN, (scn.hold - 2) & 0xff); // BUG: decremented by 2, not 1

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-decremented hold counter — it is worthless");
  assert.equal(d.addr, HUNTER_SPAWN_COUNTDOWN, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: mis-decrement caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
