// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for announceBonusStageAndStartPlay (Pooyan) — countdown-timer tick with branch on landing value.
 *
 * Every call decrements the timer (LAUNCH_SCRIPT_PTR). Then, on the PRE-decrement value: 0x40 (the
 * boundary) runs the code-integrity check, enqueues the bonus-stage banner display command, and
 * queues its sound; any other nonzero value does nothing more; zero (expiry) clears PLAY_STATE_INDEX,
 * writes 0x02 to PLAY_MODE_LATCH and 0x40 to ENEMY_SPAWN_TIMER, and — unless bit 1 of ROUND_COUNTER
 * is set — writes 0x01 to HUNTER_SPAWN_FLIP_FLAG.
 *
 * The routine takes NO load-bearing register inputs (it seats HL from a constant), so every case is a
 * memory poke. Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH so the
 * oracle's push/call/ret stack traffic falls out of the diff.
 *
 * Jobs: 1. EQUAL across the boundary / running / expiry(bit1 clear) / expiry(bit1 set) branches;
 * 2. WRITE-SET (the timer decrement always; per-branch outputs); 3. TEETH (a corrupted output byte is
 * caught; the branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1d6e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d6e as oracle } from "../../translated/loc_1d6e.js";
import { announceBonusStageAndStartPlay } from "../announceBonusStageAndStartPlay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  LAUNCH_SCRIPT_PTR,
  PLAY_STATE_INDEX,
  PLAY_MODE_LATCH,
  ENEMY_SPAWN_TIMER,
  ROUND_COUNTER,
  HUNTER_SPAWN_FLIP_FLAG,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; // inside STACK_SCRATCH
const ROUND_BIT1 = 0x02;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the timer value + round counter; pre-dirty the expiry outputs so each write is observable. */
function seat({ value = 0x30, round = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(LAUNCH_SCRIPT_PTR, value);
  m.mem.write8(ROUND_COUNTER, round);
  m.mem.write8(PLAY_STATE_INDEX, 0xaa);
  m.mem.write8(PLAY_MODE_LATCH, 0xaa);
  m.mem.write8(ENEMY_SPAWN_TIMER, 0xaa);
  m.mem.write8(HUNTER_SPAWN_FLIP_FLAG, 0xaa);
  return m;
}

const CASES = [
  { name: "boundary 0x40 -> integrity + banner + sound", cfg: { value: 0x40 } },
  { name: "running (0x30) -> decrement only", cfg: { value: 0x30 } },
  { name: "running (0x01) -> decrement only", cfg: { value: 0x01 } },
  { name: "expiry (0x00), round bit1 clear -> set flip flag", cfg: { value: 0x00, round: 0x00 } },
  { name: "expiry (0x00), round bit1 set -> skip flip flag", cfg: { value: 0x00, round: ROUND_BIT1 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: announceBonusStageAndStartPlay == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    announceBonusStageAndStartPlay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: timer decrements always; expiry outputs written per branch", () => {
  // decrement happens on every branch
  const run = seat({ value: 0x30 });
  oracle(run);
  assert.equal(run.mem.read8(LAUNCH_SCRIPT_PTR), 0x2f, "timer decremented");

  // decrement wraps 0x00 -> 0xff on expiry
  const exp = seat({ value: 0x00, round: 0x00 });
  oracle(exp);
  assert.equal(exp.mem.read8(LAUNCH_SCRIPT_PTR), 0xff, "timer wraps on expiry");
  assert.equal(exp.mem.read8(PLAY_STATE_INDEX), 0x00, "play-state index cleared");
  assert.equal(exp.mem.read8(PLAY_MODE_LATCH), 0x02, "play mode latched");
  assert.equal(exp.mem.read8(ENEMY_SPAWN_TIMER), 0x40, "enemy-spawn timer reloaded");
  assert.equal(exp.mem.read8(HUNTER_SPAWN_FLIP_FLAG), 0x01, "flip flag raised (bit1 clear)");

  // bit 1 of the round counter suppresses the flip flag
  const supp = seat({ value: 0x00, round: ROUND_BIT1 });
  oracle(supp);
  assert.equal(supp.mem.read8(HUNTER_SPAWN_FLIP_FLAG), 0xaa, "flip flag left untouched (bit1 set)");

  // a plain running tick touches nothing but the timer
  const run2 = seat({ value: 0x30 });
  oracle(run2);
  assert.equal(run2.mem.read8(PLAY_MODE_LATCH), 0xaa, "running tick leaves the latch alone");
  console.log("  WRITE-SET: dec always; expiry = {index:=0, latch:=2, spawn:=0x40, flip:=1 unless bit1}");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted output is CAUGHT; branches are load-bearing", () => {
  const o = seat({ value: 0x00, round: 0x00 });
  const c = seat({ value: 0x00, round: 0x00 });
  oracle(o);
  announceBonusStageAndStartPlay(c);
  c.mem.write8(PLAY_MODE_LATCH, (o.mem.read8(PLAY_MODE_LATCH) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted latch byte");
  assert.equal(d.addr, PLAY_MODE_LATCH, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // expiry vs running branches must differ, or the guard is dead
  const exp = seat({ value: 0x00, round: 0x00 });
  const run = seat({ value: 0x30 });
  oracle(exp);
  oracle(run);
  assert.notEqual(ramDiffMinusStack(exp, run), null, "expiry and running branches must differ");

  // the round-bit1 guard is load-bearing: it changes the flip-flag write
  const b1clear = seat({ value: 0x00, round: 0x00 });
  const b1set = seat({ value: 0x00, round: ROUND_BIT1 });
  oracle(b1clear);
  oracle(b1set);
  assert.notEqual(ramDiffMinusStack(b1clear, b1set), null, "round-bit1 guard must change the flip flag");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; expiry/running + bit1 branches load-bearing`);
});
