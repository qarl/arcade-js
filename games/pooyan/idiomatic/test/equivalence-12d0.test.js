// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for matchActorScheduleThenSpawnOrAnimate (ROM 0x12d0) — "table lookup + object-field compare/dispatch"
 * for the record at IX. The round counter's low bits index a word table (via fetchWordFromTableIndex); the
 * animation-frame nibble indexes a target byte inside that word's row (via fetchByteFromTableIndex). The record's
 * compare field (ix+0x06) is matched against the target: equal -> tail spawnChildActorIfInRange (spawn dispatch);
 * below the low bound -> ret with A = the field; else -> flag the record spawned and tail
 * setActorAnimation.
 *
 * SEATING: BALANCED — the ret-below-bound WIREs; the equal and spawned branches are tail-jumps
 * forwarding the delegatee's result. LIVE-OUT: A — spawnChildActorIfInRange's result on the equal branch, else the
 * compare field itself. Compared per case on RAM (dumpState, minus stack scratch below the entry SP) PLUS the register
 * live-out A (a register-dispatched caller reads it back — see dispatchSpawnScheduleUnlessActorFlagged). pc/SP are not compared.
 *
 * The idiomatic matchActorScheduleThenSpawnOrAnimate imports the idiomatic fetchWordFromTableIndex/fetchByteFromTableIndex/spawnChildActorIfInRange/setActorAnimation; the
 * oracle runs the TRANSLATED equivalents via the registry. The equal branch seats B >= 0x20 so
 * spawnChildActorIfInRange returns B directly (no deeper subtree). The lookup target with round=0/frame=0 is 0x11
 * (verified against the ROM tables), so the field is chosen relative to it.
 *
 * Jobs: 1. EQUAL — RAM (−stack) AND A match on the below-bound, equal, and spawned branches.
 *       2. WRITE-SET — below-bound writes nothing; the spawned branch flags the record + sets the
 *          anim pointer. 3. TEETH — a wrong A is caught by the register check; a wrong written byte
 *          by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-12d0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_12d0 as oracle } from "../../translated/loc_12d0.js";
import { matchActorScheduleThenSpawnOrAnimate } from "../matchActorScheduleThenSpawnOrAnimate.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, ROUND_COUNTER, ANIM_FRAME_COUNTER, ANIM_SEQ_TABLE_12FB, ANIM_TABLE_3838 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const IX_BLOCK = 0x8ac0; // scratch record, disjoint from the lookup tables
const OBJ_FIELD = 0x06;
const SPAWNED_FLAG = 0x08;
const ANIM_LO = 0x0c; // setActorAnimation writes the sequence pointer here
const TARGET = 0x11; //  lookup target for round=0 / frame=0 (verified against the ROM)

/** A fresh clone: IX + A/B seated, compare field poked, lookup keys zeroed. */
function craft({ field, a = 0x77, b = 0x20 }) {
  const m = BASE.clone();
  m.regs.ix = IX_BLOCK;
  m.regs.a = a;
  m.regs.b = b;
  m.regs.sp = 0x8ff0; // inside STACK_SCRATCH
  m.mem.write8(ROUND_COUNTER, 0x00);
  m.mem.write8(ANIM_FRAME_COUNTER, 0x00);
  m.mem.write8(u16(IX_BLOCK + OBJ_FIELD), field);
  m.mem.write8(u16(IX_BLOCK + SPAWNED_FLAG), 0x00);
  return m;
}

