// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for seedSpawnColumnAndRunBody — the spawn-one-actor entry wrapper.
 *
 * seedSpawnColumnAndRunBody seeds the spawn body's entry register with 0xff and runs the body (loc_5733). In the
 * frozen oracle the body's `pop af; ret` unwinds past this wrapper, landing in the wrapper's own
 * caller; the idiomatic wrapper reproduces that as a plain delegate + return. This gate COMPOSES
 * the real idiomatic body (the module under test imports it) and checks that oracle and module land
 * byte-identical in RAM (dumpState, minus stack scratch below the entry SP). seedSpawnColumnAndRunBody has no register live-out, so only
 * RAM is compared; SP sits in STACK_SCRATCH so the body's skip frames drop out of the diff.
 *
 * IX points at a spawn record; the level/round bytes the body reads are seated benign so the body
 * runs its main path and initialises the record.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack) after the wrapped spawn.
 *   2. WRITE-SET — the wrapped spawn marks the record active and bumps the spawn tally, proving the
 *      wrapper actually ran the body.
 *   3. TEETH — a wrapper that skips the body diverges at the record; a wrong record byte is caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-53a0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_53a0 as oracle } from "../../translated/loc_53a0.js";
import { seedSpawnColumnAndRunBody } from "../seedSpawnColumnAndRunBody.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX = ENEMY_ACTOR_TABLE; // a spawn record for the body to initialise
const ROUND = 0x8907;
const LEVEL = 0x8820;
const STAGE = 0x8908;
const BIAS = 0x8d4c;
const SPAWN_TALLY = 0x8d40; // the body bumps this once per spawn
const SP0 = 0x8fe0; // inside STACK_SCRATCH; the body's skip frames land here

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: IX at a fresh record, SP in dead stack, level/round bytes benign. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  for (let i = 0; i < 8; i++) m.mem.write8(SP0 + i, 0x00); // dummy dead-stack return frames
  m.regs.ix = IX;
  m.mem.write8(ROUND, 0x00);
  m.mem.write8(LEVEL, 0x00);
  m.mem.write8(STAGE, 0x00);
  m.mem.write8(BIAS, 0x00);
  m.mem.write8(SPAWN_TALLY, 0x00);
  m.mem.write8(IX + 0x00, 0x00); // record starts inactive
  m.mem.write8(IX + 0x07, 0x00);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: seedSpawnColumnAndRunBody == oracle in RAM (−stack) after the wrapped spawn", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  seedSpawnColumnAndRunBody(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: RAM identical (−stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the wrapped spawn activates the record and bumps the spawn tally", () => {
  const m = craft();
  oracle(m);
  assert.equal(m.mem.read8(IX + 0x00), 0x01, "the body must mark the record active");
  assert.equal(m.mem.read8(SPAWN_TALLY), 0x01, "the body must bump the spawn tally");
  console.log("  WRITE-SET: record activated; tally bumped");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrapper that skips the body diverges at the record", () => {
  const o = craft();
  const twin = craft(); // a broken wrapper that never runs the body -> record stays inactive
  oracle(o);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a body-skipping wrapper — it is worthless");
  assert.equal(d.addr, IX + 0x00, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(IX + 0x00)})`);
  console.log(`  TEETH/SKIP: a body-skipping wrapper is caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong record byte is caught by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  seedSpawnColumnAndRunBody(c);
  c.mem.write8(IX + 0x00, (o.mem.read8(IX + 0x00) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record byte");
  assert.equal(d.addr, IX + 0x00, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong record byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
