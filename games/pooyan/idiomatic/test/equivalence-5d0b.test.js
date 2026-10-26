// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickEnemyActorAnimHolds (Pooyan) — "tick the enemy-table animation holds": walk the
 * six fixed-stride records of the enemy actor table and step each record's animation-hold in place.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM (through
 * its per-record callee), so each case runs the oracle on one FRESH clone and tickEnemyActorAnimHolds on another,
 * compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP are NOT compared. tickEnemyActorAnimHolds returns NOTHING the caller reads — the next caller reloads its own
 * pointer/counter — so the contract is memory-only; no register live-out is declared. The oracle
 * banks its loop counter and stride across each callee, an effect with no RAM footprint.
 *
 * Jobs:
 *   1. EQUAL (crafted) — with all six records armed so every tick mutates, oracle == tickEnemyActorAnimHolds in
 *      RAM(−stack). The crafted state (active/armed record, hold about to underflow, phase step)
 *      is what a natural boot rarely presents, so it is poked identically on both sides.
 *   2. CAPTURED (best-effort) — replay any real dispatch a short boot happens to reach.
 *   3. WRITE-SET — each armed record's hold, phase and arm bytes change; nothing else does.
 *   4. TEETH — a twin that walks only FIVE records MUST be caught by the RAM diff at the sixth.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5d0b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5d0b as oracle } from "../../translated/loc_5d0b.js";
import { tickEnemyActorAnimHolds } from "../tickEnemyActorAnimHolds.js";
import { tickActorAnimHold } from "../tickActorAnimHold.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE, ROUND_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x5d0b;
const COUNT = 6;
const STRIDE = 0x18;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const recBase = (i) => (ENEMY_ACTOR_TABLE + i * STRIDE) & 0xffff;

// Field offsets the per-record tick reads/writes.
const OFF_ACTIVE = 0x00;
const OFF_TIMER = 0x12;
const OFF_PHASE = 0x13;
const OFF_ARM = 0x16;

/** A fresh clone with all six records armed so each tick underflows and steps a phase. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; per-record calls push/pop dead RAM
  m.mem.write8(ROUND_COUNTER, 0x00); // even -> the tick's parity gate always proceeds
  for (let i = 0; i < COUNT; i++) {
    const r = recBase(i);
    m.mem.write8(r + OFF_ACTIVE, 0x01); // record active
    m.mem.write8(r + OFF_ARM, 0x02); // armed
    m.mem.write8(r + OFF_TIMER, 0x01); // hold about to underflow to 0
    m.mem.write8(r + OFF_PHASE, 0x02); // a phase remaining to step
  }
  return m;
}

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted armed records — tickEnemyActorAnimHolds == oracle in RAM(−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  tickEnemyActorAnimHolds(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  // spot-check the expected per-record step on the module clone
  for (let i = 0; i < COUNT; i++) {
    const r = recBase(i);
    assert.equal(c.mem.read8(r + OFF_TIMER), 0x00, `record ${i} hold must underflow to 0`);
    assert.equal(c.mem.read8(r + OFF_PHASE), 0x01, `record ${i} phase must step down`);
    assert.equal(c.mem.read8(r + OFF_ARM), 0x01, `record ${i} must re-arm`);
  }
  console.log(`  EQUAL: ${COUNT} armed records ticked identically (RAM −stack)`);
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

test("CAPTURED: real dispatches replay identically (if reached)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 16) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    new Machine(ROM, { overrides: snap }).runFrames(1500);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    tickEnemyActorAnimHolds(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `captured RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log(`  CAPTURED: ${caps.length} real dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: each armed record's hold/phase/arm change, nothing else", () => {
  const before = craft();
  const after = craft();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const expected = new Set();
  for (let i = 0; i < COUNT; i++) {
    const r = recBase(i);
    expected.add(r + OFF_TIMER);
    expected.add(r + OFF_PHASE);
    expected.add(r + OFF_ARM);
  }
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
  }
  assert.equal(changed.length, expected.size, `expected ${expected.size} record-field writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  console.log(`  WRITE-SET: ${expected.size} record fields (3 per record) changed`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a twin that walks only FIVE records is CAUGHT at the sixth", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  // broken twin: process only the first five records, leaving the sixth untouched
  let rec = ENEMY_ACTOR_TABLE;
  for (let i = 0; i < COUNT - 1; i++) {
    tickActorAnimHold(c, rec);
    rec = (rec + STRIDE) & 0xffff;
  }

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an under-walk — it is worthless");
  const sixth = recBase(COUNT - 1);
  assert.ok(d.addr >= sixth && d.addr < sixth + STRIDE, `teeth caught ${hx(d.addr ?? 0)}, expected inside the 6th record ${hx(sixth)}`);
  console.log(`  TEETH: five-record under-walk caught in the 6th record at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
