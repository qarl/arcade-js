// SPDX-License-Identifier: GPL-3.0-only
/**
 * stepThirteenScriptedGlyphCells — memory-equivalent to the frozen oracle at ROM 0x4A9D.
 *
 * ★ NOT REACHED BY EITHER SESSION THIS FILE DRIVES. Both call sites sit inside a step of the
 *   sequence machine that neither an undriven attract run nor a driven one enters, which the
 *   control arm below measures rather than asserts from reading. There is therefore NO real
 *   capture OF THIS ENTRY, and the arms below run from a real machine state captured at a routine
 *   the same frame does reach, with the script, the cursor and the two incoming registers planted
 *   on it — a genuine in-play machine with a surgical entry, not a fabrication.
 *
 * GATE: crafted entry, with a negative control, an exhaustive sweep over the direction byte
 *   crossed with several scripts and both walk directions, and teeth.
 *
 * What it exercises, with the holes stated:
 *   1. NEGATIVE CONTROL — a 4000-frame attract session and a 4000-frame driven session both
 *      dispatch this address ZERO times. Asserted.
 *   2. EQUAL from the crafted entry — the whole state dump is identical, the stack included: the
 *      routine pushes nothing, so the exclusion window is measured at ZERO bytes and asserted so.
 *   3. NOT VACUOUS — a candidate that does nothing fails the same comparison, on a real cell.
 *   4. EXCLUDED, deliberately — the declared set is an upper bound on what may differ, measured;
 *      a rewrite that leaves one MORE register alone than the original passes.
 *   5. EXHAUSTIVE over the direction byte — all 256 values, not just the four the two bits span,
 *      so a candidate that read a third bit would be caught.
 *   6. SCRIPTS — five scripts crossed with the four direction combinations, including an all-zero
 *      script (nothing is stepped) and an all-non-zero one (everything is), so neither the "some
 *      cells are skipped" nor the "some cells are stepped" half can pass vacuously.
 *   7. WHAT MOVED — for one crafted entry the exact set of stepped cells and the final cursor are
 *      read back and checked against the script, so the RAM arm is not vacuous.
 *   8. TEETH — seven twins with exact catch counts over the crafted sweep.
 *
 * HOLE: the scripts and the plane cells are chosen here, not observed, so nothing says what a
 * real script contains or which cells a real caller aims at. The gate fixes the walk: thirteen
 * cells, one shared cursor, two independent directions.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4a9d.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { buildRoutines } from "../../routines.js";
import { stepThirteenScriptedGlyphCells } from "../stepThirteenScriptedGlyphCells.js";
import { loc_4a9d as oracle } from "../../translated/loc_4a9d.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x4a9d;
/** A routine the same frame DOES reach, used only to take a live machine to craft from. */
const CAPTURE_AT = 0x52d2;
const CAPTURE_FRAMES = 400;
const CONTROL_FRAMES = 4000;

const SCRIPT_CURSOR = 0xa9f7;
const CELLS = 13;
const ROW = 0x20;
const BACKWARDS = 0x01;
const TOWARD_ROW_ZERO = 0x02;

/** A script planted mid-page so a backward walk stays inside work RAM. */
const SCRIPT_AT = 0xa700;
/** A plane cell far enough from either edge that thirteen rows either way stay in the plane. */
const FIRST_CELL = 0xa5d1;

const SCRATCH_BYTES = 0;
const EXCLUDED = ["a", "f", "b", "d", "e", "h", "l", "sp"];

const DIRECTIONS = Array.from({ length: 256 }, (_unused, i) => i);
const SCRIPTS = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 0, 3, 7, 0, 0, 9],
  [9, 0, 0, 7, 3, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 1],
];
const WALKS = [0, BACKWARDS, TOWARD_ROW_ZERO, BACKWARDS | TOWARD_ROW_ZERO];
const SWEEP_SIZE = DIRECTIONS.length + SCRIPTS.length * WALKS.length;

const IN0 = 0xc300;
const IN1 = 0xc320;

const skip = romsPresent() ? false : "ROM images are absent from this checkout";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

