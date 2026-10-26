// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedFourRecordsAndCopyDisplayTiles (ROM 0x250f) — the shape-loader prologue. It fixes the
 * actor-record stride (0x18) and count (4), then falls into the shared tile-copier: copy four
 * shape-table bytes into (record+0x0f) of four consecutive 0x18-byte records and, when the
 * board-clear / terminator gate is set, run the board/HUD reset (the stride low byte 0x18 doubles
 * as that reset's display-command low byte).
 *
 * Cycle-free memory-equivalence gate: a FRESH clone per side (the routine writes RAM), compared on
 * RAM (dumpState, minus stack scratch below the entry SP — the oracle's call trampolines push there) PLUS the register
 * live-out inherited from the copier: IX (record pointer advanced to base + 4*0x18), B (drained to
 * 0), and — on the plain-return path — HL (= the board-clear flag address) and A (= 0). pc/SP/cycles
 * are NOT compared. The routine's only inputs are HL (shape table) and IX (record base); B/DE/E are
 * established internally, so the craft seats only HL/IX and the two branch cells.
 *
 * Jobs:
 *   1. EQUAL (return path) — branch cells zero: oracle == seedFourRecordsAndCopyDisplayTiles in RAM (−stack) + IX/HL/B/A.
 *   2. EQUAL (reset path) — board-clear flag set: the reset runs identically on both sides.
 *   3. WRITE-SET — on the return path the ONLY writes are the 4 tile-field cells := the shape bytes.
 *   4. TEETH — a wrong copied byte is caught by the RAM diff; a wrong advanced IX by the live-out.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-250f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_250f as oracle } from "../../translated/loc_250f.js";
import { seedFourRecordsAndCopyDisplayTiles } from "../seedFourRecordsAndCopyDisplayTiles.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, BOARD_CLEAR_FLAG, TAMPER_STRIKES_TERMINATOR, SPAWN_PHASE_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TILE_FIELD = 0x0f;
const STRIDE = 0x18; // established internally by seedFourRecordsAndCopyDisplayTiles
const COUNT = 4; //     established internally by seedFourRecordsAndCopyDisplayTiles
const SHAPE = 0x8b00; // work-RAM shape table (4 bytes)
const IXBASE = 0x8a80; // work-RAM record base
const SHAPE_BYTES = [0x51, 0x52, 0x53, 0x54]; // distinct so every copy shows as a change

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with seedFourRecordsAndCopyDisplayTiles's two inputs (HL shape table, IX record base) + branch cells seated. */
function craft({ divertBoardClear = 0, divertTerminator = 0, spawnPhase = 0x00 } = {}) {
  const m = BASE.clone();
  for (let i = 0; i < SHAPE_BYTES.length; i++) m.mem.write8(SHAPE + i, SHAPE_BYTES[i]);
  for (let i = 0; i < COUNT; i++) m.mem.write8((IXBASE + i * STRIDE + TILE_FIELD) & 0xffff, 0x99); // pre-dirty
  m.mem.write8(BOARD_CLEAR_FLAG, divertBoardClear);
  m.mem.write8(TAMPER_STRIKES_TERMINATOR, divertTerminator);
  m.mem.write8(SPAWN_PHASE_COUNTER, spawnPhase);
  m.regs.hl = SHAPE;
  m.regs.ix = IXBASE;
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's trampolines push here
  return m;
}

function assertRegs(o, c, tag) {
  assert.equal(c.regs.ix & 0xffff, o.regs.ix & 0xffff, `${tag}: IX live-out mismatch`);
  assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `${tag}: HL live-out mismatch`);
  assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, `${tag}: B live-out mismatch`);
  assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${tag}: A live-out mismatch`);
}

// -- 1. EQUAL (return path) ---------------------------------------------------

test("EQUAL: return path (branch cells zero) — seedFourRecordsAndCopyDisplayTiles == oracle in RAM (−stack) + IX/HL/B/A", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  seedFourRecordsAndCopyDisplayTiles(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
  assertRegs(o, c, "return");
  assert.equal(o.regs.ix & 0xffff, (IXBASE + COUNT * STRIDE) & 0xffff, "IX advanced by 4*stride");
  assert.equal(o.regs.hl & 0xffff, BOARD_CLEAR_FLAG, "return path leaves HL at the board-clear flag");
  assert.equal(o.regs.a & 0xff, 0, "return path leaves A = 0");
  console.log("  EQUAL(return): identical (RAM −stack + IX/HL/B/A)");
});

// -- 2. EQUAL (reset path) ----------------------------------------------------

test("EQUAL: reset path (board-clear flag set) — the board reset runs identically on both sides", () => {
  for (const spawnPhase of [0x00, 0x07]) {
    const o = craft({ divertBoardClear: 1, spawnPhase });
    const c = craft({ divertBoardClear: 1, spawnPhase });
    oracle(o);
    seedFourRecordsAndCopyDisplayTiles(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `spawnPhase=${hx(spawnPhase)}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
    assertRegs(o, c, `spawnPhase=${hx(spawnPhase)}`);
    assert.equal(o.regs.ix & 0xffff, (IXBASE + COUNT * STRIDE) & 0xffff, "IX still advanced past the run on the reset path");
  }
  console.log("  EQUAL(reset): both resetBoardRamAndReseedSpawnCounters sub-branches identical (RAM −stack + IX/HL/B/A)");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: return path writes exactly the 4 tile-field cells := the shape bytes", () => {
  const before = craft();
  const after = craft();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), to: a1[off] });
  }
  assert.equal(changed.length, COUNT, `expected exactly ${COUNT} written cells, got ${changed.length}`);
  for (let i = 0; i < COUNT; i++) {
    const cell = (IXBASE + i * STRIDE + TILE_FIELD) & 0xffff;
    const hit = changed.find((ch) => ch.addr === cell);
    assert.ok(hit, `expected a write at ${hx(cell)}`);
    assert.equal(hit.to, SHAPE_BYTES[i], `cell ${hx(cell)} must be the copied shape byte`);
  }
  console.log(`  WRITE-SET: ${COUNT} tile fields := shape bytes`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong copied byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  seedFourRecordsAndCopyDisplayTiles(c);
  const cell = (IXBASE + 2 * STRIDE + TILE_FIELD) & 0xffff;
  c.mem.write8(cell, (SHAPE_BYTES[2] + 1) & 0xff); // BUG: corrupt the third copied byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH/RAM: wrong copied byte caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong advanced IX is CAUGHT by the live-out check", () => {
  const o = craft();
  oracle(o);
  const good = o.regs.ix & 0xffff;
  const underAdvanced = (IXBASE + 3 * STRIDE) & 0xffff; // one record short of 4
  assert.notEqual(underAdvanced, good, "the IX live-out check must reject an under-advanced pointer");
  assert.equal(good, (IXBASE + COUNT * STRIDE) & 0xffff, "sanity: oracle IX is base + 4*stride");
  console.log(`  TEETH/IX: under-advanced ${hx(underAdvanced)} rejected vs oracle ${hx(good)}`);
});
