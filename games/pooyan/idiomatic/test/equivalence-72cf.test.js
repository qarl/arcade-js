// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchActiveEagleRecordState (ROM 0x72cf) — the per-eagle-record state dispatcher.
 *
 * dispatchActiveEagleRecordState skips an inactive record (bit0 of (ix+0)|(ix+1) clear), then selects one of three
 * handlers by the record state byte (ix+2), replacing the frozen layer's rst-0x28 word table at
 * 0x72db (0->733c, 1->7395, 2->73ce; the table was MAME-validated — all three indices observed
 * under gameplay). It is a pure tail dispatch (no continuation stacked); its caller (driveEagleWavePerFrame)
 * reads no register or return value back, so the contract is:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP/cycles are NOT compared; both sides return undefined. Both run on identical clones, so any
 * deterministic handler effect matches — the test verifies the SELECTION and the inactive guard.
 * Each state's craft reuses that handler's own equivalence-tested configuration, with (ix+2) set to
 * the DISPATCH index: state 0 hits the approach handler (bumps ix+2, arms anim); state 1 descends
 * one step; state 2 retires the record (clears it, decrements the wave count).
 *
 * Jobs:
 *   1. EQUAL — over states 0..2, oracle == dispatchActiveEagleRecordState in RAM (−stack), both returning undefined.
 *   2. INACTIVE — bit0 of (ix+0)|(ix+1) clear: both no-op the record, RAM unchanged.
 *   3. TEETH — a wrong written byte MUST be caught by the RAM diff; a MIS-DISPATCH (the wrong
 *      handler on the same craft) MUST diverge from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-72cf.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_72cf as oracle } from "../../translated/loc_72cf.js";
import { dispatchActiveEagleRecordState } from "../dispatchActiveEagleRecordState.js";
import { advanceEagleDiveClimbToRetireAtLimit } from "../advanceEagleDiveClimbToRetireAtLimit.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const EAGLE_X = 0x8c96;
const EAGLE_Y = 0x8c94;
const WAVE_RECORDS_ARRIVED = 0x8f39;
const WAVE_INDEX = 0x8f3d;
const WAVE_RECORD_COUNT = 0x8f38;
const WAVE_HOLD_TIMER = 0x8f51;
const REC_EVEN = 0x8b00; // IXL bit3 clear -> even approach record (state 0)
const REC = ENEMY_ACTOR_TABLE; // 0x8ae0: descend/retire record (states 1, 2)
const RECORD_LEN = 0x18;
const DIRTY = 0xaa;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/**
 * Fresh clone crafted for `state`, routing to that state's handler on a deterministic path. IX and
 * the state byte are always seated; the rest reuses each handler's own equivalence-tested config.
 */
function craft(state, { active = true } = {}) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // dispatch push + handler call/ret land inside STACK_SCRATCH
  const ix = state === 0 ? REC_EVEN : REC;
  m.regs.ix = ix;
  m.mem.write8(ix + 0x00, active ? 0x01 : 0x00); // bit0 -> record active/inactive
  m.mem.write8(ix + 0x01, 0x00);
  m.mem.write8(ix + 0x02, state & 0xff); // the dispatch selector
  if (state === 0) {
    // 733c approach: eagle grid col/row inside the (ix+6)/(ix+4) window -> a hit that advances state.
    m.mem.write8(EAGLE_X, 0x40); // column 8
    m.mem.write8(EAGLE_Y, 0x40); // row 0x0c
    m.mem.write8(ix + 0x06, 0x08); // target column matches
    m.mem.write8(ix + 0x04, 0x0c); // target row matches
    m.mem.write8(ix + 0x09, 0x00);
    m.mem.write8(ix + 0x0c, 0x00);
    m.mem.write8(ix + 0x0d, 0x00);
    m.mem.write8(ix + 0x0e, 0x77);
    m.mem.write8(WAVE_RECORDS_ARRIVED, 0x02); // not all arrived -> no wave-complete sound
    m.mem.write8(WAVE_INDEX, 0x05);
  } else if (state === 1) {
    // 7395 descend, no carry: integrate the vertical position by speed without hitting the limit.
    m.mem.write8(ix + 0x03, 0x10); // position low
    m.mem.write8(ix + 0x04, 0x08); // position high (row)
    m.mem.write8(ix + 0x09, 0x05); // per-record speed
    m.mem.write8(ix + 0x0e, 0x04); // frame-hold non-zero -> anim stepper just decrements
  } else {
    // 73ce retire: clear the record; count 3 -> 2 leaves the wave non-empty (no hold seed).
    for (let i = 0; i < RECORD_LEN; i++) m.mem.write8(ix + i, DIRTY);
    m.mem.write8(ix + 0x00, active ? 0x01 : 0x00); // restore active bit after the dirty fill
    m.mem.write8(ix + 0x01, 0x00);
    m.mem.write8(ix + 0x02, state & 0xff);
    m.mem.write8(WAVE_RECORD_COUNT, 0x03);
    m.mem.write8(WAVE_HOLD_TIMER, 0x00);
  }
  return m;
}

const STATES = [0, 1, 2];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: states 0..2 — dispatchActiveEagleRecordState == oracle in RAM (−stack), both return undefined", () => {
  for (const state of STATES) {
    const o = craft(state);
    const c = craft(state);
    const ro = oracle(o);
    const rc = dispatchActiveEagleRecordState(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (state ${state})`);
    assert.equal(rc, ro, `return mismatch (state ${state})`);
    assert.equal(rc, undefined, `state ${state}: a tail dispatch returns undefined`);
  }
  console.log(`  EQUAL: ${STATES.length} states identical (RAM −stack), returns undefined`);
});

// -- 2. INACTIVE guard --------------------------------------------------------

test("INACTIVE: bit0 of (ix+0)|(ix+1) clear -> both no-op the record (RAM unchanged)", () => {
  for (const state of STATES) {
    const before = craft(state, { active: false });
    const snap = before.dumpState();
    const o = craft(state, { active: false });
    const c = craft(state, { active: false });
    assert.equal(oracle(o), undefined);
    assert.equal(dispatchActiveEagleRecordState(c), undefined);
    // both left RAM exactly as crafted (an inactive record dispatches nothing)
    assert.equal(ramDiffMinusStack(o, c), null, `inactive: oracle vs idiom differ (state ${state})`);
    const dOracle = firstStateDiff(snap, o.dumpState(), (off) => before.stateOffsetToAddr(off), inDeadStack);
    assert.equal(dOracle, null, `inactive record must not be touched (state ${state})`);
  }
  console.log("  INACTIVE: all states no-op when bit0 clear (RAM −stack unchanged)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong written byte is CAUGHT by the RAM diff", () => {
  const o = craft(1);
  const c = craft(1);
  oracle(o);
  dispatchActiveEagleRecordState(c);
  c.mem.write8(REC + 0x03, (c.mem.read8(REC + 0x03) ^ 0xff) & 0xff); // corrupt the integrated position

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record byte — it is worthless");
  assert.equal(d.addr, REC + 0x03, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a MIS-DISPATCH (state-1 handler on a state-2 record) diverges from the oracle", () => {
  const o = craft(2);
  const wrong = craft(2);
  oracle(o); // real dispatch -> state-2 retire handler (clears the record, decrements the count)
  advanceEagleDiveClimbToRetireAtLimit(wrong); // WRONG: the descend handler integrates position instead of clearing

  const d = ramDiffMinusStack(o, wrong);
  assert.notEqual(d, null, "a mis-dispatch produced identical RAM — the selection is untested");
  console.log(`  TEETH/DISPATCH: wrong handler diverged (RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} wrong=${d.b})`);
});