function playTape(frames) {
  const tape = [
    { frame: 401, port: IN0, bits: 0x01, dur: 8 },
    { frame: 501, port: IN0, bits: 0x08, dur: 8 },
    { frame: 600, port: IN1, bits: 0x10, dur: frames },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09];
  let frame = 640;
  while (frame < frames) {
    for (const bits of compass) {
      tape.push({ frame, port: IN1, bits, dur: 40 });
      frame += 40;
    }
  }
  return tape;
}

function dispatchesIn(opts) {
  let dispatches = 0;
  const host = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    return oracle(mm);
  }]]), opts);
  const frames = host.runFrames(CONTROL_FRAMES);
  assert.equal(host.stoppedBy, null, `session stopped early: ${host.stoppedBy}`);
  assert.equal(frames.length, CONTROL_FRAMES, "session ran short");
  return dispatches;
}

let captured = null;

function captureState() {
  if (captured !== null) return captured;
  const capturedRoutine = buildRoutines().get(CAPTURE_AT);
  const host = makeMachine(new Map([[CAPTURE_AT, (mm, ...args) => {
    if (captured === null) captured = mm.clone();
    return capturedRoutine(mm, ...args);
  }]]));
  host.runFrames(CAPTURE_FRAMES);
  assert.notEqual(captured, null, "vacuous: the capture routine was never dispatched either");
  return captured;
}

/**
 * A real captured machine with a script planted either side of the cursor — a backward walk reads
 * DOWN from it — the plane cells set to a known value, and the two incoming registers forced.
 */
function craft(directions, script) {
  const m = captureState().clone();
  for (let i = -CELLS - 1; i <= CELLS + 1; i++) {
    m.mem8[SCRIPT_AT + i] = script[((i % script.length) + script.length) % script.length];
  }
  m.mem16[SCRIPT_CURSOR] = SCRIPT_AT;
  for (let i = -CELLS - 1; i <= CELLS + 1; i++) m.mem8[FIRST_CELL + i * ROW] = 0x40;
  m.regs.de = FIRST_CELL;
  m.regs.c = directions;
  return m;
}

const A_SCRIPT = SCRIPTS[2];

function sweepCaught(candidate) {
  let caught = 0;
  for (const directions of DIRECTIONS) {
    if (unitDiff(candidate, craft(directions, A_SCRIPT))) caught++;
  }
  for (const script of SCRIPTS) {
    for (const walk of WALKS) if (unitDiff(candidate, craft(walk, script))) caught++;
  }
  return caught;
}

// ── twins ───────────────────────────────────────────────────────────────────────────────

function walk(m, cells, rowStep, o) {
  const opt = { readsScript: true, advancesCursor: true, shapeStep: null, ...o };
  const { mem8, mem16 } = m;
  const directions = m.regs.c;
  const step = opt.shapeStep === null ? ((directions & BACKWARDS) !== 0 ? -1 : 1) : opt.shapeStep;
  const row = (directions & TOWARD_ROW_ZERO) !== 0 ? -rowStep : rowStep;
  let cell = m.regs.de;
  for (let i = 0; i < cells; i++) {
    const cursor = mem16[SCRIPT_CURSOR];
    if (!opt.readsScript || mem8[cursor] !== 0) mem8[cell] = (mem8[cell] + step) & 0xff;
    cell = (cell + row) & 0xffff;
    if (opt.advancesCursor) mem16[SCRIPT_CURSOR] = (cursor + step) & 0xffff;
  }
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: twelve cells instead of thirteen. */
function brokenShortWalk(m) {
  walk(m, CELLS - 1, ROW, {});
}

/** BUG: fourteen cells, so one cell past the run is stepped. */
function brokenLongWalk(m) {
  walk(m, CELLS + 1, ROW, {});
}

/** BUG: steps every cell, whatever the script says. */
function brokenIgnoresScript(m) {
  walk(m, CELLS, ROW, { readsScript: false });
}

/** BUG: leaves the shared cursor where it found it. */
function brokenLeavesCursor(m) {
  walk(m, CELLS, ROW, { advancesCursor: false });
}

/** BUG: always steps the shape up, so a backward walk moves the wrong way. */
function brokenAlwaysUp(m) {
  walk(m, CELLS, ROW, { shapeStep: 1 });
}

/** BUG: takes the plane cells a cell apart instead of a row apart. */
function brokenWrongStride(m) {
  walk(m, CELLS, 1, {});
}

/** Each twin's exact catch count over the crafted sweep. Measured; a move is a finding. */
const TWINS = [
  ["no-op", brokenNoOp, 276],
  ["short-walk", brokenShortWalk, 276],
  ["long-walk", brokenLongWalk, 276],
  ["ignores-the-script", brokenIgnoresScript, 272],
  ["leaves-the-cursor", brokenLeavesCursor, 276],
  ["always-steps-up", brokenAlwaysUp, 138],
  ["wrong-stride", brokenWrongStride, 272],
];

// ── the control ─────────────────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: neither attract nor a driven session dispatches this address", { skip }, () => {
  assert.equal(dispatchesIn({ tape: [] }), 0, "attract reached it, so the crafted arm is not needed");
  assert.equal(dispatchesIn({ tape: playTape(CONTROL_FRAMES) }), 0, "a driven session reached it");
  console.log(`  CONTROL: zero dispatches in ${CONTROL_FRAMES} frames of each of two sessions`);
});

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL from the crafted entry: stepThirteenScriptedGlyphCells == oracle over the whole dump", { skip }, () => {
  for (const walkBits of WALKS) {
    const m = craft(walkBits, A_SCRIPT);
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    stepThirteenScriptedGlyphCells(b);
    assert.deepEqual(allDiffs(a, b), [], `walk ${walkBits}: the dumps must agree byte for byte`);
  }
  console.log(`  EQUAL: ${WALKS.length} walk directions, no byte differs on any`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(0, A_SCRIPT));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: nothing diverges outside the declared register set", { skip }, () => {
  const m = craft(0, A_SCRIPT);
  const a = m.clone();
  const b = m.clone();
  oracle(a);
  stepThirteenScriptedGlyphCells(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")}`);
});

