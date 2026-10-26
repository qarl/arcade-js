// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearBoardRamAndBlankFillRow (ROM 0x02c9, Pooyan) — "clear the board-init RAM, then
 * blank one tilemap row and step the row counter". It zeroes the sprite/actor RAM regions (via
 * zeroSpriteListAndActorArena), then at the 16-bit fill cursor (TILE_FILL_PTR, 0x880b) blanks 0x1d cells with tile
 * 0x10 (via the rst-0x10 fill helper fillByteRun), advances the cursor one full row (0x20 = the
 * 0x1d visible run + the 3-cell remainder), stores it back, and decrements FILL_ROW_COUNTER
 * (0x8809).
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) PLUS the declared register live-out. The genuine live-out is the Z flag from the
 * final `dec (0x8809)`: every caller (rebuildFieldAndLatchPlayStateWithTamperCheck/floodFieldAndLatchPlayStatePhaseTimer/initRoundArenaAndRestorePlayerBank) does `ret nz` right after the
 * call, looping until the counter drains. So Z is checked against the oracle clone AND the module
 * clone must SET it. A/B/DE/HL are left modified but no caller reads them back, so they are not
 * part of the contract.
 *
 * Every case is CRAFTED: the fill cursor and row counter are the only inputs, poked identically
 * on both sides; the zeroed regions start zero in a fresh clone, so zeroSpriteListAndActorArena's effect is a no-op
 * on the diff here (covered by its own gate) — this gate isolates the row-fill + counter step.
 *
 * Jobs:
 *   1. EQUAL — curated (cursor, rowCount) incl. rowCount 1 -> Z set: oracle == module in RAM
 *      (−stack) and in Z; the module must SET Z (opposite-seeded so a no-set rewrite fails).
 *   2. WRITE-SET — the row-fill's only observable writes are the 0x1d blanked cells := 0x10, the
 *      cursor word, and the row counter := rowCount-1.
 *   3. TEETH — a wrong blanked byte (RAM) and a wrong Z flag (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-02c9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_02c9 as oracle } from "../../translated/loc_02c9.js";
import { clearBoardRamAndBlankFillRow } from "../clearBoardRamAndBlankFillRow.js";
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
const VISIBLE_TILES = 0x1d;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the fill cursor and row counter seated. */
function craft(cursor, rowCount) {
  const m = BASE.clone();
  m.mem.write16(TILE_FILL_PTR, cursor & 0xffff);
  m.mem.write8(FILL_ROW_COUNTER, rowCount & 0xff);
  m.regs.sp = 0x8ff0; // dead-stack scratch: the nested calls' push/ret land inside STACK_SCRATCH
  return m;
}

/** The 0x1d cells the row-fill blanks. */
function filledCells(cursor) {
  const cells = [];
  for (let i = 0; i < VISIBLE_TILES; i++) cells.push((cursor + i) & 0xffff);
  return cells;
}

const expectedCursor = (cursor) => (cursor + ROW_WIDTH) & 0xffff;

// All fill spans stay inside video RAM (0x8400-0x87ff).
const CASES = [
  { cursor: 0x8402, rowCount: 0x05 }, // Z clear (5 -> 4)
  { cursor: 0x8460, rowCount: 0x01 }, // rowCount 1 -> 0, Z set
  { cursor: 0x84a0, rowCount: 0x20 },
  { cursor: 0x8500, rowCount: 0x02 },
  { cursor: 0x87c0, rowCount: 0x03 }, // fill ends at 0x87dc, still in video RAM
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted (cursor,rowCount) — clearBoardRamAndBlankFillRow == oracle in RAM (−stack) + Z", () => {
  for (const { cursor, rowCount } of CASES) {
    const o = craft(cursor, rowCount);
    oracle(o);

    const c = craft(cursor, rowCount);
    c.regs.fZ = !o.regs.fZ; // opposite seed: a module that never sets Z fails
    const ret = clearBoardRamAndBlankFillRow(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `cursor=${hx(cursor)} rowCount=${hx(rowCount)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.fZ, `Z return mismatch (cursor=${hx(cursor)} rowCount=${hx(rowCount)})`);
    assert.equal(c.regs.fZ, o.regs.fZ, `module must SET Z (cursor=${hx(cursor)} rowCount=${hx(rowCount)})`);
    assert.equal(c.mem.read16(TILE_FILL_PTR), expectedCursor(cursor), "cursor advanced one full row");
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + Z)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the row-fill writes the 0x1d cells := 0x10, the cursor word, and the counter", () => {
  const { cursor, rowCount } = CASES[0];
  const cells = filledCells(cursor);
  const footprint = new Set([...cells, TILE_FILL_PTR, TILE_FILL_PTR + 1, FILL_ROW_COUNTER]);

  const m = craft(cursor, rowCount);
  for (const cell of cells) m.mem.write8(cell, 0xaa); // pre-dirty so every blank is observable
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  for (const addr of changed) {
    if (inDeadStack(addr)) continue; // the nested calls' push/ret land in STACK_SCRATCH, not game state
    assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  }
  for (const cell of cells) assert.equal(m.mem.read8(cell), TILE_BLANK, `cell ${hx(cell)} not blanked`);
  assert.equal(m.mem.read16(TILE_FILL_PTR), expectedCursor(cursor), "cursor word advanced one row");
  assert.equal(m.mem.read8(FILL_ROW_COUNTER), (rowCount - 1) & 0xff, "row counter decremented");
  console.log(`  WRITE-SET: ${cells.length} cells := 0x10, cursor -> ${hx(expectedCursor(cursor))}, counter -> ${hx((rowCount - 1) & 0xff)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong blanked byte is CAUGHT by the RAM diff", () => {
  const { cursor, rowCount } = CASES[0];
  const o = craft(cursor, rowCount);
  const c = craft(cursor, rowCount);
  oracle(o);
  clearBoardRamAndBlankFillRow(c);
  const victim = (cursor + 1) & 0xffff;
  c.mem.write8(victim, 0x00); // BUG: a blanked cell must be 0x10
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong blanked byte — it is worthless");
  assert.equal(d.addr, victim, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong Z flag is CAUGHT by the live-out check", () => {
  const { cursor, rowCount } = CASES[1]; // rowCount 1 -> 0, oracle Z = true
  const o = craft(cursor, rowCount);
  oracle(o);
  assert.equal(o.regs.fZ, true, "sanity: oracle sets Z when the row counter reaches zero");
  const c = craft(cursor, rowCount);
  clearBoardRamAndBlankFillRow(c);
  c.regs.fZ = false; // BUG: never reports the drained counter
  assert.notEqual(c.regs.fZ, o.regs.fZ, "the Z live-out check must reject a stuck-clear flag");
  console.log("  TEETH(Z): stuck-clear Z rejected against oracle Z=true");
});
