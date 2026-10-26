// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for verifyPlayfieldTileChecksum (ROM 0x3278) — the board tile-sum check. While the scan gate
 * 0x8f55 is non-zero it returns at once; on the first pass (gate zero) it increments the gate, then
 * 16-bit-sums the playfield tile region from 0x8402 (walking columns to the end page 0x88) and looks
 * the sum up in the four-entry table at 0x68eb — the low byte against the entries, then the high byte
 * against the entries beyond the low match. A full match returns; a miss cannot arise from intact
 * data, so the oracle traps (a tail-jump the frozen layer models as a throw), and the module throws.
 *
 * The leaf is NOT reached in a normal boot/attract (the board-clear flag stays 0, so its caller never
 * tail-jumps here), so every case is CRAFTED. Contract: RAM only (dumpState minus stack scratch below the entry SP).
 * The routine's ONLY write is the gate increment; the exit register/flags differ by path and no
 * caller consumes them (the caller's slot loop ignores the result), so no register is a live-out.
 *
 * Jobs:
 *   1. EQUAL (early-return) — gate non-zero: the routine returns without writing, any board.
 *   2. CRAFTED (match) — gate zero + a board whose sum equals a real table entry pair: both return,
 *      RAM agrees, the gate is marked. The target sum is read from the ROM table, not hard-coded.
 *   3. CRAFTED (miss) — gate zero + a zeroed board (sum 0, absent from the table): BOTH throw, and
 *      the RAM after the throw still agrees (both marked the gate before trapping).
 *   4. WRITE-SET — on the match path the only write is the gate cell (0 -> 1).
 *   5. TEETH — a twin that forgets the gate increment MUST be caught at 0x8f55.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3278.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3278 as oracle } from "../../translated/loc_3278.js";
import { verifyPlayfieldTileChecksum } from "../verifyPlayfieldTileChecksum.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const GATE = 0x8f55;      // once-per-arm scan gate
const PLAYFIELD = 0x8402; // playfield tile-sum base
const TABLE = 0x68eb;     // four-entry expected-sum table in ROM
const END_PAGE = 0x88;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Exactly the cells the routine reads, in order — the sum footprint. */
function walkedCells() {
  const cells = [];
  let page = PLAYFIELD >> 8;
  let col = PLAYFIELD & 0xff;
  for (;;) {
    cells.push((page << 8) | col);
    col = (col + 1) & 0xff;
    if ((col & 0x1f) !== 0x1f) continue;
    const skipped = col + 3;
    col = skipped & 0xff;
    if (skipped <= 0xff) continue;
    page = (page + 1) & 0xff;
    if (page < END_PAGE) continue;
    break;
  }
  return cells;
}
const WALKED = ROM_PRESENT ? walkedCells() : [];

/** The four low-byte candidates read straight from the ROM table. */
const TBL = ROM_PRESENT ? [0, 1, 2, 3].map((i) => BASE.mem.read8(TABLE + i)) : [];

/** A fresh clone with the scan gate seated and SP in scratch. */
function craft(gateVal) {
  const m = BASE.clone();
  m.regs.sp = STACK_SCRATCH.hi - 0x10; // the oracle's ret only reads the stack (in scratch)
  m.mem.write8(GATE, gateVal);
  return m;
}

/** Zero every walked cell, then distribute `target` across them so the 16-bit sum is exactly target. */
function seedBoardSum(m, target) {
  for (const a of WALKED) m.mem.write8(a, 0x00);
  let rem = target;
  for (const a of WALKED) {
    if (rem <= 0) break;
    const v = rem < 0xff ? rem : 0xff;
    m.mem.write8(a, v);
    rem -= v;
  }
  assert.equal(rem, 0, "seedBoardSum: target not reachable with the walked-cell budget");
}

// -- 1. EQUAL (early-return) --------------------------------------------------

