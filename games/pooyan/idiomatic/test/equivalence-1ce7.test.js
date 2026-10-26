// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stampCappedTileColumnUp (ROM 0x1ce7) — "stamp a three-cell column, cap first". The
 * oracle points HL at 0x84e0, writes the cap tile 0x02 there, then falls through into loc_1cec
 * (the fixed-up-stride body paint), which steps up one row (0x84c0 := 0x25) and up another
 * (0x84a0 := 0x20). Net footprint: three tilemap cells.
 *
 * This is the cycle-free / memory-equivalence gate. The routine WRITES video RAM, so every case
 * uses a FRESH clone per side. stampCappedTileColumnUp takes no register inputs (it loads its own HL) and leaves
 * nothing live in a register a caller reads (loc_1cec advances HL to 0x84a0 but no caller consumes
 * it), so the contract is RAM only; pc/SP/cycles are deliberately NOT compared.
 *
 * Jobs:
 *   1. EQUAL — stampCappedTileColumnUp == oracle in RAM (−stack).
 *   2. WRITE-SET — the oracle changes exactly the three column cells := 0x02/0x25/0x20 (minus stack).
 *   3. CRAFTED (overwrite) — pre-dirty the three cells to 0xAA; both overwrite to the column tiles.
 *   4. TEETH — a wrong byte at the base cell MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1ce7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1ce7 as oracle } from "../../translated/loc_1ce7.js";
import { stampCappedTileColumnUp } from "../stampCappedTileColumnUp.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
// The three cells and their tiles: cap (start), mid (start-0x20), base (start-0x40).
const CAP_CELL = 0x84e0;
const MID_CELL = 0x84c0;
const BASE_CELL = 0x84a0;
const EXPECT = { [CAP_CELL]: 0x02, [MID_CELL]: 0x25, [BASE_CELL]: 0x20 };
const CELLS = [CAP_CELL, MID_CELL, BASE_CELL];

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone; stampCappedTileColumnUp has no register inputs, so only SP (in work RAM) is seated. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // the tail call's ret pops here; excluded as stack scratch
  return m;
}

// -- 1. EQUAL ----------------------------------------------------------------

test("EQUAL: stampCappedTileColumnUp == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  stampCappedTileColumnUp(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  console.log("  EQUAL: identical in RAM (−stack)");
});

// -- 2. WRITE-SET ------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly the three column cells (minus stack)", () => {
  const before = craft();
  const after = craft();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push({ addr, to: a1[off] });
    }
  }
  assert.equal(changed.length, CELLS.length, `expected ${CELLS.length} written cells, got ${changed.length}`);
  for (const ch of changed) {
    assert.equal(ch.to, EXPECT[ch.addr], `cell ${hx(ch.addr)} must be ${hx(EXPECT[ch.addr])}, got ${ch.to}`);
  }
  console.log(`  WRITE-SET: ${hx(CAP_CELL)}:=0x02 ${hx(MID_CELL)}:=0x25 ${hx(BASE_CELL)}:=0x20`);
});

// -- 3. CRAFTED (overwrite) --------------------------------------------------

test("CRAFTED: pre-dirtied column cells are overwritten identically", () => {
  const o = craft();
  const c = craft();
  for (const cell of CELLS) {
    o.mem.write8(cell, 0xaa);
    c.mem.write8(cell, 0xaa);
  }
  oracle(o);
  stampCappedTileColumnUp(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  for (const cell of CELLS) {
    assert.equal(c.mem.read8(cell), EXPECT[cell], `cell ${hx(cell)} not overwritten to its tile`);
  }
  console.log("  CRAFTED: all three dirtied cells overwritten to the column tiles");
});

// -- 4. TEETH ----------------------------------------------------------------

test("TEETH: a wrong base-cell byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  stampCappedTileColumnUp(c);
  c.mem.write8(BASE_CELL, 0x00); // BUG: base cell must be 0x20, not 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong base-cell byte — it is worthless");
  assert.equal(d.addr, BASE_CELL, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(BASE_CELL)})`);
  console.log(`  TEETH: wrong base byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
