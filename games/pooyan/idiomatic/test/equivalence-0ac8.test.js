// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for typeAttractTextColumn (ROM 0x0ac8, Pooyan) — the attract sub-state 5 handler:
 * tick the animation timer, step the scripted sprite records, and on the frame/step-counter wraps
 * stamp a script byte up the column and fold a 14-row checksum verified against INTRO_DELAY_CKSUM_WORD.
 *
 * The module dissolves advanceAttractAnimationAndRepaint / advanceFourObjectAnimsAndRebuildList / runObjectAndEnemyActorUpdate to direct calls and keeps the frozen tamper
 * trap 0x7442; the oracle drives the same routines through the register seam. typeAttractTextColumn is a void
 * handler (no register survives), so equivalence is RAM (dumpState) minus stack scratch below the entry SP.
 *
 * Jobs:
 *   1. EQUAL — three reachable arms (frame-timer no-wrap, frame-wrap/step-no-wrap, full checksum
 *      match) are RAM-identical between oracle and module.
 *   2. WRITE-SET — the frame-timer wrap gates the script step: a wrap advances SCRIPT_READ_PTR, a
 *      no-wrap holds it.
 *   3. TEETH — a wrong checksum-pointer byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0ac8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ac8 as oracle } from "../../translated/loc_0ac8.js";
import { typeAttractTextColumn } from "../typeAttractTextColumn.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ANIM = 0x8d41; //        attract-animation frame countdown
const FRAME_TIMER = 0x8e50; //  script frame timer (wrap gates the script step)
const STEP_COUNTER = 0x8e52; //  step counter (wrap gates reseed + checksum)
const READ_PTR = 0x8e54; //     16-bit script read pointer
const WRITE_PTR = 0x8e56; //    16-bit column write pointer
const ATTRACT_SUB = 0x8e51; //  attract sub-state (bumped on the step wrap)
const CKSUM_PTR = 0x8f48; //    16-bit checksum-table pointer
const SP0 = 0x8ff0; //          inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //   caller's return word the seam completes on the moved-0 arm

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}
const rd16 = (m, a) => m.mem8[a] | (m.mem8[a + 1] << 8);

/** Fresh clone; ANIM held off its wrap so advanceAttractAnimationAndRepaint is skipped, pointers seated. */
function craft({ frameTimer, stepCounter, matchChecksum } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[ANIM] = 0x02; // dec -> 1, no wrap: skip the animation advance
  m.mem8[FRAME_TIMER] = frameTimer ?? 0x05;
  m.mem8[STEP_COUNTER] = stepCounter ?? 0x05;
  m.mem8[READ_PTR] = 0x00;
  m.mem8[READ_PTR + 1] = 0x8e; // read ptr -> 0x8e00
  m.mem8[WRITE_PTR] = 0x00;
  m.mem8[WRITE_PTR + 1] = 0x85; // write ptr -> 0x8500 (-> 0x84e0 after the row back-up)
  if (matchChecksum) {
    for (let n = 0, p = 0x84e0; n < 14; n++, p += 0x20) m.mem8[p] = 0x00; // zero the checksum window
    m.mem8[0x8e00] = 0x00; // the placed byte is 0
    m.mem8[CKSUM_PTR] = 0x00;
    m.mem8[CKSUM_PTR + 1] = 0x8f; // checksum ptr -> 0x8f00
    m.mem8[0x8f00] = 0x00;
    m.mem8[0x8f01] = 0x00; // matching zero bytes -> sum 0 == 0
  }
  return m;
}

const ARMS = [
  ["frame-timer no wrap", { frameTimer: 0x05 }],
  ["frame wrap, step no wrap", { frameTimer: 0x01, stepCounter: 0x05 }],
  ["full checksum match", { frameTimer: 0x01, stepCounter: 0x01, matchChecksum: true }],
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: three reachable arms — typeAttractTextColumn == oracle in RAM (−stack)", () => {
  for (const [label, opts] of ARMS) {
    const o = craft(opts);
    oracle(o);
    const c = craft(opts);
    typeAttractTextColumn(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: no-wrap + script-step + checksum-match arms identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the frame-timer wrap gates the script step", () => {
  const wrap = craft({ frameTimer: 0x01, stepCounter: 0x05 });
  oracle(wrap);
  const held = craft({ frameTimer: 0x05, stepCounter: 0x05 });
  oracle(held);
  assert.equal(rd16(wrap, READ_PTR), 0x8e01, "frame wrap -> script read pointer advanced by one");
  assert.equal(rd16(held, READ_PTR), 0x8e00, "no wrap -> script read pointer held");
  assert.notEqual(rd16(wrap, READ_PTR), rd16(held, READ_PTR), "the frame timer must gate the script step");
  console.log("  WRITE-SET: wrap advances the read pointer, no-wrap holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong checksum-pointer byte is CAUGHT by the RAM diff", () => {
  const opts = { frameTimer: 0x01, stepCounter: 0x01, matchChecksum: true };
  const o = craft(opts);
  const c = craft(opts);
  oracle(o);
  typeAttractTextColumn(c);
  assert.equal(rd16(o, CKSUM_PTR), 0x8f02, "checksum match advances the pointer past both bytes");
  c.mem8[CKSUM_PTR] = 0x00; // BUG: the match must have advanced the pointer low byte to 0x02
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong checksum pointer — it is worthless");
  assert.equal(d.addr, CKSUM_PTR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong checksum pointer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH (R36) --------------------------------------------------------

test("SP-TOOTH: typeAttractTextColumn (tail-dispatches to 0x7442 / runObjectAndEnemyActorUpdate) seats SP for the seam", () => {
  const m = craft({ frameTimer: 0x05 }); // frame-timer no-wrap -> early return (moved 0)
  m.mem8[SP0] = CALLER_RET & 0xff;
  m.mem8[SP0 + 1] = CALLER_RET >> 8; // seat the caller's return word the seam completes
  const r = seamPlaceable(withOmittedRet, typeAttractTextColumn, 0x0ac8, m);
  assert.equal(r.placeable, true, `typeAttractTextColumn must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: typeAttractTextColumn seam-placeable (moved 0, seam completes the ret)");
});