test("EQUAL: gate non-zero — module == oracle, no write, any board", () => {
  for (const gateVal of [0x01, 0x05, 0xff]) {
    const o = craft(gateVal);
    const c = craft(gateVal);
    // dirty a few walked cells identically; they must be left untouched on both sides.
    for (let i = 0; i < 8 && i < WALKED.length; i++) {
      o.mem.write8(WALKED[i], 0x3c);
      c.mem.write8(WALKED[i], 0x3c);
    }
    oracle(o);
    verifyPlayfieldTileChecksum(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `gate=${hx(gateVal)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.mem.read8(GATE), gateVal, `gate=${hx(gateVal)}: gate untouched on the early return`);
  }
  console.log("  EQUAL: gate-non-zero early return writes nothing");
});

// -- 2. CRAFTED (match) -------------------------------------------------------

test("CRAFTED: a board summing to a table entry — both return, RAM agrees, gate marked", () => {
  const target = (TBL[1] << 8) | TBL[0]; // low byte matches entry 0, high byte matches entry 1
  const o = craft(0x00);
  const c = craft(0x00);
  seedBoardSum(o, target);
  seedBoardSum(c, target);

  assert.doesNotThrow(() => oracle(o), "oracle should recognise the crafted board");
  assert.doesNotThrow(() => verifyPlayfieldTileChecksum(c), "module should recognise the crafted board");

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `match: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(GATE), 0x01, "match: the scan gate is marked (0 -> 1)");
  console.log(`  CRAFTED/match: board sum ${hx(target)} recognised, gate marked`);
});

// -- 2b. CRAFTED (later-index match) — the B live-out (scan counter) ----------

test("CRAFTED: a later-index match — B live-out (scan counter) matches the oracle", () => {
  if (TBL[1] === TBL[0]) { console.log("  skipped: no distinct later low entry"); return; }
  const target = (TBL[2] << 8) | TBL[1]; // low = entry 1, high = entry 2: low match beyond index 0
  const o = craft(0x00);
  const c = craft(0x00);
  seedBoardSum(o, target);
  seedBoardSum(c, target);
  assert.doesNotThrow(() => oracle(o), "oracle should recognise the later-index board");
  const ret = verifyPlayfieldTileChecksum(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `later-match: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  // positive control: a genuine later match leaves B != the entry count 4, so this arm has real teeth.
  assert.notEqual(o.regs.b & 0xff, 0x04, "control: a later match leaves B != 4");
  // B live-out: the module must set B to the oracle's scan counter (a no-set rewrite leaves B = 4).
  assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, "B live-out (scan counter) must match the oracle");
  assert.equal(ret & 0xff, o.regs.b & 0xff, "the return value is the B live-out");
  console.log(`  CRAFTED/later-match: board sum ${hx(target)} recognised, B live-out = ${hx(o.regs.b & 0xff)}`);
});

// -- 3. CRAFTED (miss) --------------------------------------------------------

test("CRAFTED: an unrecognised board — BOTH throw, RAM after the trap still agrees", () => {
  assert.ok(!TBL.includes(0x00), "positive control: 0x00 is absent from the table's low bytes");
  const o = craft(0x00);
  const c = craft(0x00);
  seedBoardSum(o, 0x0000); // sum 0, low byte 0 -> no table entry
  seedBoardSum(c, 0x0000);

  assert.throws(() => oracle(o), "oracle must trap on an unrecognised board");
  assert.throws(() => verifyPlayfieldTileChecksum(c), "module must trap on an unrecognised board");

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `miss: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(GATE), 0x01, "miss: the gate is marked before the trap");
  console.log("  CRAFTED/miss: both trap identically, gate marked before the throw");
});

// -- 4. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the match path writes only the scan gate (0 -> 1)", () => {
  const target = (TBL[1] << 8) | TBL[0];
  const before = craft(0x00);
  seedBoardSum(before, target);
  const after = before.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  const nonStack = changed.filter((a) => !inDeadStack(a));
  assert.deepEqual(nonStack, [GATE], `expected only ${hx(GATE)} to change, got ${nonStack.map(hx).join(",")}`);
  assert.equal(after.mem.read8(GATE), 0x01, "gate 0 -> 1");
  console.log(`  WRITE-SET: only ${hx(GATE)} changes (0 -> 1)`);
});

// -- 5. TEETH -----------------------------------------------------------------

test("TEETH: a forgotten gate increment is CAUGHT at 0x8f55", () => {
  const target = (TBL[1] << 8) | TBL[0];
  const o = craft(0x00);
  const c = craft(0x00);
  seedBoardSum(o, target);
  seedBoardSum(c, target);
  oracle(o);
  verifyPlayfieldTileChecksum(c);
  c.mem.write8(GATE, 0x00); // BUG: leave the scan gate unmarked

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a forgotten gate increment — it is worthless");
  assert.equal(d.addr, GATE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: forgotten gate increment caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
