// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advancePlayStateThenInsertHighScore (ROM 0x1a96, Pooyan) — the phase-exhausted handler.
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and advancePlayStateThenInsertHighScore on the other, compared on RAM (dumpState, minus stack scratch below the entry SP).
 * pc/SP/cycles are NOT compared, and there is no register live-out: it is tail-reached from a phase
 * dispatcher and every consumed result is a work-RAM cell.
 *
 * INPUTS: ACTIVE_PLAYER 0x880d (its parity picks single vs double step of PLAY_STATE_INDEX 0x880a),
 * plus the cells the tail insert-sort reads (the per-player score buffers). advancePlayStateThenInsertHighScore clears the
 * high-score insert rank 0x89fc, ROPE_SEGMENT_COUNT 0x8931 and MARKER_LAYOUT_PTR 0x8932; the tail
 * insert-sort then re-sets 0x89fc, so its final value is the callee's domain (covered by EQUAL, not
 * WRITE-SET). The queued tile run + the sorted tables are likewise the callees' writes.
 *
 * Jobs:
 *   1. EQUAL — player-0 (single step) and player-1 (double step) cases, oracle == advancePlayStateThenInsertHighScore in RAM
 *      (−stack).
 *   2. WRITE-SET — the three cells advancePlayStateThenInsertHighScore owns and the callees do not touch (PLAY_STATE_INDEX
 *      stepped once/twice, the two round cells cleared).
 *   3. TEETH — a wrong cleared cell is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1a96.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a96 as oracle } from "../../translated/loc_1a96.js";
import { advancePlayStateThenInsertHighScore } from "../advancePlayStateThenInsertHighScore.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ACTIVE_PLAYER = 0x880d;
const PLAY_STATE_INDEX = 0x880a;
const INSERT_RANK = 0x89fc;
const ROPE_COUNT = 0x8931;
const MARKER_PTR = 0x8932;
const P1_SCORE = 0x88a2;
const P2_SCORE = 0x88a5;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the active player, the play-state index, the two round cells and scores set. */
function craft(spec) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; the two calls only touch it there
  m.mem8[ACTIVE_PLAYER] = spec.player & 0xff;
  m.mem8[PLAY_STATE_INDEX] = 0x05;
  m.mem8[INSERT_RANK] = 0x11;
  m.mem8[ROPE_COUNT] = 0x22;
  m.mem8[MARKER_PTR] = 0x33;
  // distinct per-player scores so the tail insert-sort inserts a real record either way
  m.mem8[P1_SCORE] = 0x00; m.mem8[P1_SCORE + 1] = 0x50; m.mem8[P1_SCORE + 2] = 0x01;
  m.mem8[P2_SCORE] = 0x00; m.mem8[P2_SCORE + 1] = 0x25; m.mem8[P2_SCORE + 2] = 0x02;
  return m;
}

const CASES = [
  { name: "player 0 (select == 0): single step", player: 0x00, expIndex: 0x06 },
  { name: "player 1 (select != 0): double step", player: 0x01, expIndex: 0x07 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: player-0 and player-1 — advancePlayStateThenInsertHighScore == oracle in RAM (−stack)", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    advancePlayStateThenInsertHighScore(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} player cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: PLAY_STATE_INDEX stepped and the two round cells cleared", () => {
  for (const spec of CASES) {
    const m = craft(spec);
    oracle(m);
    assert.equal(m.mem8[PLAY_STATE_INDEX], spec.expIndex, `[${spec.name}] play-state index`);
    assert.equal(m.mem8[ROPE_COUNT], 0x00, `[${spec.name}] rope count cleared`);
    assert.equal(m.mem8[MARKER_PTR], 0x00, `[${spec.name}] marker pointer cleared`);
  }
  console.log(`  WRITE-SET: index +1/+2, rope + marker cleared (tile run + tables = callee domain)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong cleared cell is CAUGHT by the RAM diff", () => {
  const spec = CASES[0];
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  advancePlayStateThenInsertHighScore(c);
  c.mem8[MARKER_PTR] = 0x99; // BUG: this cell must be cleared to 0

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong cleared cell — it is worthless");
  assert.equal(d.addr, MARKER_PTR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong marker cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
