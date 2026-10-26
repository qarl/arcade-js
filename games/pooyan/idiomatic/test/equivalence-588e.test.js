// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedFirstFreeSpriteBlockInRun (ROM 0x588e, Pooyan) — "initialise a run of sprite blocks":
 * walk B blocks at IX, one block (0x18 bytes) per pass, initialising each with a fixed field seed
 * (E=0x04).
 *
 * seedFirstFreeSpriteBlockInRun is the CALLER of the dissolved caller-skip spawnEnemyIntoFreeActorSlot (the per-block initialiser, which
 * ret-c's on a live block to keep the walk going and pop-af/rets past this loop once it seeds a
 * fresh block). This gate COMPOSES the real idiomatic skip: the idiomatic seedFirstFreeSpriteBlockInRun imports the
 * idiomatic spawnEnemyIntoFreeActorSlot and early-returns when it reports false (seeded), exactly where the oracle's
 * pop-af/ret aborted the run. The oracle side runs the TRANSLATED seedFirstFreeSpriteBlockInRun, which m.call()s the
 * translated spawnEnemyIntoFreeActorSlot through the registry.
 *
 * Cycle-free / memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles/registers are NOT compared (seedFirstFreeSpriteBlockInRun has no register live-out).
 * Inputs are the block pointer (IX) and the count (B), bridged via the register defaults, plus the
 * block bytes and the three shared cells the initialiser reads (0x8907 / 0x8820 / 0x8908) poked
 * identically on both sides.
 *
 * NOTE: every case composes the sibling idiomatic spawnEnemyIntoFreeActorSlot; the gate turns green once that module
 * lands (the LEAD runs it in reconcile).
 *
 * Jobs: 1. EQUAL (all-live full run; seed pass 1; run past two then seed pass 3). 2. WRITE-SET
 * (an all-live run writes nothing; a free block gets its state byte stamped). 3. TEETH (a wrong
 * seeded byte on the abort case is caught by the RAM diff).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-588e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_588e as oracle } from "../../translated/loc_588e.js";
import { seedFirstFreeSpriteBlockInRun } from "../seedFirstFreeSpriteBlockInRun.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE, ROUND_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BASE_BLOCK = ENEMY_ACTOR_TABLE; // 0x8ae0
const STRIDE = 0x18;
const STAGE_A = 0x8820; // stage cell clamped into the column index
const STAGE_B = 0x8908; // secondary stage cell gating the column bias
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const blockBase = (k) => u16(BASE_BLOCK + k * STRIDE); // block initialised on pass k (0-based)

/** A fresh clone: IX/B/C seated, the three shared cells poked, and the listed blocks marked live. */
function craft(liveIndices, count) {
  const m = BASE.clone();
  m.regs.ix = BASE_BLOCK;
  m.regs.b = count;
  m.regs.c = 0x00; // initial C is dead in the initialiser (copied to unused B); pin for determinism
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  m.mem.write8(ROUND_COUNTER, 0x00);
  m.mem.write8(STAGE_A, 0x00);
  m.mem.write8(STAGE_B, 0x00);
  for (const k of liveIndices) m.mem.write8(blockBase(k) + 0x00, 0x01); // bit0 set -> live block
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: two live blocks — full run, no writes", () => {
  const o = craft([0, 1], 0x02);
  const c = craft([0, 1], 0x02);
  oracle(o);
  seedFirstFreeSpriteBlockInRun(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log("  EQUAL/all-live: full run, RAM identical (no writes)");
});

test("EQUAL: first block free — seed pass 1 then stop", () => {
  const o = craft([], 0x06); // block 0 free
  const c = craft([], 0x06);
  oracle(o);
  seedFirstFreeSpriteBlockInRun(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log(`  EQUAL/seed-1: seeded ${hx(blockBase(0))}, RAM identical`);
});

test("EQUAL: two live then free — step twice, seed pass 3, stop", () => {
  const o = craft([0, 1], 0x06); // blocks 0,1 live; block 2 free
  const c = craft([0, 1], 0x06);
  oracle(o);
  seedFirstFreeSpriteBlockInRun(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log(`  EQUAL/seed-3: seeded ${hx(blockBase(2))}, RAM identical`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: an all-live run writes nothing; a free block stamps its state byte", () => {
  const live = craft([0, 1], 0x02);
  const liveBefore = live.clone();
  oracle(live);
  // −stack: the oracle's marshalled push/pop plumbing lands in STACK_SCRATCH (return addr 0x5893)
  // and is not real work; every other assertion here filters it via inDeadStack.
  assert.equal(ramDiffMinusStack(live, liveBefore), null, "an all-live run must leave RAM (−stack) untouched");

  const free = craft([], 0x06);
  oracle(free);
  assert.equal(free.mem.read8(blockBase(0) + 0x00), 0x01, "a seeded block marks its active byte");
  console.log("  WRITE-SET: all-live inert; free block seeded");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte on the abort case is CAUGHT by the RAM diff", () => {
  const o = craft([0, 1], 0x06);
  const c = craft([0, 1], 0x06);
  oracle(o);
  seedFirstFreeSpriteBlockInRun(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: pass-3 seed is memory-equivalent before tampering");
  c.mem.write8(blockBase(2) + 0x02, (o.mem.read8(blockBase(2) + 0x02) ^ 0xff) & 0xff); // BUG: seeded state byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded byte");
  assert.equal(d.addr, blockBase(2) + 0x02, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong seeded byte caught at ${hx(d.addr)}`);
});
