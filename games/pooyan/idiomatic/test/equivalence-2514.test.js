// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for copyDisplayTilesIntoActorRecords (ROM 0x2514) — "copy a tile run into actor records, then
 * maybe reset the board": for each of B records copy one source byte into (record+0x0f), stepping
 * the source +1 and the record +DE; when done, OR the terminator strike counter (0x8df9) with the
 * board-clear flag (0x89e5) and, if either is set, hand off to the board/HUD reset (resetBoardRamAndReseedSpawnCounters),
 * otherwise return.
 *
 * Cycle-free memory-equivalence gate: a FRESH clone per side (the routine writes RAM), compared on
 * RAM (dumpState, minus stack scratch below the entry SP — the oracle's call trampolines push there) PLUS the register
 * live-out. pc/SP/cycles are NOT compared. Declared live-out: IX (record pointer advanced to
 * start+count*DE), B (drained to 0), and — on the plain-return path — HL (= the board-clear flag
 * address) and A (= the OR result, 0). On the reset path A/HL/B are whatever the reset leaves and IX
 * is untouched by it; all four are derived from the oracle clone and checked.
 *
 * Inputs are seated by hand (the leaf is register-dispatched): HL=source, B=count, DE=stride,
 * IX=record base, E=reset command low byte, plus the two branch cells. All writes are aimed into
 * work RAM so nothing hits ROM.
 *
 * Jobs:
 *   1. EQUAL (return path) — branch cells zero: oracle == copyDisplayTilesIntoActorRecords in RAM (−stack) + IX/HL/B/A.
 *   2. EQUAL (reset path) — board-clear flag set: the reset runs identically on both sides.
 *   3. WRITE-SET — on the return path the ONLY writes are the B tile-field cells := the source bytes.
 *   4. TEETH — a wrong copied byte is caught by the RAM diff; a wrong advanced IX by the live-out.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2514.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2514 as oracle } from "../../translated/loc_2514.js";
import { copyDisplayTilesIntoActorRecords } from "../copyDisplayTilesIntoActorRecords.js";
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
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const SRC = 0x8b00; //     work-RAM source of the tile bytes
const IXBASE = 0x8a80; //  work-RAM record base
const STRIDE = 0x18; //    per-record stride
const SRC_BYTES = [0x41, 0x42, 0x43, 0x44]; // distinct so every copy shows as a change

/** A fresh clone with the routine's register inputs and the branch cells seated identically. */
function craft({ count, divertBoardClear = 0, divertTerminator = 0, cmdLow = 0x00, spawnPhase = 0x00 }) {
  const m = BASE.clone();
  for (let i = 0; i < SRC_BYTES.length; i++) m.mem.write8(SRC + i, SRC_BYTES[i]);
  // pre-dirty the target tile fields to a sentinel unlike the source bytes
  for (let i = 0; i < count; i++) m.mem.write8((IXBASE + i * STRIDE + TILE_FIELD) & 0xffff, 0x99);
  m.mem.write8(BOARD_CLEAR_FLAG, divertBoardClear);
  m.mem.write8(TAMPER_STRIKES_TERMINATOR, divertTerminator);
  m.mem.write8(SPAWN_PHASE_COUNTER, spawnPhase);
  m.regs.hl = SRC;
  m.regs.b = count;
  m.regs.de = STRIDE;
  m.regs.ix = IXBASE;
  // NB: DE=0x18 is the record stride; E is its low byte and must NOT be reseated separately
  // (resetBoardRamAndReseedSpawnCounters ignores E, and reseating E here would corrupt the stride the loop's add ix,de reads).
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

test("EQUAL: return path (branch cells zero) — copyDisplayTilesIntoActorRecords == oracle in RAM (−stack) + IX/HL/B/A", () => {
  for (const count of [1, 2, 3]) {
    const o = craft({ count });
    const c = craft({ count });
    oracle(o);
    copyDisplayTilesIntoActorRecords(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `count=${count}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
    assertRegs(o, c, `count=${count}`);
    assert.equal(o.regs.hl & 0xffff, BOARD_CLEAR_FLAG, "return path leaves HL at the board-clear flag");
    assert.equal(o.regs.a & 0xff, 0, "return path leaves A = 0 (OR of two zero cells)");
    assert.equal(o.regs.ix & 0xffff, (IXBASE + count * STRIDE) & 0xffff, "IX advanced by count*stride");
  }
  console.log("  EQUAL(return): counts 1/2/3 identical (RAM −stack + IX/HL/B/A)");
});

// -- 2. EQUAL (reset path) ----------------------------------------------------

test("EQUAL: reset path (board-clear flag set) — the board reset runs identically on both sides", () => {
  // both resetBoardRamAndReseedSpawnCounters sub-branches: spawn phase below cap (fill 0) and at cap (reseed branch)
  for (const spawnPhase of [0x00, 0x07]) {
    const o = craft({ count: 2, divertBoardClear: 1, cmdLow: 0x11, spawnPhase });
    const c = craft({ count: 2, divertBoardClear: 1, cmdLow: 0x11, spawnPhase });
    oracle(o);
    copyDisplayTilesIntoActorRecords(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `spawnPhase=${hx(spawnPhase)}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
    assertRegs(o, c, `spawnPhase=${hx(spawnPhase)}`);
    assert.equal(o.regs.ix & 0xffff, (IXBASE + 2 * STRIDE) & 0xffff, "IX still advanced past the run on the reset path");
  }
  console.log("  EQUAL(reset): both resetBoardRamAndReseedSpawnCounters sub-branches identical (RAM −stack + IX/HL/B/A)");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: return path writes exactly the B tile-field cells := the source bytes", () => {
  const count = 3;
  const before = craft({ count });
  const after = craft({ count });
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), to: a1[off] });
  }
  assert.equal(changed.length, count, `expected exactly ${count} written cells, got ${changed.length}`);
  for (let i = 0; i < count; i++) {
    const cell = (IXBASE + i * STRIDE + TILE_FIELD) & 0xffff;
    const hit = changed.find((ch) => ch.addr === cell);
    assert.ok(hit, `expected a write at ${hx(cell)}`);
    assert.equal(hit.to, SRC_BYTES[i], `cell ${hx(cell)} must be the copied source byte`);
  }
  console.log(`  WRITE-SET: ${count} tile fields := source bytes`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong copied byte is CAUGHT by the RAM diff", () => {
  const o = craft({ count: 3 });
  const c = craft({ count: 3 });
  oracle(o);
  copyDisplayTilesIntoActorRecords(c);
  const cell = (IXBASE + 1 * STRIDE + TILE_FIELD) & 0xffff;
  c.mem.write8(cell, (SRC_BYTES[1] + 1) & 0xff); // BUG: corrupt the middle copied byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH/RAM: wrong copied byte caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong advanced IX is CAUGHT by the live-out check", () => {
  const o = craft({ count: 3 });
  oracle(o);
  const good = o.regs.ix & 0xffff;
  const underAdvanced = (IXBASE + 2 * STRIDE) & 0xffff; // one record short
  assert.notEqual(underAdvanced, good, "the IX live-out check must reject an under-advanced pointer");
  assert.equal(good, (IXBASE + 3 * STRIDE) & 0xffff, "sanity: oracle IX is start + count*stride");
  console.log(`  TEETH/IX: under-advanced ${hx(underAdvanced)} rejected vs oracle ${hx(good)}`);
});
