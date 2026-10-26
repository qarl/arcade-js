// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorToTopRowThenRetire (ROM 0x667c, Pooyan) — "advance one actor while
 * its state byte is idle, retiring it at the top row". It runs only while (IX+1) is 0,
 * adds the step (IX+9) into the sub-position (IX+5) carrying one row into (IX+6), and once
 * (IX+6) reaches 0x1d retires the record: (IX+1)=2 with (IX+4)/(IX+6) cleared.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState,
 * minus stack scratch below the entry SP). The routine is memory-only — the caller (advanceActorGroupRiseAndCycleTiles) reads no
 * register or flag back (it exx/addIx/djnz on its own state) — so no register is compared.
 * IX is the incoming record pointer, seated via the module's register-default bridge.
 *
 * Jobs:
 *   1. EQUAL (crafted) — the idle-guard early return, a no-carry advance, a carry advance,
 *      and retirement reached both with and without a carry: oracle == module in RAM.
 *   2. WRITE-SET — the retire path writes exactly {IX+1, IX+4, IX+5, IX+6}.
 *   3. TEETH — a twin that retires to the wrong state byte, and a twin that leaves (IX+4)
 *      uncleared, are both CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-667c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_667c as oracle } from "../../translated/loc_667c.js";
import { advanceActorToTopRowThenRetire } from "../advanceActorToTopRowThenRetire.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ba0; // an object-record base in work RAM
const OFF_STATE = 0x01;
const OFF_CLEAR = 0x04;
const OFF_SUBPOS = 0x05;
const OFF_ROW = 0x06;
const OFF_STEP = 0x09;
const RETIRE_ROW = 0x1d;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the record fields seated; (IX+4) pre-dirtied so its clear shows. */
function craft(state, subpos, step, row) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.mem.write8(REC + OFF_STATE, state);
  m.mem.write8(REC + OFF_CLEAR, 0x55);
  m.mem.write8(REC + OFF_SUBPOS, subpos);
  m.mem.write8(REC + OFF_ROW, row);
  m.mem.write8(REC + OFF_STEP, step);
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [
  { name: "idle guard (state nonzero)", state: 0x01, subpos: 0x10, step: 0x05, row: 0x00 },
  { name: "no-carry advance", state: 0x00, subpos: 0x10, step: 0x05, row: 0x00 },
  { name: "carry advance", state: 0x00, subpos: 0xf0, step: 0x20, row: 0x02 },
  { name: "retire (no carry)", state: 0x00, subpos: 0x10, step: 0x05, row: RETIRE_ROW },
  { name: "retire (via carry to 0x1d)", state: 0x00, subpos: 0xf0, step: 0x20, row: 0x1c },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted record cases — advanceActorToTopRowThenRetire == oracle in RAM (−stack)", () => {
  for (const { name, state, subpos, step, row } of CASES) {
    const o = craft(state, subpos, step, row);
    const c = craft(state, subpos, step, row);
    oracle(o);
    advanceActorToTopRowThenRetire(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the retire path writes exactly {IX+1, IX+4, IX+5, IX+6}", () => {
  const m = craft(0x00, 0x10, 0x05, RETIRE_ROW);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  const set = new Set(changed);
  assert.equal(changed.length, 4, `expected 4 writes, got ${changed.length}: ${changed.map(hx)}`);
  for (const cell of [REC + OFF_STATE, REC + OFF_CLEAR, REC + OFF_SUBPOS, REC + OFF_ROW]) {
    assert.ok(set.has(cell), `missing a write at ${hx(cell)}`);
  }
  assert.equal(m.mem.read8(REC + OFF_STATE), 0x02, "retired state should be 0x02");
  console.log("  WRITE-SET: retire -> {IX+1:=2, IX+4:=0, IX+5, IX+6:=0} (4 cells)");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: retires to state 3 instead of 2. */
function brokenRetireState(m, rec = m.regs.ix) {
  if (m.mem.read8(rec + OFF_STATE) !== 0) return;
  const sum = m.mem.read8(rec + OFF_SUBPOS) + m.mem.read8(rec + OFF_STEP);
  if (sum > 0xff) m.mem.write8(rec + OFF_ROW, (m.mem.read8(rec + OFF_ROW) + 1) & 0xff);
  m.mem.write8(rec + OFF_SUBPOS, sum & 0xff);
  if (m.mem.read8(rec + OFF_ROW) < RETIRE_ROW) return;
  m.mem.write8(rec + OFF_STATE, 0x03); // BUG: should be 0x02
  m.mem.write8(rec + OFF_CLEAR, 0);
  m.mem.write8(rec + OFF_ROW, 0);
}

/** Broken twin: retires but leaves (IX+4) uncleared. */
function brokenNoClear(m, rec = m.regs.ix) {
  if (m.mem.read8(rec + OFF_STATE) !== 0) return;
  const sum = m.mem.read8(rec + OFF_SUBPOS) + m.mem.read8(rec + OFF_STEP);
  if (sum > 0xff) m.mem.write8(rec + OFF_ROW, (m.mem.read8(rec + OFF_ROW) + 1) & 0xff);
  m.mem.write8(rec + OFF_SUBPOS, sum & 0xff);
  if (m.mem.read8(rec + OFF_ROW) < RETIRE_ROW) return;
  m.mem.write8(rec + OFF_STATE, 0x02);
  // BUG: (IX+4) left dirty
  m.mem.write8(rec + OFF_ROW, 0);
}

test("TEETH: a wrong retired state byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00, 0x10, 0x05, RETIRE_ROW);
  const c = craft(0x00, 0x10, 0x05, RETIRE_ROW);
  oracle(o);
  brokenRetireState(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong retire state — it is worthless");
  assert.equal(d.addr, REC + OFF_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(state): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an uncleared (IX+4) on retire is CAUGHT by the RAM diff", () => {
  const o = craft(0x00, 0x10, 0x05, RETIRE_ROW);
  const c = craft(0x00, 0x10, 0x05, RETIRE_ROW);
  oracle(o);
  brokenNoClear(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an uncleared field — it is worthless");
  assert.equal(d.addr, REC + OFF_CLEAR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(clear): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
