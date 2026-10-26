// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for latchColumnLimitAndArmTurnAnimation (ROM 0x425c, Pooyan) — "arm the turn animation":
 * latch TURN_COLUMN_LIMIT to 0xff, then point the actor record (IX) at the fixed 0x4203
 * turn-animation script and restart it — the low byte 0x03 at rec+0x0c, the high byte 0x42
 * at rec+0x0d, and the frame index 0x00 at rec+0x0e (the shared set-animation tail).
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES work RAM, so every
 * case runs the oracle on one fresh clone and latchColumnLimitAndArmTurnAnimation on another, compared on the go-forward
 * contract: RAM (dumpState, minus stack scratch below the entry SP). There is NO register live-out — the
 * animation-arm callers discard the registers — so no register is compared. IX (the record
 * base) is the ONLY input, passed via the m.regs.ix param-default bridge.
 *
 * Jobs:
 *   1. EQUAL — over several record bases, oracle == latchColumnLimitAndArmTurnAnimation in RAM(−stack); the 0x4203
 *      pointer split (0x03/0x42) and the zeroed frame index are confirmed off the oracle.
 *   2. WRITE-SET — the only writes are TURN_COLUMN_LIMIT + rec+0x0c/0x0d/0x0e.
 *   3. TEETH — a wrong animation-pointer byte is caught at rec+0x0c, and a wrong flag value
 *      at TURN_COLUMN_LIMIT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-425c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_425c as oracle } from "../../translated/loc_425c.js";
import { latchColumnLimitAndArmTurnAnimation } from "../latchColumnLimitAndArmTurnAnimation.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TURN_COLUMN_LIMIT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TURN_ARMED = 0xff;
const ANIM_LO = 0x03; // low byte of the 0x4203 script pointer
const ANIM_HI = 0x42; // high byte of the 0x4203 script pointer
const DIRT = 0x77; //   pre-loaded into every target cell so each write is a change
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** The three record cells the routine writes, in order (anim ptr lo/hi, frame index). */
const recCells = (rec) => [(rec + 0x0c) & 0xffff, (rec + 0x0d) & 0xffff, (rec + 0x0e) & 0xffff];

/** Fresh clone: IX = record base, its three anim cells + the flag pre-dirtied, SP dead. */
function craft(rec) {
  const m = BASE.clone();
  m.regs.ix = rec & 0xffff;
  for (const cell of recCells(rec)) m.mem.write8(cell, DIRT);
  m.mem.write8(TURN_COLUMN_LIMIT, DIRT);
  m.regs.sp = 0x8ffe;
  return m;
}

// Record bases inside work RAM (rec+0x0e stays < 0x9000).
const CASES = [0x8b00, 0x8a80, 0x8bc0, 0x8c00];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: oracle == latchColumnLimitAndArmTurnAnimation in RAM(−stack); the 0x4203 split lands correctly", () => {
  for (const rec of CASES) {
    const o = craft(rec);
    const c = craft(rec);
    oracle(o);
    latchColumnLimitAndArmTurnAnimation(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (rec=${hx(rec)})`);

    const [lo, hi, fi] = recCells(rec);
    assert.equal(o.mem.read8(lo), ANIM_LO, `oracle anim-ptr low byte (rec=${hx(rec)})`);
    assert.equal(o.mem.read8(hi), ANIM_HI, `oracle anim-ptr high byte (rec=${hx(rec)})`);
    assert.equal(o.mem.read8(fi), 0x00, `oracle frame index cleared (rec=${hx(rec)})`);
    assert.equal(o.mem.read8(TURN_COLUMN_LIMIT), TURN_ARMED, `oracle flag armed (rec=${hx(rec)})`);
  }
  console.log(`  EQUAL: ${CASES.length} record bases armed identically (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the only writes are the flag + rec+0x0c/0x0d/0x0e", () => {
  const rec = CASES[0];
  const cells = recCells(rec);

  const before = craft(rec);
  const after = craft(rec);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  const addrs = new Set(changed);
  assert.equal(changed.length, 4, `expected exactly 4 written cells, got ${changed.length}`);
  for (const cell of [TURN_COLUMN_LIMIT, ...cells]) {
    assert.ok(addrs.has(cell), `expected a write at ${hx(cell)}`);
  }
  console.log(`  WRITE-SET: flag ${hx(TURN_COLUMN_LIMIT)} + ${cells.map(hx).join("/")} (4 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong animation-pointer byte is caught at rec+0x0c", () => {
  const rec = CASES[0];
  const [lo] = recCells(rec);
  const o = craft(rec);
  const c = craft(rec);
  oracle(o);
  latchColumnLimitAndArmTurnAnimation(c);
  c.mem.write8(lo, (ANIM_LO ^ 0x01) & 0xff); // BUG: corrupt the script pointer low byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong anim-pointer byte — it is worthless");
  assert.equal(d.addr, lo, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(lo)})`);
  console.log(`  TEETH/anim: wrong pointer byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong flag value is caught at TURN_COLUMN_LIMIT", () => {
  const rec = CASES[0];
  const o = craft(rec);
  const c = craft(rec);
  oracle(o);
  latchColumnLimitAndArmTurnAnimation(c);
  assert.equal(c.mem.read8(TURN_COLUMN_LIMIT), o.mem.read8(TURN_COLUMN_LIMIT), "sanity: module armed the flag like the oracle");
  c.mem.write8(TURN_COLUMN_LIMIT, 0x00); // BUG: flag must be 0xff, not 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong flag value — it is worthless");
  assert.equal(d.addr, TURN_COLUMN_LIMIT, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/flag: wrong flag caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
