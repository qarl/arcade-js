// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for descendObjectThenAdvanceStateAtBottom (ROM 0x6aa8, Pooyan) — "state-1 step of a descending object
 * record (IX)". Runs the shared animation helper (advanceObjectAnimationFrame), then subtracts the speed (IX+9) from the
 * 16-bit position (IX+6):(IX+5) — a low-byte borrow decrements the high byte. While the high byte is
 * non-zero it returns; on reaching zero it re-arms the tilemap-sum latch (0x8f56 := 0) and advances
 * the record's state byte (IX+2).
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine writes work RAM, so
 * every case uses a FRESH clone per side, compared on RAM (dumpState, minus stack scratch below the entry SP).
 *
 * LIVE-OUT: none — memory-only. Reached as a tail dispatch (dispatchDescendingObjectState table[0]) whose ret unwinds to a
 * per-record sweep that reads no result register; all effect is in the record and the latch. The
 * animation helper is exercised on the minimal branch (a non-zero hold, which it merely decrements)
 * so each case isolates descendObjectThenAdvanceStateAtBottom's own descent logic.
 *
 * Jobs:
 *   1. EQUAL (crafted) — no-borrow, borrow-with-high-byte-left, and three ways of reaching zero
 *      (borrow to 0, high byte already 0, borrow across the low byte): oracle == module (RAM −stack).
 *   2. WRITE-SET — a still-descending case and a reached-zero case change the identical cell set;
 *      only the reached-zero case touches the latch (0x8f56) and the state byte (IX+2).
 *   3. TEETH — a twin with a wrong stored low byte (every path) and a twin with a wrong advanced
 *      state byte (zero path) are both CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6aa8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6aa8 as oracle } from "../../translated/loc_6aa8.js";
import { descendObjectThenAdvanceStateAtBottom } from "../descendObjectThenAdvanceStateAtBottom.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8be8; // a work-RAM record base, disjoint from the latch and the stack window
const LATCH = 0x8f56; // TILE_SUM_ONCE_LATCH
const HOLD = 0x05; // a non-zero animation hold: advanceObjectAnimationFrame merely decrements it (minimal, deterministic)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// The dead stack is excluded: the oracle's call/ret framing pushes return addresses there while the
// cycle-free module never touches the stack.
function changedAddrs(m, run) {
  const before = m.dumpState();
  run(m);
  const after = m.dumpState();
  const out = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] === after[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    out.push(addr);
  }
  return out.sort((a, b) => a - b);
}

/** A fresh clone: record pre-dirtied, position/speed/state seated, animation hold non-zero, latch set. */
function craft({ lo, hi, speed, state = 0x01 }) {
  const m = BASE.clone();
  for (let i = 0; i < 0x18; i++) m.mem.write8((REC + i) & 0xffff, 0xaa);
  m.mem.write8(REC + 5, lo);
  m.mem.write8(REC + 6, hi);
  m.mem.write8(REC + 9, speed);
  m.mem.write8(REC + 2, state);
  m.mem.write8(REC + 0x0e, HOLD); // advanceObjectAnimationFrame just decrements this (isolates the descent logic)
  m.mem.write8(LATCH, 0x01); // set so the re-arm (-> 0) is observable
  m.regs.ix = REC;
  m.regs.sp = 0x8ffe; // dead stack: the oracle's call/ret framing touches excluded RAM only
  return m;
}

const CASES = [
  { name: "no borrow, high byte stays", opts: { lo: 0x50, hi: 0x02, speed: 0x10 } },
  { name: "borrow, high byte still non-zero", opts: { lo: 0x05, hi: 0x02, speed: 0x10 } },
  { name: "borrow to zero (re-arm + advance)", opts: { lo: 0x05, hi: 0x01, speed: 0x10 } },
  { name: "high byte already zero (re-arm + advance)", opts: { lo: 0x50, hi: 0x00, speed: 0x10 } },
  { name: "borrow across low byte to zero", opts: { lo: 0x00, hi: 0x01, speed: 0x01 } },
  { name: "exact low byte, no borrow", opts: { lo: 0x10, hi: 0x03, speed: 0x10 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted descend cases — descendObjectThenAdvanceStateAtBottom == oracle in RAM (−stack)", () => {
  for (const { name, opts } of CASES) {
    const o = craft(opts);
    const c = craft(opts);
    oracle(o);
    descendObjectThenAdvanceStateAtBottom(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: descending vs reached-zero change identical sets; only zero touches latch + IX+2", () => {
  const descend = { lo: 0x50, hi: 0x02, speed: 0x10 }; // ret path (still descending)
  const oSet = changedAddrs(craft(descend), oracle);
  const cSet = changedAddrs(craft(descend), descendObjectThenAdvanceStateAtBottom);
  assert.deepEqual(cSet, oSet, "descending: module and oracle must change the identical set");
  assert.ok(!oSet.includes(LATCH), "descending must NOT touch the latch");
  assert.ok(!oSet.includes(REC + 2), "descending must NOT advance the state byte");

  const zero = { lo: 0x50, hi: 0x00, speed: 0x10 }; // reached-zero path
  const oZero = changedAddrs(craft(zero), oracle);
  const cZero = changedAddrs(craft(zero), descendObjectThenAdvanceStateAtBottom);
  assert.deepEqual(cZero, oZero, "reached-zero: module and oracle must change the identical set");
  assert.ok(oZero.includes(LATCH), "reached-zero must re-arm the latch");
  assert.ok(oZero.includes(REC + 2), "reached-zero must advance the state byte");
  console.log(`  WRITE-SET: descend -> ${oSet.length} cells (no latch); zero -> ${oZero.length} cells (latch + IX+2)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong stored low byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[0].opts);
  const c = craft(CASES[0].opts);
  oracle(o);
  descendObjectThenAdvanceStateAtBottom(c);
  c.mem.write8(REC + 5, (c.mem.read8(REC + 5) ^ 0x01) & 0xff); // BUG: wrong descended low byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong low byte — it is worthless");
  assert.equal(d.addr, REC + 5, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(lo): wrong IX+5 caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced state byte (zero path) is CAUGHT by the RAM diff", () => {
  const zero = { lo: 0x50, hi: 0x00, speed: 0x10 };
  const o = craft(zero);
  const c = craft(zero);
  oracle(o);
  descendObjectThenAdvanceStateAtBottom(c);
  c.mem.write8(REC + 2, (c.mem.read8(REC + 2) + 1) & 0xff); // BUG: state advanced one too far
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong state byte — it is worthless");
  assert.equal(d.addr, REC + 2, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(state): wrong IX+2 caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
