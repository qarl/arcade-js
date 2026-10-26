// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceRecordStateAndSeedMoveScript (ROM 0x2c85) — per-record transition helper: only
 * when the record's state (ix+0x02) is 0x11 does it advance the state to 0x12, point the
 * record at an animation sequence via loc_381e (setActorAnimation, writing ix+0x0c..0x0e),
 * seed a little-endian script pointer 0x2d00 into ix+0x16/0x17, and clear ix+0x15.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine
 * WRITES the record, so each case uses a FRESH clone per side: the oracle runs on one clone,
 * advanceRecordStateAndSeedMoveScript on another, and they are compared on the go-forward contract — RAM (dumpState)
 * minus stack scratch below the entry SP. pc/SP/cycles are NOT compared. advanceRecordStateAndSeedMoveScript has NO consumed register
 * live-out (a sweep helper). The oracle's `push16 + call 0x381e` writes a return address into
 * STACK_SCRATCH which the idiomatic direct call does not — excluded by contract.
 *
 * The leaf is reached only during the climbHunterToLaunchRowThenPromoteGroup record sweep, so every case is CRAFTED: IX is
 * seated at a work-RAM actor slot, its record window pre-dirtied to 0xAA identically on both
 * sides, and the state byte poked — so the trigger path's zero-writes (ix+0x0e/0x15/0x16) and
 * a missing write are both observable.
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over trigger and non-trigger states advanceRecordStateAndSeedMoveScript == oracle in
 *      RAM (-stack), the non-trigger states confirming the no-op early return.
 *   2. WRITE-SET — on the trigger the oracle writes exactly seven record cells to their
 *      documented values.
 *   3. TEETH — a twin that writes the wrong next state (0x13) is CAUGHT at ix+0x02; a wrong
 *      animation low byte is CAUGHT at ix+0x0c.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2c85.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c85 as oracle } from "../../translated/loc_2c85.js";
import { advanceRecordStateAndSeedMoveScript } from "../advanceRecordStateAndSeedMoveScript.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX = 0x8a80; // a work-RAM actor slot, clear of STACK_SCRATCH
const STATE_FIELD = 0x02;
const STATE_TRIGGER = 0x11;
const ANIM_SEQ = 0x2ca7; // stored little-endian into ix+0x0c/0x0d
const SCRIPT_PTR = 0x2d00; // stored little-endian into ix+0x16/0x17
// Expected trigger-path writes: record offset -> value.
const EXPECTED = new Map([
  [0x02, 0x12],
  [0x0c, ANIM_SEQ & 0xff],
  [0x0d, ANIM_SEQ >> 8],
  [0x0e, 0x00],
  [0x15, 0x00],
  [0x16, SCRIPT_PTR & 0xff],
  [0x17, SCRIPT_PTR >> 8],
]);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** IX seated, record window pre-dirtied to 0xAA, state byte poked. */
function craft(state) {
  const m = BASE.clone();
  m.regs.ix = IX;
  for (let off = 0; off <= 0x17; off++) m.mem.write8(IX + off, 0xaa);
  m.mem.write8(IX + STATE_FIELD, state & 0xff);
  m.regs.sp = 0x8ffe;
  return m;
}

const STATES = [0x11, 0x00, 0x10, 0x12, 0xff];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted states — advanceRecordStateAndSeedMoveScript == oracle in RAM (−stack)", () => {
  for (const state of STATES) {
    const o = craft(state);
    const c = craft(state);
    oracle(o);
    advanceRecordStateAndSeedMoveScript(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (state=${hx(state)})`);
  }
  console.log(`  EQUAL: ${STATES.length} crafted states identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the trigger writes exactly seven record cells to their documented values", () => {
  const mm = craft(STATE_TRIGGER);
  const b0 = mm.dumpState();
  oracle(mm);
  const a1 = mm.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = mm.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's push16+call return address lands in STACK_SCRATCH, not record state
    changed.push({ addr, to: a1[off] });
  }
  assert.equal(changed.length, EXPECTED.size, `expected ${EXPECTED.size} written cells, got ${changed.length}`);
  for (const { addr, to } of changed) {
    const rel = addr - IX;
    assert.ok(EXPECTED.has(rel), `oracle wrote an unexpected cell at ${hx(addr)} (ix+${hx(rel)})`);
    assert.equal(to, EXPECTED.get(rel), `ix+${hx(rel)} must be ${hx(EXPECTED.get(rel))}, got ${hx(to)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} record cells written to their documented values`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: writes the wrong next state (0x13, not 0x12). */
function brokenNextState(m, rec = m.regs.ix) {
  const { mem8 } = m;
  if (mem8[rec + STATE_FIELD] !== STATE_TRIGGER) return;
  mem8[rec + STATE_FIELD] = 0x13; // BUG: next state must be 0x12
}

test("TEETH: a wrong next state is CAUGHT at ix+0x02", () => {
  const o = craft(STATE_TRIGGER);
  const c = craft(STATE_TRIGGER);
  oracle(o);
  brokenNextState(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the wrong next state");
  assert.equal(d.addr, (IX + STATE_FIELD) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/state: wrong next state caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong animation low byte is CAUGHT at ix+0x0c", () => {
  const o = craft(STATE_TRIGGER);
  const c = craft(STATE_TRIGGER);
  oracle(o);
  advanceRecordStateAndSeedMoveScript(c);
  c.mem.write8(IX + 0x0c, 0x00); // BUG: must hold the anim-sequence low byte 0xa7
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong animation byte");
  assert.equal(d.addr, (IX + 0x0c) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/anim: wrong anim low byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
