// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceAttractStateIfImageIntact (ROM 0x7881, Pooyan) — the periodic self-integrity check
 * dispatched over an actor slot: tick a frame countdown, then run a program-image sum and a
 * playfield serpentine sum, and on a clean image clear the enemy-actor arena and re-seed the slot.
 *
 * The module dissolves its block-fill, flip/tamper, and slot-reseed callees to direct idiomatic
 * calls; the oracle drives the frozen ones through the registry new Machine(ROM) builds. advanceAttractStateIfImageIntact is
 * a void routine — no register survives — so the register file is not compared; equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * The record base sits outside the cleared arena so its fields survive the fills, and its spawn
 * index is held below 5 so the slot-reseed returns before its own integrity walk. The success arm
 * pokes one playfield cell so the serpentine sum folds to the clean-image sentinel; the program-image
 * sum runs against the real image and must pass.
 *
 * Jobs:
 *   1. EQUAL — countdown-running and clean-image arms: oracle == advanceAttractStateIfImageIntact in RAM (−stack).
 *   2. WRITE-SET — a running countdown only ticks the frame delay; a clean image sets the attract
 *      sub-state and clears the arena.
 *   3. TEETH — a wrong attract-sub-state byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7881.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7881 as oracle } from "../../translated/loc_7881.js";
import { advanceAttractStateIfImageIntact } from "../advanceAttractStateIfImageIntact.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RECORD = 0x8a80; //       actor slot base (outside the cleared 0x8ae0 arena)
const REC_DELAY = RECORD + 0x11; // frame countdown
const REC_SPAWN = RECORD + 0x13; // spawn index; below 5 -> the slot-reseed returns early
const ATTRACT_SS = 0x8e51; //   attract sub-state, set to 2 on a clean image
const FIELD_BASE = 0x8548; //   first playfield checksum cell
const ARENA = 0x8ae0; //        enemy-actor arena the clean path clears
const SP0 = 0x8ff0; //          inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const base = () => {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = RECORD; // the record base the dispatcher hands in
  m.mem8[REC_SPAWN] = 0x00; // spawn index below 5 -> slot-reseed returns early
  return m;
};

function craftRunning() {
  const m = base();
  m.mem8[REC_DELAY] = 0x05; // countdown running -> tick and return
  return m;
}
function craftClean() {
  const m = base();
  m.mem8[REC_DELAY] = 0x01; //   expires this frame -> run the checks
  m.mem8[FIELD_BASE] = 0x5a; //  folds the playfield sum to the clean-image sentinel
  m.mem8[ARENA] = 0x77; //       seed a nonzero arena byte so the clear is observable
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceAttractStateIfImageIntact == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [["countdown running", craftRunning], ["clean image", craftClean]]) {
    const a = craft();
    const b = craft();
    oracle(a);
    advanceAttractStateIfImageIntact(b);
    const d = ramDiffMinusStack(a, b);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: countdown + clean-image arms identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a running countdown only ticks; a clean image sets the sub-state and clears", () => {
  const run = craftRunning();
  oracle(run);
  assert.equal(run.mem8[REC_DELAY], 0x04, "running countdown -> tick the frame delay");
  assert.notEqual(run.mem8[ATTRACT_SS], 0x02, "running countdown -> the checks did not run");

  const clean = craftClean();
  oracle(clean);
  assert.equal(clean.mem8[ATTRACT_SS], 0x02, "clean image -> attract sub-state set to 2");
  assert.equal(clean.mem8[ARENA], 0x00, "clean image -> the enemy-actor arena is cleared");
  console.log("  WRITE-SET: countdown ticks only; clean image sets sub-state and clears arena");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong attract-sub-state byte is CAUGHT by the RAM diff", () => {
  const a = craftClean();
  const b = craftClean();
  oracle(a);
  advanceAttractStateIfImageIntact(b);
  b.mem8[ATTRACT_SS] = 0x00; // BUG: the clean path must have set it to 2
  const d = ramDiffMinusStack(a, b);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong attract-sub-state byte — worthless");
  assert.equal(d.addr, ATTRACT_SS, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong attract-sub-state byte caught at ${hx(d.addr)}`);
});
