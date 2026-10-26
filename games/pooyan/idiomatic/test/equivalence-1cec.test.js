// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintColumnBodyTilesUp (ROM 0x1cec) — "stamp a column's two
 * body tiles stepping one row up each time": from HL, move up one row (fixed stride -0x20)
 * and write the mid tile 0x25, move up another and write the base tile 0x20.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine
 * WRITES video RAM, so every case uses a FRESH clone per side. The oracle runs on one clone,
 * paintColumnBodyTilesUp on another, and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc is deliberately NOT compared. HL is the routine's only input; the stride (-0x20) is baked
 * in, not passed. HL advances to start-0x40 but NO caller consumes it (the callers stampCappedTileColumnUp /
 * stampSecondScrollColumn ret into clearActorsAndEnterContinueState, which reads elsewhere), so the contract is memory only.
 *
 * The two real entry HL values are 0x84e0 (from stampCappedTileColumnUp) and 0x8740 (from stampSecondScrollColumn); both are
 * in the crafted sweep. The leaf runs during board layout, not a plain attract boot, so every
 * case is CRAFTED: an identical HL poke on both sides.
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over curated starts (incl. both real entries) oracle ==
 *      paintColumnBodyTilesUp in RAM (−stack).
 *   2. WRITE-SET — the oracle's ONLY writes are start-0x20 := 0x25 and start-0x40 := 0x20.
 *   3. CRAFTED (overwrite) — pre-dirty those two cells to 0xAA identically and confirm both
 *      overwrite them to 0x25/0x20 (clear semantics, not agree-on-zero).
 *   4. TEETH — a twin that writes a WRONG tile byte at the base cell MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1cec.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1cec as oracle } from "../../translated/loc_1cec.js";
import { paintColumnBodyTilesUp } from "../paintColumnBodyTilesUp.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TILE_MID = 0x25;
const TILE_BASE = 0x20;
const ROW = 0x20; // one tilemap row
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

/** First RAM difference minus the stack scratch below the entry SP (neither side writes it here). */
function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the routine's single register input (HL) seated. */
function craft(start) {
  const m = BASE.clone();
  m.regs.hl = start & 0xffff;
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's ret only POPs (reads), never writes
  return m;
}

// The two real entry HL values plus a few more video-RAM (0x8400-0x87ff) bases.
const STARTS = [0x84e0, 0x8740, 0x8460, 0x8700, 0x87c0, 0x8442];

const midOf = (start) => (start - ROW) & 0xffff;
const baseOf = (start) => (start - ROW - ROW) & 0xffff;

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted start — paintColumnBodyTilesUp == oracle in RAM (−stack)", () => {
  for (const start of STARTS) {
    const o = craft(start);
    const c = craft(start);
    oracle(o);
    paintColumnBodyTilesUp(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} paint=${d.b} (start=${hx(start)})`);
  }
  console.log(`  EQUAL: ${STARTS.length} crafted starts identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only writes are start-0x20:=0x25 and start-0x40:=0x20", () => {
  const start = 0x84e0;
  const mid = midOf(start);
  const base = baseOf(start);

  const before = craft(start);
  const after = craft(start);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), to: a1[off] });
  }
  assert.equal(changed.length, 2, `expected exactly 2 written cells, got ${changed.length}`);
  const byAddr = new Map(changed.map((ch) => [ch.addr, ch.to]));
  assert.equal(byAddr.get(mid), TILE_MID, `mid cell ${hx(mid)} must be 0x25`);
  assert.equal(byAddr.get(base), TILE_BASE, `base cell ${hx(base)} must be 0x20`);
  console.log(`  WRITE-SET: ${hx(mid)}:=0x25, ${hx(base)}:=0x20 (2 cells)`);
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: pre-dirtied target cells are overwritten to 0x25/0x20 identically", () => {
  const start = 0x8740;
  const mid = midOf(start);
  const base = baseOf(start);

  const o = craft(start);
  const c = craft(start);
  for (const cell of [mid, base]) {
    o.mem.write8(cell, 0xaa);
    c.mem.write8(cell, 0xaa);
  }
  oracle(o);
  paintColumnBodyTilesUp(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} paint=${d.b}`);
  assert.equal(c.mem.read8(mid), TILE_MID, `mid cell not overwritten (${hx(mid)})`);
  assert.equal(c.mem.read8(base), TILE_BASE, `base cell not overwritten (${hx(base)})`);
  console.log(`  CRAFTED: ${hx(mid)}/${hx(base)} dirtied to 0xAA -> both overwrite to 0x25/0x20`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong base-cell byte is CAUGHT by the RAM diff", () => {
  const start = 0x84e0;
  const base = baseOf(start);

  const o = craft(start);
  const c = craft(start);
  oracle(o);
  paintColumnBodyTilesUp(c);
  c.mem.write8(base, 0x00); // BUG: base cell must be 0x20, not 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong base-cell byte — it is worthless");
  assert.equal(d.addr, base, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(base)})`);
  console.log(`  TEETH: wrong base byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
