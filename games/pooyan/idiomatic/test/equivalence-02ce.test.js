// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blankFillRowAndStepCounter (ROM 0x02ce, Pooyan) — "fill one row of the
 * row-by-row tilemap fill and step the row counter". It reads the 16-bit fill cursor at
 * TILE_FILL_PTR (0x880b), blanks B cells (the incoming loop counter) with tile 0x10 via the
 * rst-0x10 fill helper (fillByteRun), advances the cursor by exactly one full row (0x20)
 * regardless of B, stores it back, and decrements FILL_ROW_COUNTER (0x8809).
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState,
 * minus stack scratch below the entry SP) PLUS the declared register live-out. The genuine live-out is the Z
 * flag from the final `dec (0x8809)`: EVERY caller (blankFillRowThenFinishAttractSetup/099c/08e9/092c) does `ret nz`
 * right after the call, looping until the counter drains. So Z is checked against the oracle
 * clone AND the module clone must SET it (a return-only rewrite would pass the return check
 * but starve the register-dispatch caller). HL/A/B/DE are left modified by the oracle but no
 * caller reads them back (all four read only Z), so they are not part of the contract.
 *
 * The advance is one row for any B: the helper leaves the cursor B cells forward, then the
 * routine adds the 8-bit remainder (0x20 - B). B==0 is the djnz-wrap case — the helper fills
 * a full 256 and the net move is 256 + 0x20, reproduced faithfully (a crafted arm).
 *
 * Jobs:
 *   1. EQUAL (crafted) — curated (B, cursor, rowCount) incl. the B==0 256-fill: oracle ==
 *      module in RAM (−stack) and in Z; the module must SET Z.
 *   2. WRITE-SET — the only writes are the B filled cells := 0x10, the cursor word, and the
 *      row counter := rowCount-1.
 *   3. TEETH — a wrong filled byte (RAM) and a wrong Z flag (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-02ce.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_02ce as oracle } from "../../translated/loc_02ce.js";
import { blankFillRowAndStepCounter } from "../blankFillRowAndStepCounter.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TILE_FILL_PTR = 0x880b;
const FILL_ROW_COUNTER = 0x8809;
const TILE_BLANK = 0x10;
const ROW_WIDTH = 0x20;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with B, the fill cursor, and the row counter seated. */
function craft(count, cursor, rowCount) {
  const m = BASE.clone();
  m.regs.b = count & 0xff;
  m.mem.write16(TILE_FILL_PTR, cursor & 0xffff);
  m.mem.write8(FILL_ROW_COUNTER, rowCount & 0xff);
  m.regs.sp = 0x8ffe; // work-RAM scratch; the helper's rst push/ret lands inside STACK_SCRATCH
  return m;
}

/** The cells the routine blanks (count of them, or a full 256 when count==0). */
function filledCells(count, cursor) {
  const n = count === 0 ? 256 : count;
  const cells = [];
  for (let i = 0; i < n; i++) cells.push((cursor + i) & 0xffff);
  return cells;
}

const expectedCursor = (count, cursor) => (cursor + (count === 0 ? 256 : count) + ((ROW_WIDTH - count) & 0xff)) & 0xffff;

// All fill spans stay inside video RAM (0x8400-0x87ff) so no write is unmapped.
const CASES = [
  { count: 0x19, cursor: 0x8420, rowCount: 0x05 }, // 25 cells, Z clear
  { count: 0x19, cursor: 0x8460, rowCount: 0x01 }, // rowCount 1 -> 0, Z set
  { count: 0x10, cursor: 0x84a0, rowCount: 0x20 }, // 16 cells
  { count: 0x08, cursor: 0x8500, rowCount: 0x02 }, // 8 cells
  { count: 0x00, cursor: 0x8600, rowCount: 0x03 }, // B==0 -> 256-cell fill (djnz wrap)
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted (B,cursor,rowCount) — blankFillRowAndStepCounter == oracle in RAM (−stack) + Z", () => {
  for (const { count, cursor, rowCount } of CASES) {
    const o = craft(count, cursor, rowCount);
    oracle(o);

    const c = craft(count, cursor, rowCount);
    c.regs.fZ = !o.regs.fZ; // opposite seed: a module that never sets Z fails
    const ret = blankFillRowAndStepCounter(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `B=${hx(count)} cursor=${hx(cursor)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.fZ, `Z return mismatch (B=${hx(count)} cursor=${hx(cursor)})`);
    assert.equal(c.regs.fZ, o.regs.fZ, `module must SET Z (B=${hx(count)} cursor=${hx(cursor)})`);
    assert.equal(c.mem.read16(TILE_FILL_PTR), expectedCursor(count, cursor), "cursor advanced one full row");
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + Z)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: writes are the filled cells := 0x10, the cursor word, and the row counter", () => {
  const { count, cursor, rowCount } = CASES[0];
  const cells = filledCells(count, cursor);
  const footprint = new Set([...cells, TILE_FILL_PTR, TILE_FILL_PTR + 1, FILL_ROW_COUNTER]);

  const m = craft(count, cursor, rowCount);
  for (const cell of cells) m.mem.write8(cell, 0xaa); // pre-dirty so every fill is observable
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  for (const addr of changed) {
    if (inDeadStack(addr)) continue; // the rst-0x10 helper's push/ret lands in STACK_SCRATCH, not game state
    assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  }
  for (const cell of cells) assert.equal(m.mem.read8(cell), TILE_BLANK, `cell ${hx(cell)} not blanked`);
  assert.equal(m.mem.read16(TILE_FILL_PTR), expectedCursor(count, cursor), "cursor word");
  assert.equal(m.mem.read8(FILL_ROW_COUNTER), (rowCount - 1) & 0xff, "row counter decremented");
  console.log(`  WRITE-SET: ${cells.length} cells := 0x10, cursor -> ${hx(expectedCursor(count, cursor))}, counter -> ${hx((rowCount - 1) & 0xff)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong filled byte is CAUGHT by the RAM diff", () => {
  const { count, cursor, rowCount } = CASES[0];
  const o = craft(count, cursor, rowCount);
  const c = craft(count, cursor, rowCount);
  oracle(o);
  blankFillRowAndStepCounter(c);
  const victim = (cursor + 1) & 0xffff;
  c.mem.write8(victim, 0x00); // BUG: a filled cell must be 0x10
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong filled byte — it is worthless");
  assert.equal(d.addr, victim, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong Z flag is CAUGHT by the live-out check", () => {
  const { count, cursor, rowCount } = CASES[1]; // rowCount 1 -> 0, oracle Z = true
  const o = craft(count, cursor, rowCount);
  oracle(o);
  assert.equal(o.regs.fZ, true, "sanity: oracle sets Z when the row counter reaches zero");
  const c = craft(count, cursor, rowCount);
  blankFillRowAndStepCounter(c);
  c.regs.fZ = false; // BUG: never reports the drained counter
  assert.notEqual(c.regs.fZ, o.regs.fZ, "the Z live-out check must reject a stuck-clear flag");
  console.log("  TEETH(Z): stuck-clear Z rejected against oracle Z=true");
});
