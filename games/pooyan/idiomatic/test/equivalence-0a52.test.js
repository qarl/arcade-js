// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintTwo2x2TileBlocks (ROM 0x0a52) — "paint two 2x2 tile blocks": the oracle
 * loads HL=0x82aa / DE=0x0a72 and calls the 2x2 block copier (0x0a40), then HL=0x826a / DE=0x0a72
 * and calls it again. Both blocks read the SAME four-byte source pattern at 0x0a72 (in ROM), so the
 * two 2x2 squares end up identical byte-for-byte.
 *
 * This is the cycle-free / memory-equivalence gate. The routine WRITES video RAM and reads a ROM
 * table, so every case uses a FRESH clone per side. The oracle runs on one clone, paintTwo2x2TileBlocks on
 * another, compared on RAM (dumpState, minus stack scratch below the entry SP). paintTwo2x2TileBlocks takes no register inputs (it
 * loads its own HL/DE), and leaves nothing live in a register for its caller — so the contract is
 * RAM only; pc/SP/cycles are deliberately NOT compared.
 *
 * The 2x2 copier writes four cells per block: dst, dst+1, dst+0x21, dst+0x20 (top row then the row
 * below). So the write footprint is the eight cells of the two blocks.
 *
 * Jobs:
 *   1. EQUAL — paintTwo2x2TileBlocks == oracle in RAM (−stack).
 *   2. WRITE-SET — the oracle changes exactly the eight block cells (minus stack).
 *   3. CRAFTED (overwrite) — pre-dirty the eight cells to 0xAA on both sides; both overwrite.
 *   4. TEETH — a wrong byte at one block cell MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0a52.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a52 as oracle } from "../../translated/loc_0a52.js";
import { paintTwo2x2TileBlocks } from "../paintTwo2x2TileBlocks.js";
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
const DEST_A = 0x82aa;
const DEST_B = 0x826a;

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone; paintTwo2x2TileBlocks has no register inputs, so only SP (in work RAM) is seated. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // the oracle's inner calls push/pop here; excluded as stack scratch
  return m;
}

/** The four cells one 2x2 block writes, in the copier's order. */
function blockCells(dst) {
  return [dst & 0xffff, (dst + 1) & 0xffff, (dst + 0x21) & 0xffff, (dst + 0x20) & 0xffff];
}
const ALL_CELLS = [...blockCells(DEST_A), ...blockCells(DEST_B)];

// -- 1. EQUAL ----------------------------------------------------------------

test("EQUAL: paintTwo2x2TileBlocks == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  paintTwo2x2TileBlocks(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  console.log("  EQUAL: identical in RAM (−stack)");
});

// -- 2. WRITE-SET ------------------------------------------------------------

test("WRITE-SET: the oracle changes exactly the eight block cells (minus stack)", () => {
  const before = craft();
  const after = craft();
  // The source pattern at 0x0a72 is all-zero and fresh VRAM is already zero, so the eight 0x00
  // writes are invisible against an untouched baseline. Seat a sentinel that differs from the
  // written value on BOTH sides (identically, so only the oracle's writes create the diff) — then
  // the copier overwriting each cell to 0x00 registers as a change. Mirrors the CRAFTED job.
  for (const cell of ALL_CELLS) { before.mem.write8(cell, 0xaa); after.mem.write8(cell, 0xaa); }
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
  }
  const addrs = new Set(changed);
  assert.equal(changed.length, ALL_CELLS.length, `expected ${ALL_CELLS.length} written cells, got ${changed.length}`);
  for (const cell of ALL_CELLS) assert.ok(addrs.has(cell), `expected a write at ${hx(cell)}`);
  console.log(`  WRITE-SET: ${ALL_CELLS.length} block cells written`);
});

// -- 3. CRAFTED (overwrite) --------------------------------------------------

test("CRAFTED: pre-dirtied block cells are overwritten identically", () => {
  const o = craft();
  const c = craft();
  for (const cell of ALL_CELLS) {
    o.mem.write8(cell, 0xaa);
    c.mem.write8(cell, 0xaa);
  }
  oracle(o);
  paintTwo2x2TileBlocks(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  for (const cell of ALL_CELLS) {
    assert.equal(c.mem.read8(cell), o.mem.read8(cell), `cell ${hx(cell)} mismatch after overwrite`);
    assert.notEqual(c.mem.read8(cell), 0xaa, `cell ${hx(cell)} was not overwritten`);
  }
  console.log("  CRAFTED: all eight dirtied cells overwritten to the source pattern");
});

// -- 4. TEETH ----------------------------------------------------------------

test("TEETH: a wrong byte at a block cell is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  paintTwo2x2TileBlocks(c);
  const victim = ALL_CELLS[ALL_CELLS.length - 1];
  c.mem.write8(victim, (o.mem.read8(victim) ^ 0xff) & 0xff); // BUG: corrupt one tile

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong block byte — it is worthless");
  assert.equal(d.addr, victim, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(victim)})`);
  console.log(`  TEETH: wrong block byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