const CASES = [
  { label: "below bound: field < 0x14, != target -> ret A=field", field: 0x05 },
  { label: "equal: field == target -> tail spawnChildActorIfInRange (B>=0x20 -> A=B)", field: TARGET, b: 0x20 },
  { label: "spawned: field >= 0x14, != target -> flag + anim, A=field", field: 0x50 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted branches — matchActorScheduleThenSpawnOrAnimate == oracle in RAM (−stack) + A live-out", () => {
  for (const c of CASES) {
    const o = craft(c);
    const k = craft(c);
    oracle(o);
    matchActorScheduleThenSpawnOrAnimate(k);
    const d = ramDiffMinusStack(o, k);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (${c.label})`);
    assert.equal(k.regs.a & 0xff, o.regs.a & 0xff, `A live-out mismatch (${c.label})`);
    assert.equal(k.regs.c & 0xff, o.regs.c & 0xff, `C live-out mismatch (${c.label})`);
    assert.equal(k.regs.de & 0xffff, o.regs.de & 0xffff, `DE live-out mismatch (${c.label})`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack + A/C/DE)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: below-bound is inert; the spawned branch flags the record + seats the anim pointer", () => {
  const below = craft(CASES[0]);
  const ref = craft(CASES[0]); // fresh, unrun reference
  oracle(below);
  // −stack: the oracle still marshals fetchWordFromTableIndex + the rst 0x20 before the field test, so it parks
  // return addresses in STACK_SCRATCH; the below-bound path touches no *real* RAM.
  const d = ramDiffMinusStack(below, ref);
  assert.equal(d, null, d && `the below-bound path must leave RAM untouched (diff at ${hx(d.addr ?? 0)})`);

  const spawned = craft(CASES[2]);
  oracle(spawned);
  assert.equal(spawned.mem.read8(u16(IX_BLOCK + SPAWNED_FLAG)), 0x01, "the spawned branch sets the flag byte");
  assert.equal(spawned.mem.read8(u16(IX_BLOCK + ANIM_LO)), 0x38, "setActorAnimation seats the sequence pointer");
  console.log("  WRITE-SET: below inert; spawned flags + seats the anim pointer");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong A live-out is CAUGHT; a wrong written byte is CAUGHT by the RAM diff", () => {
  const c = CASES[0]; // below bound: A must equal the field (0x05), not the entry A (0x77)
  const o = craft(c);
  const k = craft(c);
  oracle(o);
  matchActorScheduleThenSpawnOrAnimate(k);
  assert.equal(k.regs.a & 0xff, o.regs.a & 0xff, "sanity: A matches the oracle on the below-bound path");
  assert.equal(o.regs.a & 0xff, c.field, "the below-bound live-out is the compare field itself");
  assert.notEqual((c.field + 1) & 0xff, o.regs.a & 0xff, "the live-out check must reject an off-by-one A");
  assert.equal(k.regs.c & 0xff, o.regs.c & 0xff, "sanity: C matches the oracle on the below-bound path");
  assert.equal(o.regs.c & 0xff, TARGET, "the C live-out is the lookup target");
  assert.notEqual((TARGET + 1) & 0xff, o.regs.c & 0xff, "the C check must reject a wrong target");
  assert.equal(k.regs.de & 0xffff, o.regs.de & 0xffff, "sanity: DE matches the oracle on the below-bound path");
  assert.equal(o.regs.de & 0xffff, u16(ANIM_SEQ_TABLE_12FB + 1), "the DE live-out is the advanced table pointer (round=0)");
  assert.notEqual(u16(ANIM_SEQ_TABLE_12FB + 2), o.regs.de & 0xffff, "the DE check must reject a wrong pointer");

  const o2 = craft(CASES[2]);
  const k2 = craft(CASES[2]);
  oracle(o2);
  matchActorScheduleThenSpawnOrAnimate(k2);
  assert.equal(k2.regs.de & 0xffff, o2.regs.de & 0xffff, "sanity: DE matches the oracle on the spawned path");
  assert.equal(o2.regs.de & 0xffff, ANIM_TABLE_3838, "the spawned DE live-out is the anim-table base");
  assert.notEqual((ANIM_TABLE_3838 + 1) & 0xffff, o2.regs.de & 0xffff, "the spawned DE check must reject a wrong base");
  k2.mem.write8(u16(IX_BLOCK + SPAWNED_FLAG), 0x00); // BUG: the spawned flag must be 1
  const d = ramDiffMinusStack(o2, k2);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong spawned-flag byte — it is worthless");
  assert.equal(d.addr, IX_BLOCK + SPAWNED_FLAG, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: off-by-one A/C + wrong DE rejected; wrong flag byte caught at ${hx(d.addr)}`);
});
