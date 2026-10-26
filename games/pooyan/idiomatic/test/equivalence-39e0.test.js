// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for fireEnemyShotWhenAlignedWithPlayer (ROM 0x39e0, Pooyan) — gate the enemy fire/drop decision on
 * the level counters, then in the shared tail spawn a shot when the target column aligns.
 *
 * SEATING: BALANCED. LIVE-OUT is memory only — every branch rets or tail-jumps into the KEPT
 * m.call(0x3a6c) shot spawner (unlifted), which BOTH sides invoke as the same frozen routine, so
 * they agree on the spawn path by construction. The comparison is RAM (dumpState) minus
 * stack scratch below the entry SP (the spawn path's frozen calls push there); the register file is not compared.
 *
 * Every decision path is CRAFTED on an isolated IX record with the global counters poked
 * identically on both sides: the two firing-tail entries (direct high-wave, and via the difficulty
 * gate l_39fb), each early-bail (lane-spawn gate, actor gate), the cooldown tick, the column
 * mismatch (no spawn) and the column match (spawn), plus the branch-selection gates.
 *
 * Jobs:
 *   1. EQUAL — every crafted path: oracle == module in RAM (−stack).
 *   2. WRITE-SET — the cooldown-tick path decrements exactly rec+0x15.
 *   3. TEETH — a corrupted cooldown byte is caught; a twin that skips the decrement diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-39e0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_39e0 as oracle } from "../../translated/loc_39af.js";
import { fireEnemyShotWhenAlignedWithPlayer } from "../fireEnemyShotWhenAlignedWithPlayer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  WAVE_PROGRESS_COUNTER,
  ROUND_COUNTER,
  GAUGE_PHASE_COUNTER,
  DIFFICULTY_DSW,
  LANE_SPAWN_COUNTDOWN,
  FLIP_SCREEN_FLAG,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PLAYER_X_COORD = 0x8842; // launcher X (proposed name; raw here so the test is name-independent)
const REC = 0x8b80; // isolated actor record base
const REC_COOLDOWN = 0x15;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** IX=REC, zeroed record, SP inside STACK_SCRATCH, then global + record pokes applied. */
function craft(pokes) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ff0;
  for (let i = 0; i < 0x18; i++) m.mem8[REC + i] = 0x00;
  for (const [addr, val] of pokes) m.mem8[addr] = val & 0xff;
  return m;
}

