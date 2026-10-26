// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for computeRopeCellVramColumn (ROM 0x2e52) — "video-RAM column base for a rope cell":
 * A := ropeColumnTable[IXL&3] via the rst-0x20 table fetch, then HL := 0x8400 | A. A plain-ret
 * helper that writes no memory.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP — always null here, the routine writes nothing) PLUS the register live-out. HL is
 * the load-bearing live-out (a video-RAM pointer the rope-cell handlers draw through); A is left
 * equal to HL's low byte (the fetched table byte). Both are checked against the oracle clone, and
 * the module's own clone must SET them.
 *
 * The routine only reads a ROM table, so every case is CRAFTED: an identical IXL seated on both
 * sides (only IXL&3 matters; the high byte and the top IXL bits are decoys proving the mask).
 *
 * Jobs:
 *   1. EQUAL (crafted) — each IXL&3 plus masked decoys: oracle == computeRopeCellVramColumn in RAM, HL, and A; the
 *      module SETS both, and HL lands on the tilemap page.
 *   2. WRITE-SET — the routine writes zero cells.
 *   3. TEETH — a twin that returns HL on the WRONG page and a twin that returns the WRONG low byte
 *      are each rejected by the live-out checks.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2e52.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2e52 as oracle } from "../../translated/loc_2e52.js";
import { computeRopeCellVramColumn } from "../computeRopeCellVramColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const VIDEO_PAGE = 0x8400; // tilemap page the column base lives in
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with IX (low byte = ixl) seated; the high byte is a decoy. */
function craft(ixl) {
  const m = BASE.clone();
  m.regs.ix = (0x99 << 8) | (ixl & 0xff);
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [0x00, 0x01, 0x02, 0x03, 0x07, 0xfe]; // 0x07&3=3, 0xfe&3=2 prove the mask

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted IXL cases — computeRopeCellVramColumn == oracle in RAM (−stack) + HL + A", () => {
  for (const ixl of CASES) {
    const o = craft(ixl);
    oracle(o);

    const c = craft(ixl);
    c.regs.hl = 0xffff; // sentinel: a non-writing module fails
    c.regs.a = 0x55;
    const ret = computeRopeCellVramColumn(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `ixl=${hx(ixl)}: unexpected RAM write at ${hx(d.addr ?? 0)}`);
    assert.equal(ret & 0xffff, o.regs.hl & 0xffff, `HL return mismatch (ixl=${hx(ixl)})`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `module must SET HL (ixl=${hx(ixl)})`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `A (fetched byte) mismatch (ixl=${hx(ixl)})`);
    assert.equal((o.regs.hl & 0xff00), VIDEO_PAGE, `HL must land on the tilemap page (ixl=${hx(ixl)})`);
    assert.equal(o.regs.a & 0xff, o.regs.hl & 0xff, "A equals HL's low byte");
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + HL + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the routine writes zero cells", () => {
  const m = craft(0x02);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  let changed = 0;
  // The rst-0x20 table fetch pushes/pops the return address in STACK_SCRATCH; those are not
  // game-state writes (the EQUAL job likewise compares RAM minus stack scratch below the entry SP).
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off] && !inDeadStack(m.stateOffsetToAddr(off))) changed++;
  }
  assert.equal(changed, 0, `expected 0 writes, got ${changed}`);
  console.log("  WRITE-SET: 0 cells");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong HL page is CAUGHT by the live-out check", () => {
  const o = craft(0x01);
  oracle(o);
  const wrongPage = (o.regs.hl & 0x00ff) | 0x8500; // BUG: right column, wrong page
  assert.notEqual(wrongPage & 0xffff, o.regs.hl & 0xffff, "the HL live-out check must reject a wrong page");
  console.log(`  TEETH(HL): wrong page ${hx(wrongPage)} rejected against oracle ${hx(o.regs.hl)}`);
});

test("TEETH: a wrong fetched low byte is CAUGHT by the live-out checks", () => {
  const o = craft(0x03);
  oracle(o);
  const wrongLow = (o.regs.a ^ 0x01) & 0xff; // BUG: corrupt bit 0 of the fetched byte
  assert.notEqual(wrongLow, o.regs.a & 0xff, "the A live-out check must reject a wrong fetched byte");
  assert.notEqual((VIDEO_PAGE | wrongLow) & 0xffff, o.regs.hl & 0xffff, "the HL check rejects it too");
  console.log(`  TEETH(A): wrong low byte ${hx(wrongLow)} rejected against oracle A=${hx(o.regs.a)}`);
});
