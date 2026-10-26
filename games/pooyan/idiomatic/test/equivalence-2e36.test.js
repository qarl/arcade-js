// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchRopeCellState (ROM 0x2e36, Pooyan) — the per-rope-cell dispatcher: return
 * on an inactive cell (state 0), else run the handler for the cell's state-1.
 *
 * The module runs the dispatch through an idiomatic switch, passing the cell record to each handler;
 * the oracle does the same via `sub`/`rst 0x28`. dispatchRopeCellState is a void dispatcher (no register
 * survives), so equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * The dispatch arm seats the cell state at 1 (index 0 -> rope handler 0x2e5e) with the frame-parity
 * gate open and the per-cell timer running, so the handler's sole footprint is one timer decrement —
 * an isolated, observable write. The inactive arm holds state 0 so the dispatch is skipped.
 *
 * Jobs:
 *   1. EQUAL — dispatch (state 1) and inactive (state 0): oracle == dispatchRopeCellState in RAM (−stack).
 *   2. WRITE-SET — the dispatch ticks the per-cell timer; the inactive arm holds it, so they differ.
 *   3. TEETH — a wrong timer byte is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the push16 + rst-28 dispatch is seam-placeable (missing-push16 is invisible to eq).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2e36.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2e36 as oracle } from "../../translated/loc_2e36.js";
import { dispatchRopeCellState } from "../dispatchRopeCellState.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8f1c; //     rope-cell record base (ROPE_CELL_STATE_BASE); IXL & 3 = 0 selects timer 0x8f28
const CELL_TIMER = 0x8f28; // per-cell frame timer the rope handler decrements
const FRAME_PARITY = 0x8a5f; // handler gate: (0x8a5f) & 3 must be 0 to run
const SP0 = 0x8ff0; //     inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // caller-return word seated at SP0 for the SP seam

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: cell record seated, handler gate open, per-cell timer running (dispatch does one dec). */
function craft(state) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.regs.ix = REC;
  m.mem8[REC] = state & 0xff; // (ix+0) cell state
  m.mem8[FRAME_PARITY] = 0x00; // (0x8a5f)&3 == 0 -> handler proceeds to the timer
  m.mem8[CELL_TIMER] = 0x05; // timer running -> handler decrements then rets nz
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dispatch + inactive states — dispatchRopeCellState == oracle in RAM (−stack)", () => {
  for (const [label, state] of [["dispatch (state 1)", 0x01], ["inactive (state 0)", 0x00]]) {
    const o = craft(state);
    oracle(o);
    const c = craft(state);
    dispatchRopeCellState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: dispatch + inactive identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the cell state gates the dispatch (per-cell timer tick)", () => {
  const disp = craft(0x01);
  oracle(disp);
  assert.equal(disp.mem8[CELL_TIMER], 0x04, "state 1 -> handler decremented the per-cell timer");

  const idle = craft(0x00);
  oracle(idle);
  assert.equal(idle.mem8[CELL_TIMER], 0x05, "state 0 -> dispatch skipped, timer held");

  assert.notEqual(disp.mem8[CELL_TIMER], idle.mem8[CELL_TIMER], "the cell state must gate the dispatch");
  console.log("  WRITE-SET: state 1 ticks the cell timer, state 0 holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong per-cell timer byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  dispatchRopeCellState(c);
  c.mem8[CELL_TIMER] = 0x05; // BUG: the dispatch must have ticked the timer to 0x04
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong timer byte — it is worthless");
  assert.equal(d.addr, CELL_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong timer byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: push16 + rst-28 dispatch is seam-placeable (missing-push16 is invisible to eq)", () => {
  const r = seamPlaceable(withOmittedRet, dispatchRopeCellState, 0x2e36, craft(0x01));
  assert.equal(r.placeable, true, `dispatching rewrite must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: dispatchRopeCellState dispatch seats a real caller-return word (placeable)");
});