// Column for launcherX=0x40, flip=1, round even -> 0x08; rec+4 = 0x08 matches, 0x1f mismatches.
// Flip=0 takes the mirror-X branch (neg then col-2): launcherX=0x40, round even -> 0x16.
const CASES = [
  { name: "high-wave -> tail, lane-spawn gate rets",
    pokes: [[WAVE_PROGRESS_COUNTER, 0x0e], [LANE_SPAWN_COUNTDOWN, 0x01]] },
  { name: "high-wave -> tail, actor gate (rec+8 & 0xf0 == 0) rets",
    pokes: [[WAVE_PROGRESS_COUNTER, 0x0e], [LANE_SPAWN_COUNTDOWN, 0x00], [REC + 0x08, 0x0f]] },
  { name: "high-wave -> tail, cooldown tick",
    pokes: [[WAVE_PROGRESS_COUNTER, 0x0e], [LANE_SPAWN_COUNTDOWN, 0x00], [REC + 0x08, 0x10], [REC + REC_COOLDOWN, 0x05]] },
  { name: "high-wave -> tail, column mismatch (no spawn)",
    pokes: [[WAVE_PROGRESS_COUNTER, 0x0e], [LANE_SPAWN_COUNTDOWN, 0x00], [REC + 0x08, 0x10], [REC + REC_COOLDOWN, 0x00],
            [PLAYER_X_COORD, 0x40], [FLIP_SCREEN_FLAG, 0x01], [ROUND_COUNTER, 0x00], [REC + 0x04, 0x1f]] },
  { name: "high-wave -> tail, column match (spawn via frozen 0x3a6c)",
    pokes: [[WAVE_PROGRESS_COUNTER, 0x0e], [LANE_SPAWN_COUNTDOWN, 0x00], [REC + 0x08, 0x10], [REC + REC_COOLDOWN, 0x00],
            [PLAYER_X_COORD, 0x40], [FLIP_SCREEN_FLAG, 0x01], [ROUND_COUNTER, 0x00], [REC + 0x04, 0x08]] },
  { name: "high-wave -> tail, FLIPPED column match (flip=0 -> neg + col-2, spawn via frozen 0x3a6c)",
    pokes: [[WAVE_PROGRESS_COUNTER, 0x0e], [LANE_SPAWN_COUNTDOWN, 0x00], [REC + 0x08, 0x10], [REC + REC_COOLDOWN, 0x00],
            [PLAYER_X_COORD, 0x40], [FLIP_SCREEN_FLAG, 0x00], [ROUND_COUNTER, 0x00], [REC + 0x04, 0x16]] },
  { name: "high-round -> l_39fb -> DSW==7 -> l_3a08 rets",
    pokes: [[WAVE_PROGRESS_COUNTER, 0x00], [ROUND_COUNTER, 0x06], [DIFFICULTY_DSW, 0x07], [LANE_SPAWN_COUNTDOWN, 0x01]] },
  { name: "high-round -> l_39fb -> DSW!=7, rec+6 >= 0x10 -> ret",
    pokes: [[WAVE_PROGRESS_COUNTER, 0x00], [ROUND_COUNTER, 0x06], [DIFFICULTY_DSW, 0x00], [REC + 0x06, 0x10]] },
  { name: "low gauge -> l_39fb -> l_3a08 rets",
    pokes: [[WAVE_PROGRESS_COUNTER, 0x00], [ROUND_COUNTER, 0x00], [GAUGE_PHASE_COUNTER, 0x00],
            [DIFFICULTY_DSW, 0x00], [REC + 0x06, 0x00], [LANE_SPAWN_COUNTDOWN, 0x01]] },
  { name: "mid gate: wave>=8 -> l_3a08 rets",
    pokes: [[WAVE_PROGRESS_COUNTER, 0x08], [ROUND_COUNTER, 0x00], [GAUGE_PHASE_COUNTER, 0x03],
            [LANE_SPAWN_COUNTDOWN, 0x01]] },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted paths — fireEnemyShotWhenAlignedWithPlayer == oracle in RAM (−stack)", () => {
  for (const cse of CASES) {
    const o = craft(cse.pokes);
    const c = craft(cse.pokes);
    oracle(o);
    fireEnemyShotWhenAlignedWithPlayer(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the cooldown-tick path decrements exactly rec+0x15", () => {
  const before = craft(CASES[2].pokes).dumpState();
  const after = craft(CASES[2].pokes);
  oracle(after);
  const a1 = after.dumpState();
  const changed = [];
  for (let off = 0; off < before.length; off++) if (before[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  assert.deepEqual(changed.sort((a, b) => a - b), [REC + REC_COOLDOWN],
    `expected only rec+0x15 to change, got ${changed.map(hx)}`);
  assert.equal(after.mem8[REC + REC_COOLDOWN], 0x04, "cooldown 0x05 -> 0x04");
  console.log("  WRITE-SET: cooldown -1");
});

// -- 2b. BRIDGE (rec argument on the spawn path) ------------------------------

test("BRIDGE: the spawn path routes on the rec argument, ignoring m.regs.ix", () => {
  const POISON = 0x8d00; // a valid but wrong record; a stale-IX read would spawn against it, not REC
  const seated = craft(CASES[4].pokes); //     column match -> the shot-spawn tail
  const poisoned = craft(CASES[4].pokes);
  poisoned.regs.ix = POISON; //                wrong IX, but rec=REC is passed explicitly
  fireEnemyShotWhenAlignedWithPlayer(seated, REC);
  fireEnemyShotWhenAlignedWithPlayer(poisoned, REC);
  const d = ramDiffMinusStack(seated, poisoned);
  assert.equal(d, null, d && `spawn path read m.regs.ix, not rec (diff at ${hx(d.addr ?? 0)})`);
  console.log("  BRIDGE: spawn path ignores a poisoned IX");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted cooldown byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[2].pokes);
  const c = craft(CASES[2].pokes);
  oracle(o);
  fireEnemyShotWhenAlignedWithPlayer(c);
  c.mem8[REC + REC_COOLDOWN] = (c.mem8[REC + REC_COOLDOWN] ^ 0xff) & 0xff; // BUG: wrong cooldown
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted cooldown byte");
  assert.equal(d.addr, REC + REC_COOLDOWN, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the cooldown decrement diverges from the oracle", () => {
  const o = craft(CASES[2].pokes);
  const c = craft(CASES[2].pokes);
  oracle(o); // decrements rec+0x15
  const d = ramDiffMinusStack(o, c); // twin never ran -> cooldown still 0x05
  assert.notEqual(d, null, "a skipped cooldown decrement must be caught");
  assert.equal(d.addr, REC + REC_COOLDOWN, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(skip): caught at ${hx(d.addr)}`);
});
