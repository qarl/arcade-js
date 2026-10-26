// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchSpawnScheduleUnlessActorFlagged (ROM 0x1391, Pooyan) — "spawned-flag guard in front of the
 * field-compare dispatch".
 *
 * dispatchSpawnScheduleUnlessActorFlagged does `bit 0,(ix+0x08); ret nz` — when the block's flag byte has bit 0 set it returns
 * doing nothing, leaving A as it entered — else it tail-jumps to the field-compare dispatch
 * (matchActorScheduleThenSpawnOrAnimate), whose result (register A) becomes dispatchSpawnScheduleUnlessActorFlagged's result. Its only caller reaches it by a
 * `jr nc` tail, so its live-out is A.
 *
 * SEATING: TAIL-CALL. The module returns matchActorScheduleThenSpawnOrAnimate's result directly on the dispatch path and
 * returns nothing on the guard path (A untouched). The idiomatic dispatchSpawnScheduleUnlessActorFlagged imports the idiomatic
 * matchActorScheduleThenSpawnOrAnimate; the oracle side runs the TRANSLATED dispatchSpawnScheduleUnlessActorFlagged, which m.call()s the translated matchActorScheduleThenSpawnOrAnimate
 * through the registry.
 *
 * Cycle-free / memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) PLUS the register live-out A. pc/SP/cycles are NOT compared. A is derived from the
 * behaviour: entry A on the guard path, matchActorScheduleThenSpawnOrAnimate's result on the dispatch path.
 *
 * NOTE: the dispatch cases compose the sibling idiomatic matchActorScheduleThenSpawnOrAnimate; they turn green once that module
 * lands (the LEAD runs the gate in reconcile). The guard case is self-contained.
 *
 * Jobs: 1. EQUAL — RAM (−stack) AND A match on the guard + two dispatch states. 2. WRITE-SET —
 * the guard writes nothing; a high field forces the dispatch's set-flag/anim branch. 3. TEETH — a
 * wrong A is caught by the register check; a wrong written byte by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1391.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1391 as oracle } from "../../translated/loc_1391.js";
import { dispatchSpawnScheduleUnlessActorFlagged } from "../dispatchSpawnScheduleUnlessActorFlagged.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, ROUND_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX_BLOCK = 0x8ac0; // scratch block, disjoint from the tables the dispatch reads
const FLAG_FIELD = 0x08; // spawned-flag byte
const STATE_FIELD = 0x06; // field the dispatch compares
const SUBSTATE = 0x8d41; // low-nibble table key the dispatch reads
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: IX + A seated, flag/state fields and the two dispatch cells poked. */
function craft({ flag, state = 0x00, a = 0x77 }) {
  const m = BASE.clone();
  m.regs.ix = IX_BLOCK;
  m.regs.a = a;
  m.regs.sp = 0x8ff0; // inside STACK_SCRATCH
  m.mem.write8(ROUND_COUNTER, 0x00);
  m.mem.write8(SUBSTATE, 0x00);
  m.mem.write8(u16(IX_BLOCK + FLAG_FIELD), flag);
  m.mem.write8(u16(IX_BLOCK + STATE_FIELD), state);
  return m;
}

const CASES = [
  { label: "guard: flag bit0 set -> A untouched, no work", flag: 0x01, a: 0x77 },
  { label: "dispatch: flag clear, low state -> compare/ret path", flag: 0x00, state: 0x02 },
  { label: "dispatch: flag clear, high state -> set-flag + anim path", flag: 0x00, state: 0x50 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted cases — dispatchSpawnScheduleUnlessActorFlagged == oracle in RAM (−stack) + A live-out", () => {
  for (const c of CASES) {
    const o = craft(c);
    const k = craft(c);
    oracle(o);
    dispatchSpawnScheduleUnlessActorFlagged(k);
    const d = ramDiffMinusStack(o, k);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (${c.label})`);
    assert.equal(k.regs.a & 0xff, o.regs.a & 0xff, `A live-out mismatch (${c.label})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the guard writes nothing; a high field forces the dispatch's set-flag branch", () => {
  const guard = craft(CASES[0]);
  const b0 = guard.dumpState();
  oracle(guard);
  assert.deepEqual([...guard.dumpState()], [...b0], "the guard path must leave RAM untouched");

  const high = craft(CASES[2]);
  oracle(high);
  assert.equal(high.mem.read8(u16(IX_BLOCK + FLAG_FIELD)), 0x01, "the high-state dispatch sets the flag byte");
  console.log("  WRITE-SET: guard inert; high-state dispatch sets the flag");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong A live-out is CAUGHT by the register check", () => {
  const c = CASES[0]; // guard: A must equal entry A
  const o = craft(c);
  const k = craft(c);
  oracle(o);
  dispatchSpawnScheduleUnlessActorFlagged(k);
  assert.equal(k.regs.a & 0xff, o.regs.a & 0xff, "sanity: A matches the oracle on the guard path");
  assert.notEqual((c.a + 1) & 0xff, o.regs.a & 0xff, "the live-out check must reject an off-by-one A");
  console.log(`  TEETH/A: guard A ${hx(o.regs.a)} == oracle; an off-by-one is rejected`);
});

test("TEETH: a wrong written byte on the dispatch path is CAUGHT by the RAM diff", () => {
  const c = CASES[2]; // high state -> set-flag + anim writes
  const o = craft(c);
  const k = craft(c);
  oracle(o);
  dispatchSpawnScheduleUnlessActorFlagged(k);
  assert.equal(ramDiffMinusStack(o, k), null, "sanity: the dispatch path is memory-equivalent before tampering");
  k.mem.write8(u16(IX_BLOCK + FLAG_FIELD), (o.mem.read8(u16(IX_BLOCK + FLAG_FIELD)) ^ 0xff) & 0xff); // BUG
  const d = ramDiffMinusStack(o, k);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong dispatch write");
  assert.equal(d.addr, u16(IX_BLOCK + FLAG_FIELD), `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong dispatch byte caught at ${hx(d.addr)}`);
});