test("EXHAUSTIVE: all 256 direction bytes and five scripts behave as the oracle", { skip }, () => {
  assert.equal(sweepCaught(stepThirteenScriptedGlyphCells), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} crafted entries identical`);
});

test("SCRIPTS: an all-zero script steps nothing and an all-one script steps everything", { skip }, () => {
  const none = craft(0, SCRIPTS[0]);
  const before = none.clone();
  stepThirteenScriptedGlyphCells(none);
  const untouched = allDiffs(before, none).map((d) => d.addr);
  assert.deepEqual(untouched, [SCRIPT_CURSOR], "an all-zero script must move only the cursor");

  const all = craft(0, SCRIPTS[1]);
  const wasAll = all.clone();
  stepThirteenScriptedGlyphCells(all);
  const moved = allDiffs(wasAll, all).map((d) => d.addr).filter((a) => a !== SCRIPT_CURSOR);
  assert.equal(moved.length, CELLS, "an all-one script must step every cell of the run");
  console.log(`  SCRIPTS: zero script moves only the cursor; one script steps ${moved.length}`);
});

test("WHAT MOVED: the stepped cells and the final cursor match the script", { skip }, () => {
  for (const walkBits of WALKS) {
    const m = craft(walkBits, A_SCRIPT);
    const before = m.clone();
    const shapeStep = (walkBits & BACKWARDS) !== 0 ? -1 : 1;
    const rowStep = (walkBits & TOWARD_ROW_ZERO) !== 0 ? -ROW : ROW;
    stepThirteenScriptedGlyphCells(m);
    for (let i = 0; i < CELLS; i++) {
      const cell = (FIRST_CELL + i * rowStep) & 0xffff;
      const scriptByte = m.mem8[(SCRIPT_AT + i * shapeStep) & 0xffff];
      const expected = (before.mem8[cell] + (scriptByte !== 0 ? shapeStep : 0)) & 0xff;
      assert.equal(m.mem8[cell], expected, `walk ${walkBits} cell ${i}`);
    }
    assert.equal(
      m.mem16[SCRIPT_CURSOR],
      (SCRIPT_AT + CELLS * shapeStep) & 0xffff,
      `walk ${walkBits}: the cursor must be left where the walk ended`,
    );
  }
  console.log(`  MOVED: ${CELLS} cells and the cursor check out on all ${WALKS.length} walks`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's catch count moved`);
    assert.ok(craftedCaught > 0, `the ${label} twin is caught nowhere at all`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });
}
