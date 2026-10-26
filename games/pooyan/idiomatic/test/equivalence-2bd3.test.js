// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintReadySpriteSquareIfAbsent (ROM 0x2bd3) — "paint the ready-sprite tile": unless
 * the video cell 0x87bb already holds the painted marker 0xba, stamp the source block 0x2be1
 * as a 2x2 square there via loc_3325.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case
 * uses a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP/cycles are NOT compared (the oracle drives them through m.step/m.push/m.ret). paintReadySpriteSquareIfAbsent
 * has NO register live-out — its callers (stageFormationReadyMarkersOrSkipTick / paintReadySpriteFromStackAdjustEntry) read no register result — and
 * takes no register inputs (it loads 0x87bb itself), so a case is just the anchor cell's value.
 * The oracle's loc_3325 sub-call resolves through the translated registry new Machine(ROM) builds.
 *
 * Jobs:
 *   1. EQUAL — the skip arm (cell already 0xba) and the paint arm agree in RAM (−stack).
 *   2. WRITE-SET — the paint arm writes only the four cells of the 2x2 square at 0x87bb.
 *   3. TEETH — a twin that writes a WRONG byte into the last square cell MUST be caught, and a
 *      twin that SKIPS the paint (leaves the square unwritten) MUST be caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2bd3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2bd3 as oracle } from "../../translated/loc_2bd3.js";
import { paintReadySpriteSquareIfAbsent } from "../paintReadySpriteSquareIfAbsent.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const ANCHOR = 0x87bb; // the ready-sprite video cell
const PAINTED_MARKER = 0xba;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x9000);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh reset machine with the anchor cell seeded to `tile`. */
function craft(tile) {
  const m = BASE.clone();
  m.mem.write8(ANCHOR, tile);
  m.regs.sp = 0x9000; // the oracle's loc_3325 push/ret stay inside STACK_SCRATCH
  return m;
}

const squareCells = [ANCHOR, (ANCHOR + 0x01) & 0xffff, (ANCHOR + 0x21) & 0xffff, (ANCHOR + 0x20) & 0xffff];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: skip arm and paint arm — paintReadySpriteSquareIfAbsent == oracle in RAM (−stack)", () => {
  for (const tile of [PAINTED_MARKER, 0x00, 0x37]) {
    const o = craft(tile);
    const c = craft(tile);
    oracle(o);
    paintReadySpriteSquareIfAbsent(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[tile=${hx(tile)}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: skip + 2 paint arms identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the paint arm writes only the four cells of the 2x2 square", () => {
  const allowed = new Set(squareCells);
  const before = craft(0x00);
  for (const cell of squareCells) before.mem.write8(cell, 0xaa); // pre-dirty so writes register
  before.mem.write8(ANCHOR, 0x00); // keep the anchor != marker so the paint arm runs
  const after = before.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's loc_3325 push/ret scratch is not game state
    changed.push(addr);
  }
  for (const addr of changed) {
    assert.ok(allowed.has(addr), `oracle wrote outside the square at ${hx(addr)}`);
  }
  assert.ok(changed.length >= 1, "the paint arm must write at least one cell");
  console.log(`  WRITE-SET: ${changed.length} cells, all within the 2x2 square at ${hx(ANCHOR)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong last-cell byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  paintReadySpriteSquareIfAbsent(c);
  const last = squareCells.at(-1);
  c.mem.write8(last, (c.mem.read8(last) + 1) & 0xff); // BUG: corrupt the final square cell
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong square byte — it is worthless");
  assert.equal(d.addr, last, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(last)})`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a SKIPPED paint (square left unwritten) is CAUGHT", () => {
  const o = craft(0x00);
  const c = craft(0x00); // module does NOT run: simulate a twin that wrongly skips the paint
  oracle(o);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped paint — it is worthless");
  assert.ok(squareCells.includes(d.addr), `teeth caught a non-square address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/skip: unwritten square caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
