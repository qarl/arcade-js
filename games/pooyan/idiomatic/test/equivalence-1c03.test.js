// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advancePlayStateAndStageHighScoreEntryOnTimer (ROM 0x1c03) — the phase-timer-gated play-state dispatch
 * handler. Void handler (no register read back by its dispatcher), so LIVE-OUT is memory only and
 * the comparison is RAM (dumpState) minus stack scratch below the entry SP. Cases exercise: timer running (early ret),
 * timer expired with rank 0 (sounds/paint/enqueue + sub-state advance), and rank nonzero (the wipe
 * pointer build, the dissolved four-tile enqueue, and the rotate-left table copy).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1c03.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1c03 as oracle } from "../../translated/loc_1c03.js";
import { advancePlayStateAndStageHighScoreEntryOnTimer } from "../advancePlayStateAndStageHighScoreEntryOnTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PHASE_TIMER = 0x8808;
const PLAY_STATE_INDEX = 0x880a;
const RANK = 0x89fc;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, { timer = 1, rank = 0 } = {}) {
  m.regs.sp = SP0;
  m.mem.write8(PHASE_TIMER, timer);
  m.mem.write8(RANK, rank);
  return m;
}

const CASES = {
  "timer running -> early ret": (m) => seat(m, { timer: 5 }),
  "expired, rank 0": (m) => seat(m, { timer: 1, rank: 0 }),
  "expired, rank nonzero -> wipe ptr + table copy": (m) => seat(m, { timer: 1, rank: 3 }),
};

// -- 1. EQUAL ----------------------------------------------------------------

test("EQUAL: advancePlayStateAndStageHighScoreEntryOnTimer == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    advancePlayStateAndStageHighScoreEntryOnTimer(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET ------------------------------------------------------------

test("WRITE-SET: a running timer just decrements; on expiry the sub-state advances to 0x0e", () => {
  const run = CASES["timer running -> early ret"](BASE.clone());
  oracle(run);
  assert.equal(run.mem.read8(PHASE_TIMER), 4, "5 - 1 = 4 at the phase timer");

  const exp = CASES["expired, rank 0"](BASE.clone());
  oracle(exp);
  assert.equal(exp.mem.read8(PHASE_TIMER), 0, "timer reaches 0 on expiry");
  assert.equal(exp.mem.read8(PLAY_STATE_INDEX), 0x0e, "sub-state advanced to 0x0e");
  console.log("  WRITE-SET: timer -1; expiry advances the sub-state");
});

// -- 3. TEETH ----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["expired, rank 0"](BASE.clone());
  const c = CASES["expired, rank 0"](BASE.clone());
  oracle(o);
  advancePlayStateAndStageHighScoreEntryOnTimer(c);
  c.mem.write8(PLAY_STATE_INDEX, (o.mem.read8(PLAY_STATE_INDEX) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, PLAY_STATE_INDEX, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the sub-state advance diverges from the oracle", () => {
  const o = CASES["expired, rank 0"](BASE.clone());
  const c = CASES["expired, rank 0"](BASE.clone());
  oracle(o); // advances the sub-state to 0x0e among other writes
  // twin: do nothing -> the pre-run sub-state survives
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped handler must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
