// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blankRowThenFloodColorsAndAdvanceAttract (ROM 0x08e9) — attract sub-state 1. It blanks one tick of the
 * row-by-row tilemap fill (blankFillRowAndStepCounter, count 0x1d) and returns while the fill is still draining (the
 * fill's Z flag is clear). Once the fill drains it re-arms the fill (armTileFillFromPlayfieldBase), then runs two
 * ROM-table integrity guards that straddle the colour-map flood (fillAttributeColumns, source 0x0859):
 * guard 1 sums 0x0859..0x0878 == 0x63, guard 2 sums 0x0831..0x0839 == 0xaa. The oracle spins forever
 * on a guard miss; on an intact ROM neither can miss, so the module models the miss as a throw. On a
 * clean pass it queues two display commands (queueCreditDisplayCommands, then rst-0x38 words 0x0611 and 0x060b) and
 * sets the attract sub-state 0x8e51 := 7.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM (and delegates to several already-gated
 * leaves), so every case uses a FRESH clone per side. Contract: RAM (dumpState minus stack scratch below the entry SP)
 * ONLY — blankRowThenFloodColorsAndAdvanceAttract is an attract dispatch handler and no caller consumes a result register, so there is
 * NO declared register live-out. pc/SP/cycles are NOT compared.
 *
 * The path is selected by the fill's row counter 0x8809: blankFillRowAndStepCounter decrements it and returns Z only
 * when it hits 0. Both paths are CRAFTED on a fresh Machine clone (intact ROM, so both guards pass):
 *   - counter 0x05 -> the fill is still draining -> early return.
 *   - counter 0x01 -> the fill drains -> the full guard/flood/queue/advance path runs.
 *
 * Jobs:
 *   1. EQUAL — both paths: blankRowThenFloodColorsAndAdvanceAttract == oracle in RAM (−stack).
 *   2. WRITE-SET — the full path advances the attract sub-state (0x8e51 := 7); the early path leaves it
 *      untouched.
 *   3. TEETH — a twin that writes the WRONG sub-state on the full path MUST be caught at 0x8e51; a
 *      twin that (wrongly) advances the sub-state on the early path MUST be caught too.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-08e9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08e9 as oracle } from "../../translated/loc_08e9.js";
import { blankRowThenFloodColorsAndAdvanceAttract } from "../blankRowThenFloodColorsAndAdvanceAttract.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FILL_ROW_COUNTER = 0x8809; // blankFillRowAndStepCounter decrements this; Z (proceed) only at 0
const TILE_FILL_PTR = 0x880b;    // 16-bit VRAM cursor blankFillRowAndStepCounter blanks from
const ATTRACT_SUBSTATE = 0x8e51; // the cell the full path advances to 7
const PLAYFIELD_TILE_BASE = 0x8402;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x20);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: fill cursor pointed into VRAM, the row counter seated, SP in scratch. */
function craft(rowCounter) {
  const m = BASE.clone();
  m.mem.write16(TILE_FILL_PTR, PLAYFIELD_TILE_BASE); // point the row-fill at VRAM
  m.mem.write8(FILL_ROW_COUNTER, rowCounter);
  m.mem.write8(ATTRACT_SUBSTATE, 0x01); // start away from 7 so the advance is observable
  m.regs.sp = STACK_SCRATCH.hi - 0x20;  // the delegated callees push/pop here (dead-stack scratch)
  return m;
}

const EARLY = 0x05; // row counter -> still draining -> early return
const FULL = 0x01;  // row counter -> drains to 0 -> full path

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: early return + full path — blankRowThenFloodColorsAndAdvanceAttract == oracle in RAM (−stack)", () => {
  for (const [label, counter] of [["early", EARLY], ["full", FULL]]) {
    const o = craft(counter);
    const c = craft(counter);
    oracle(o);
    blankRowThenFloodColorsAndAdvanceAttract(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: early-return + full-path identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full path advances the attract sub-state to 7; the early path leaves it alone", () => {
  const full = craft(FULL);
  oracle(full);
  assert.equal(full.mem.read8(ATTRACT_SUBSTATE), 0x07, "full path: attract sub-state advanced to 7");

  const early = craft(EARLY);
  oracle(early);
  assert.equal(early.mem.read8(ATTRACT_SUBSTATE), 0x01, "early path: attract sub-state untouched");
  console.log("  WRITE-SET: full path 0x8e51 := 7, early path leaves 0x8e51 = 1");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong full-path sub-state is CAUGHT at 0x8e51", () => {
  const o = craft(FULL);
  const c = craft(FULL);
  oracle(o);
  blankRowThenFloodColorsAndAdvanceAttract(c);
  assert.equal(o.mem.read8(ATTRACT_SUBSTATE), 0x07, "control: oracle advanced the sub-state to 7");
  c.mem.write8(ATTRACT_SUBSTATE, 0x06); // BUG: wrong next sub-state

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sub-state — it is worthless");
  assert.equal(d.addr, ATTRACT_SUBSTATE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/full: wrong sub-state caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a sub-state wrongly advanced on the early path is CAUGHT at 0x8e51", () => {
  const o = craft(EARLY);
  const c = craft(EARLY);
  oracle(o);
  blankRowThenFloodColorsAndAdvanceAttract(c);
  assert.equal(o.mem.read8(ATTRACT_SUBSTATE), 0x01, "control: oracle left the sub-state at 1 on the early path");
  c.mem.write8(ATTRACT_SUBSTATE, 0x07); // BUG: advanced the sub-state without draining the fill

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a premature sub-state advance — it is worthless");
  assert.equal(d.addr, ATTRACT_SUBSTATE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/early: premature advance caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
