// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stampSelectedGlyphBlock (ROM 0x1ffb) — "render one of two glyph blocks": bit 5 of the
 * selector register B picks a ROM 3x3 glyph source (clear -> 0x203b, set -> 0x2050) which is stamped
 * into the fixed tilemap block at 0x8062 via the already-decompiled blitTile3x3Block (0x3307).
 *
 * This is the cycle-free / memory-equivalence gate. B is the only input (bridged via the register
 * default). The successor (paintRoundNumberHud) reloads HL/DE/A after the call, so the contract is RAM only
 * (dumpState minus stack scratch below the entry SP) — there is no consumed register live-out; pc/SP/cycles are not
 * compared. The oracle stamps through the translated loc_3307, which uses the 0x8f0b row counter and
 * resets it to 0; a fresh clone has it 0, so its net footprint is just the nine tiles.
 *
 * Jobs:
 *   1. EQUAL — both bit-5 selections: oracle == stampSelectedGlyphBlock in RAM (−stack).
 *   2. WRITE-SET — exactly the nine dest cells change, each equal to its ROM source byte.
 *   3. CRAFTED — both branches are reached only by poking B bit 5 (the leaf runs mid-render); both
 *      are exercised here.
 *   4. TEETH — a twin with a wrong dest tile is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1ffb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1ffb as oracle } from "../../translated/loc_1ffb.js";
import { stampSelectedGlyphBlock } from "../stampSelectedGlyphBlock.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DEST = 0x8062;
const TABLE_A = 0x203b; // bit5 clear
const TABLE_B = 0x2050; // bit5 set

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** The nine dest cells, in row/col order (three per row, stride 0x20). */
function destCells() {
  const out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push((DEST + r * 0x20 + c) & 0xffff);
  return out;
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(selector) {
  const m = BASE.clone();
  m.regs.b = selector & 0xff;
  m.regs.sp = 0x8ffe; // oracle pushes the call return here (inside STACK_SCRATCH)
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: both bit-5 selections — stampSelectedGlyphBlock == oracle in RAM (−stack)", () => {
  for (const selector of [0x00, 0x20]) {
    const o = craft(selector);
    const c = craft(selector);
    oracle(o);
    stampSelectedGlyphBlock(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (B=${hx(selector)})`);
  }
  console.log("  EQUAL: bit5 clear (0x203b) + bit5 set (0x2050) identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: exactly the nine dest cells change, each == its ROM source byte", () => {
  for (const [selector, table] of [[0x00, TABLE_A], [0x20, TABLE_B]]) {
    const before = craft(selector);
    const after = craft(selector);
    const cells = destCells();
    // Pre-dirty the nine dest cells so EVERY stamp is observable. A fresh machine already holds
    // some of the source bytes (table A is mostly 0x00) at these cells, so those writes leave RAM
    // unchanged and would vanish from the diffed footprint. Seat a per-cell sentinel guaranteed to
    // differ from the ROM source byte the oracle stamps there.
    cells.forEach((cell, i) => {
      const sentinel = (before.mem.read8((table + i) & 0xffff) ^ 0xff) & 0xff;
      before.mem.write8(cell, sentinel);
      after.mem.write8(cell, sentinel);
    });
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    const changed = [];
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
    assert.deepEqual(changed.sort((x, y) => x - y), [...cells].sort((x, y) => x - y), `footprint (B=${hx(selector)})`);
    cells.forEach((cell, i) => {
      assert.equal(after.mem.read8(cell), after.mem.read8((table + i) & 0xffff), `cell ${hx(cell)} must equal source[${i}]`);
    });
  }
  console.log("  WRITE-SET: 9 dest cells := ROM source (both tables)");
});

// -- 3 & 4. TEETH (both branches already crafted above) -----------------------

test("TEETH: a wrong dest tile is CAUGHT by the RAM diff", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  stampSelectedGlyphBlock(c);
  const victim = destCells()[4]; // the center cell
  c.mem.write8(victim, (c.mem.read8(victim) ^ 0xff) & 0xff); // BUG: flip the center tile
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong dest tile");
  assert.equal(d.addr, victim, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong center tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
