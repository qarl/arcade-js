// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stepPairedDescendingObjects (ROM 0x69ad) — "step eight paired descending-object
 * records through advancePairedDescendingObjectStep": walk the enemy-actor table (ix from 0x8ae0) and the object-state
 * record base (iy from 0x8ba0) in lockstep, one 0x18 stride apart, advancing each pair one step.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES
 * work RAM through advancePairedDescendingObjectStep, so each case uses a FRESH clone per side: the oracle runs on one clone,
 * stepPairedDescendingObjects on another, compared on the go-forward contract — RAM (dumpState) minus stack scratch below the entry SP.
 * pc/SP/cycles are NOT compared. LIVE-OUT is memory only: stepPairedDescendingObjects's caller (runPerFrameObjectSubPasses) issues it and
 * moves on, consuming no register result; the oracle's shadow-register (exx) juggling only protects
 * its loop counter and stride and leaves no game state, so no register is compared. The sequencer
 * and wipe helpers frame their work on the stack, which is excluded.
 *
 * The eight records are seated identically on both sides. To keep the per-record sequencer
 * deterministic every active record carries a non-zero animation hold (+0x0e), so advanceObjectAnimationFrame only
 * decrements that field and the descend path writes exactly {ix+5, ix+0x0e, iy+5}.
 *
 * Jobs:
 *   1. EQUAL — all eight records active + descending: stepPairedDescendingObjects == oracle in RAM (−stack).
 *   2. WRITE-SET — the sweep writes exactly the 24 cells {ix_n+5, ix_n+0x0e, iy_n+5}, n=0..7.
 *   3. TEETH — a twin that sweeps only seven pairs (missing the last) is CAUGHT; and a wrong
 *      descended byte in the first record is CAUGHT at its address.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-69ad.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_69ad as oracle } from "../../translated/loc_69ad.js";
import { stepPairedDescendingObjects } from "../stepPairedDescendingObjects.js";
import { advancePairedDescendingObjectStep } from "../advancePairedDescendingObjectStep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX_BASE = 0x8ae0; // ENEMY_ACTOR_TABLE
const IY_BASE = 0x8ba0; // OBJECT_STATE_RECORD_BASE
const STRIDE = 0x18;
const PAIRS = 8;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const ixRec = (n) => IX_BASE + n * STRIDE;
const iyRec = (n) => IY_BASE + n * STRIDE;

// Descend-no-borrow record template (mirrors the advancePairedDescendingObjectStep gate's own scenario): active (+0),
// idle (+2==0), non-zero hold (+0x0e), high byte 0x03 (descends without gate/wipe), delta < value.
function seatRecord(m, ix, iy) {
  m.mem.write8(ix + 0x00, 0x01);
  m.mem.write8(ix + 0x02, 0x00);
  m.mem.write8(ix + 0x05, 0x40);
  m.mem.write8(ix + 0x06, 0x03);
  m.mem.write8(ix + 0x09, 0x10);
  m.mem.write8(ix + 0x0e, 0x05);
  m.mem.write8(iy + 0x05, 0x50);
  m.mem.write8(iy + 0x06, 0x02);
  m.mem.write8(iy + 0x09, 0x20);
}

function craft() {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // in work RAM; the oracle's calls/rets only POP (read) STACK_SCRATCH
  for (let n = 0; n < PAIRS; n++) seatRecord(m, ixRec(n), iyRec(n));
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: eight active descending pairs — stepPairedDescendingObjects == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  stepPairedDescendingObjects(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  // Independent spot check: each pair descended by its delta (no borrow), hold decremented.
  for (let n = 0; n < PAIRS; n++) {
    assert.equal(c.mem.read8(ixRec(n) + 0x05), 0x30, `ix${n}+5`);
    assert.equal(c.mem.read8(ixRec(n) + 0x0e), 0x04, `ix${n}+0x0e`);
    assert.equal(c.mem.read8(iyRec(n) + 0x05), 0x30, `iy${n}+5`);
  }
  console.log(`  EQUAL: ${PAIRS} pairs stepped identically (RAM −stack) + spot checks`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the sweep writes exactly {ix_n+5, ix_n+0x0e, iy_n+5} for n=0..7", () => {
  const m = craft();
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) changed.push(addr);
  }
  const expected = [];
  for (let n = 0; n < PAIRS; n++) expected.push(ixRec(n) + 0x05, ixRec(n) + 0x0e, iyRec(n) + 0x05);
  const set = new Set(changed);
  assert.equal(changed.length, expected.length, `expected ${expected.length} writes, got ${changed.length} (${changed.map(hx)})`);
  for (const cell of expected) assert.ok(set.has(cell), `missing a write at ${hx(cell)}`);
  console.log(`  WRITE-SET: ${expected.length} cells across ${PAIRS} pairs`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: sweeps only seven pairs, so the eighth record is never stepped. */
function sweepSeven(m) {
  let ix = IX_BASE;
  let iy = IY_BASE;
  for (let n = 0; n < PAIRS - 1; n++) {
    advancePairedDescendingObjectStep(m, ix, iy);
    ix = (ix + STRIDE) & 0xffff;
    iy = (iy + STRIDE) & 0xffff;
  }
}

test("TEETH: a twin that sweeps only seven pairs is CAUGHT", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  sweepSeven(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a short sweep — it is worthless");
  console.log(`  TEETH/count: short sweep caught (first diff at ${hx(d.addr ?? 0)})`);
});

test("TEETH: a wrong descended byte in the first record is CAUGHT", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  stepPairedDescendingObjects(c);
  c.mem.write8(ixRec(0) + 0x05, (c.mem.read8(ixRec(0) + 0x05) ^ 0x01) & 0xff); // BUG: wrong position
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong position byte — it is worthless");
  assert.equal(d.addr, ixRec(0) + 0x05, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/pos: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
