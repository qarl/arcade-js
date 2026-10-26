// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintPlayfieldAttributeMapForVariant (Pooyan) — "paint the playfield attribute map": choose one of
 * two colour-map jobs from the in-progress/active flags and the round counter, flood the attribute
 * columns from a source table, and stamp either a short two-column marker or a taller single strip.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES the colour map
 * (through its flood callee and its own stamps), so each case runs the oracle on one FRESH clone and
 * paintPlayfieldAttributeMapForVariant on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP are NOT compared. No register live-out is declared: the caller reloads a flag byte into A
 * immediately after, so the contract is memory-only. The selection inputs (the three flags and the
 * round counter) are poked identically on both sides, which also picks the branch under test.
 *
 * Jobs:
 *   1. EQUAL (crafted) — over flag/round combinations covering the default job (both source
 *      variants), the alternate strip (two ways in), and the attract fall-back, oracle == paintPlayfieldAttributeMapForVariant
 *      in RAM(−stack).
 *   2. CAPTURED (best-effort) — replay any real dispatch a short boot happens to reach.
 *   3. WRITE-SET — a default-job case leaves the two marker columns' four cells each at the marker
 *      colour, and the flood changed the attribute region.
 *   4. TEETH — a twin that writes a WRONG marker cell MUST be caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1dd3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1dd3 as oracle } from "../../translated/loc_1dd3.js";
import { paintPlayfieldAttributeMapForVariant } from "../paintPlayfieldAttributeMapForVariant.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ROUND_IN_PROGRESS, GAME_ACTIVE_FLAG, ROUND_COUNTER, PLAY_MODE_LATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x1dd3;
const ATTRIB_BASE = 0x8040; // colour/attribute map base
const MARKER_TILE = 0x0f;
const ROW = 0x20;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** The default job's marker cells: two columns (5,6) x four rows down the attribute map. */
function markerCells() {
  const out = [];
  for (const col of [5, 6]) {
    let cell = (ATTRIB_BASE + col) & 0xffff;
    for (let row = 0; row < 4; row++) {
      out.push(cell);
      cell = (cell + ROW) & 0xffff;
    }
  }
  return out;
}

/** A fresh clone with the four selection cells seated. */
function craft({ inProgress, active, round, playMode }) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the flood call pushes/pops dead RAM
  m.mem.write8(ROUND_IN_PROGRESS, inProgress & 0xff);
  m.mem.write8(GAME_ACTIVE_FLAG, active & 0xff);
  m.mem.write8(ROUND_COUNTER, round & 0xff);
  m.mem.write8(PLAY_MODE_LATCH, playMode & 0xff);
  return m;
}

// Flag/round combinations. B = default two-column job, C = alternate strip.
const CASES = [
  { inProgress: 1, active: 0, round: 1, playMode: 0 }, // B (in progress), odd round -> src variant A
  { inProgress: 0, active: 0, round: 2, playMode: 0 }, // B (inactive), even round -> src variant B
  { inProgress: 0, active: 1, round: 2, playMode: 0 }, // B (fall-through: active, bit0 clear, round != 0)
  { inProgress: 0, active: 1, round: 1, playMode: 0 }, // C (round bit0 set)
  { inProgress: 0, active: 1, round: 0, playMode: 0 }, // C (round == 0)
  { inProgress: 0, active: 1, round: 1, playMode: 1 }, // C-condition but attract -> B fall-back
  { inProgress: 1, active: 0, round: 3, playMode: 0 }, // B (in progress), odd round -> src variant A
];

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted flag/round combos — paintPlayfieldAttributeMapForVariant == oracle in RAM(−stack)", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    paintPlayfieldAttributeMapForVariant(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} for ${JSON.stringify(cs)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted flag/round combos identical (RAM −stack)`);
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

test("CAPTURED: real dispatches replay identically (if reached)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 16) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    new Machine(ROM, { overrides: snap }).runFrames(1500);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    paintPlayfieldAttributeMapForVariant(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `captured RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log(`  CAPTURED: ${caps.length} real dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the default job stamps the marker cells and floods the attribute region", () => {
  const cs = { inProgress: 1, active: 0, round: 1, playMode: 0 }; // default job, odd round -> src A (ROM 0x0839)
  const SRC = 0x0839; // the round-odd source table this case selects
  const after = craft(cs);
  oracle(after);

  // markers win over the flood in columns 5/6, rows 0..3
  for (const cell of markerCells()) {
    assert.equal(after.mem.read8(cell), MARKER_TILE, `marker cell ${hx(cell)} must be the marker colour`);
  }
  // the flood wrote ROM source[col] down each column; column 0/1 row 0 are untouched by the markers
  assert.equal(after.mem.read8(ATTRIB_BASE + 0), ROM[SRC + 0], "flood must write source[0] at column 0");
  assert.equal(after.mem.read8(ATTRIB_BASE + 1), ROM[SRC + 1], "flood must write source[1] at column 1");
  assert.equal(after.mem.read8((ATTRIB_BASE + 0 + 0x20) & 0xffff), ROM[SRC + 0], "flood fills the column down the rows");
  console.log(`  WRITE-SET: ${markerCells().length} marker cells set; flood wrote the ROM source table down each column`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong marker cell is CAUGHT by the RAM diff", () => {
  const cs = { inProgress: 1, active: 0, round: 1, playMode: 0 };
  const victim = markerCells()[5];

  const o = craft(cs);
  const c = craft(cs);
  oracle(o);
  paintPlayfieldAttributeMapForVariant(c);
  c.mem.write8(victim, 0xaa); // BUG: wrong marker colour

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong marker cell — it is worthless");
  assert.equal(d.addr, victim, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(victim)})`);
  console.log(`  TEETH: wrong marker cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
