// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchAllHunterRecordStates (ROM 0x2c2c, Pooyan) — the hunter-record sweep. It walks the
 * 17 enemy-actor records (base ENEMY_ACTOR_TABLE, stride 0x18), marshalling each record pointer
 * through IX into the per-record dispatcher dispatchOneHunterRecordState. The dispatcher returns false when a record
 * reaches its spawn handler, which aborts the sweep.
 *
 * SEATING: BALANCED — the oracle ends on a plain ret; the abort is a dissolved caller-skip dispatchOneHunterRecordState
 * reports as a boolean the module early-returns on. dispatchOneHunterRecordState is now idiomatic (dissolved this batch),
 * so the module DIRECT-CALLS it (no seated-return push16) — the frozen oracle consumed the CALL's
 * pushed word via its own ret, so dropping the push keeps the module SP-neutral. Compared on RAM
 * (dumpState) minus stack scratch below the entry SP; PLUS an SP-baseline tooth (the sweep must leave SP unchanged — a
 * retained/orphaned push would leak per iteration, invisible to the RAM diff).
 *
 * Cases are CRAFTED: two records are poked active with in-range states so the sweep dispatches
 * observably; one sits in the LAST slot so a short sweep is caught.
 *
 * Jobs:
 *   1. EQUAL — a boot clone (records as-seated) and a crafted two-record layout: oracle == module
 *      in RAM (−stack).
 *   2. OBSERVABLE — the crafted sweep writes RAM (the equal result is not vacuous).
 *   3. SP-TOOTH — the idiomatic sweep leaves SP unchanged (regresses the orphaned-push16 leak).
 *   4. TEETH — (a) a short-sweep twin (stops one record early) misses the last record and is
 *      caught; (b) a wrong seeded byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2c2c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c2c as oracle } from "../../translated/loc_2c2c.js";
import { dispatchAllHunterRecordStates } from "../dispatchAllHunterRecordStates.js";
import { dispatchOneHunterRecordState } from "../dispatchOneHunterRecordState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { ENEMY_ACTOR_TABLE, STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const EAT = ENEMY_ACTOR_TABLE;
const STRIDE = 0x18;
const RECORD_COUNT = 0x11;
const LAST = RECORD_COUNT - 1;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 2); // entry SP: the seat pushes the caller's return word below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craftBoot() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.push16(0xabcd); // a return the frozen ret can pop into dead-stack
  return m;
}

function craftTwo() {
  const m = craftBoot();
  // one active record mid-table, one in the LAST slot, each an in-range state
  m.mem.write8(EAT + 5 * STRIDE + 0, 0x01);
  m.mem.write8(EAT + 5 * STRIDE + 2, 0x12);
  m.mem.write8(EAT + LAST * STRIDE + 0, 0x01);
  m.mem.write8(EAT + LAST * STRIDE + 2, 0x13);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, craft] of [["boot clone", craftBoot], ["two active records", craftTwo]]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack)`, () => {
    const o = craft();
    const c = craft();
    oracle(o);
    dispatchAllHunterRecordStates(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL ${label}: RAM identical`);
  });
}

// -- 2. OBSERVABLE ------------------------------------------------------------

test("OBSERVABLE: the crafted sweep writes RAM (equal is not vacuous)", () => {
  const o = craftTwo();
  oracle(o);
  assert.notEqual(ramDiffMinusStack(o, craftTwo()), null, "the sweep must write RAM (else EQUAL proves nothing)");
  console.log("  OBSERVABLE: crafted sweep writes RAM");
});

// -- 3. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: the idiomatic sweep leaves SP unchanged (orphaned-push16 regression)", () => {
  const c = craftTwo();
  const sp0 = c.regs.sp;
  dispatchAllHunterRecordStates(c);
  const delta = ((c.regs.sp - sp0) << 16) >> 16;
  assert.equal(c.regs.sp, sp0, `sweep leaked SP by ${delta} bytes (an orphaned seated-return push16)`);
  // mutation control: a twin that retains the seated-return push16 MUST leak and be caught.
  function leakySweep(m) {
    let rec = EAT;
    for (let i = 0; i < RECORD_COUNT; i++) {
      m.regs.ix = rec;
      m.push16(0x2c39); // BUG: the idiomatic dispatcher never consumes this seated return
      if (!dispatchOneHunterRecordState(m)) return;
      rec += STRIDE;
    }
  }
  const t = craftTwo();
  const tsp0 = t.regs.sp;
  leakySweep(t);
  assert.notEqual(t.regs.sp, tsp0, "the SP-tooth FAILED to catch a retained orphaned push16 — it is worthless");
  console.log("  SP-TOOTH: idiomatic sweep SP-neutral; retained-push16 twin caught");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a short sweep (stops one record early) misses the last record", () => {
  function shortSweep(m) {
    let rec = EAT;
    for (let i = 0; i < RECORD_COUNT - 1; i++) {
      m.regs.ix = rec;
      m.push16(0x2c39);
      if (!m.call(0x2c3f)) return;
      rec += STRIDE;
    }
  }
  const o = craftTwo();
  const t = craftTwo();
  oracle(o);
  shortSweep(t);
  const d = ramDiffMinusStack(o, t);
  assert.notEqual(d, null, "the gate FAILED to catch a short sweep");
  console.log(`  TEETH(short sweep): caught at ${hx(d.addr ?? 0)}`);
});

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftTwo();
  const c = craftTwo();
  oracle(o);
  dispatchAllHunterRecordStates(c);
  const d0 = firstStateDiff(o.dumpState(), BASE.dumpState(), (off) => o.stateOffsetToAddr(off), inDeadStack);
  const target = d0 ? d0.addr : EAT + LAST * STRIDE + 2;
  c.mem.write8(target, (o.mem.read8(target) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, target, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});
