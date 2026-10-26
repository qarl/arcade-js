// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceWaveTeardownByState (ROM 0x32bd) — the shared teardown epilogue, keyed on the
 * teardown-state byte (0x8f24). State 0 and states >= 3 return; state 1 dismantles the wave (clear
 * the event latch, reseed the periodic-event timer, run queueSoundRun26, advance the state, then a ROM
 * running-sum self-check whose masked non-zero result diverts into findTableSlotAndPaintStageHeader); state 2 walks the lead
 * actor's position down two per frame, running loc_23d7 while it stays below the limit and, once it
 * reaches the limit, running queueSoundCommands95And03And11 then — if the gate byte is clear — raising the completion latch
 * and advancing the state.
 *
 * SEATING: BALANCED — the plain rets WIRE; the self-check diversion is a tail-jump forwarding the
 * delegatee's result. Compared per case on RAM (dumpState, minus stack scratch below the entry SP); advanceWaveTeardownByState has no
 * register live-out of its own. pc/SP/full register file are not compared. queueSoundRun26/queueSoundCommands95And03And11/loc_23d7
 * are self-contained and composed; the tamper diversion (findTableSlotAndPaintStageHeader) pulls the HUD render subtree, so
 * its gate liveness is shown by the data invariant (intact mask == 0, tampered != 0) rather than run.
 *
 * Jobs:
 *   1. IDLE       — state 0 and state 3 leave RAM untouched; oracle == idiomatic.
 *   2. DESCEND    — state 2 below the limit: position advances two and loc_23d7 refreshes the
 *                   derived sprite Ys; oracle == idiomatic; the derived Y is a positive control.
 *   3. COMPLETE   — state 2 at the limit, gate clear: queueSoundCommands95And03And11 runs, the completion latch is raised
 *                   and the state advanced; gate set: latch/state untouched; oracle == idiomatic.
 *   4. TEARDOWN   — state 1, intact ROM: latch cleared, timer reseeded, state advanced, check passes
 *                   (falls to ret); oracle == idiomatic; the writes are positive controls.
 *   5. BRANCH-LIVE— the self-check truly gates: intact sum & 0x47 == 0, a tampered copy != 0.
 *   6. TEETH      — a wrong reseeded periodic-timer byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-32bd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_32bd as oracle } from "../../translated/loc_32bd.js";
import { advanceWaveTeardownByState } from "../advanceWaveTeardownByState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  WAVE_TEARDOWN_STATE,
  WAVE_EVENT_LATCH,
  PERIODIC_EVENT_TIMER,
  PLAYER_Y,
  GRAB_ACTIVE_FLAG,
  DISPLAY_CMD_RING_WRITE_PTR,
  loc_8083,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff8);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const CKSUM_ADDR = 0x0779; // ATTRACT_FIELD_ATTRIB_SRC: first byte of the summed block
const CKSUM_LEN = 0x20;
function romMask(rom) {
  let s = 0;
  for (let i = 0; i < CKSUM_LEN; i++) s = (s + rom[CKSUM_ADDR + i]) & 0xff;
  return s & 0x47;
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
let TAMPERED_ROM = null;
if (ROM_PRESENT) {
  TAMPERED_ROM = ROM.slice();
  TAMPERED_ROM[CKSUM_ADDR] = (TAMPERED_ROM[CKSUM_ADDR] + 1) & 0xff; // shift the masked sum off zero
}

const SPRITE_Y_A = 0x8a80 + 0x4c; // loc_23d7 writes the base Y here (positive control)

/** A fresh clone with the teardown-state and state-2 inputs seated. */
function craft({ state, playerY = 0x00, gate = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.sp = 0x8ff8; // inside STACK_SCRATCH
  m.mem.write8(WAVE_TEARDOWN_STATE, state);
  m.mem.write8(PLAYER_Y, playerY);
  m.mem.write8(loc_8083, gate);
  m.mem.write8(WAVE_EVENT_LATCH, 0xff); // pre-dirty so the state-1 clear is observable
  m.mem.write8(PERIODIC_EVENT_TIMER, 0x00);
  m.mem.write8(GRAB_ACTIVE_FLAG, 0x00);
  // free ring window so queueSoundRun26/queueSoundCommands95And03And11 append deterministically
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, 0xc0);
  for (let i = 0; i < 0x20; i++) m.mem.write8(0x8800 + 0xc0 + i, 0x80); // bit7 set => free
  return m;
}

// -- 1. IDLE ------------------------------------------------------------------

test("IDLE: state 0 and state 3 leave RAM untouched; oracle == idiomatic", () => {
  for (const state of [0x00, 0x03]) {
    const o = craft({ state });
    const k = craft({ state });
    const b0 = o.dumpState();
    oracle(o);
    advanceWaveTeardownByState(k);
    assert.deepEqual([...o.dumpState()], [...b0], `state ${hx(state)}: oracle must leave RAM untouched`);
    const d = ramDiffMinusStack(o, k);
    assert.equal(d, null, d && `state ${hx(state)}: RAM diff at ${hx(d.addr ?? 0)}`);
  }
  console.log("  IDLE: state 0 / state 3 inert, identical to oracle");
});

// -- 2. DESCEND ---------------------------------------------------------------

test("DESCEND: state 2 below the limit advances the position and derives sprite Ys", () => {
  const o = craft({ state: 0x02, playerY: 0x50 });
  const k = craft({ state: 0x02, playerY: 0x50 });
  oracle(o);
  advanceWaveTeardownByState(k);
  const d = ramDiffMinusStack(o, k);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(k.mem.read8(PLAYER_Y), 0x52, "position advanced by two");
  assert.equal(k.mem.read8(SPRITE_Y_A), 0x52, "loc_23d7 derived the base sprite Y from the new position");
  console.log("  DESCEND: composed idiomatic loc_23d7, identical to oracle");
});

// -- 3. COMPLETE --------------------------------------------------------------

test("COMPLETE: state 2 at the limit raises the latch (gate clear) or holds (gate set)", () => {
  const clear = craft({ state: 0x02, playerY: 0xda, gate: 0x00 }); // +2 = 0xdc >= limit
  const kclear = craft({ state: 0x02, playerY: 0xda, gate: 0x00 });
  oracle(clear);
  advanceWaveTeardownByState(kclear);
  let d = ramDiffMinusStack(clear, kclear);
  assert.equal(d, null, d && `gate-clear RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(kclear.mem.read8(GRAB_ACTIVE_FLAG), 0x01, "gate clear -> completion latch raised");
  assert.equal(kclear.mem.read8(WAVE_TEARDOWN_STATE), 0x03, "gate clear -> state advanced 2 -> 3");

  const set = craft({ state: 0x02, playerY: 0xda, gate: 0x01 });
  const kset = craft({ state: 0x02, playerY: 0xda, gate: 0x01 });
  oracle(set);
  advanceWaveTeardownByState(kset);
  d = ramDiffMinusStack(set, kset);
  assert.equal(d, null, d && `gate-set RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(kset.mem.read8(GRAB_ACTIVE_FLAG), 0x00, "gate set -> latch untouched");
  assert.equal(kset.mem.read8(WAVE_TEARDOWN_STATE), 0x02, "gate set -> state held");
  console.log("  COMPLETE: composed idiomatic queueSoundCommands95And03And11; latch/state match oracle both ways");
});

// -- 4. TEARDOWN --------------------------------------------------------------

test("TEARDOWN: state 1 intact ROM clears/reseeds/advances then passes the check; oracle == idiomatic", () => {
  const o = craft({ state: 0x01 });
  const k = craft({ state: 0x01 });
  oracle(o);
  advanceWaveTeardownByState(k);
  const d = ramDiffMinusStack(o, k);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(k.mem.read8(WAVE_EVENT_LATCH), 0x00, "event latch cleared");
  assert.equal(k.mem.read8(PERIODIC_EVENT_TIMER), 0x20, "periodic-event timer reseeded");
  assert.equal(k.mem.read8(WAVE_TEARDOWN_STATE), 0x02, "state advanced 1 -> 2");
  console.log("  TEARDOWN: composed idiomatic queueSoundRun26, check passes to ret, identical to oracle");
});

// -- 5. BRANCH-LIVE -----------------------------------------------------------

test("BRANCH-LIVE: the state-1 self-check truly gates (intact mask == 0, tampered != 0)", () => {
  assert.equal(romMask(ROM), 0x00, "intact ROM: masked sum must be 0 (check passes -> ret)");
  assert.notEqual(romMask(TAMPERED_ROM), 0x00, "tampered ROM: masked sum must be non-zero (diverts)");
  console.log(`  BRANCH-LIVE: intact mask 0x0, tampered mask ${hx(romMask(TAMPERED_ROM))}`);
});

// -- 6. TEETH -----------------------------------------------------------------

test("TEETH: a wrong reseeded periodic-timer byte is CAUGHT by the RAM diff", () => {
  const o = craft({ state: 0x01 });
  const k = craft({ state: 0x01 });
  oracle(o);
  advanceWaveTeardownByState(k);
  k.mem.write8(PERIODIC_EVENT_TIMER, 0x00); // BUG: must reseed to 0x20
  const d = ramDiffMinusStack(o, k);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong periodic-timer byte — it is worthless");
  assert.equal(d.addr, PERIODIC_EVENT_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong periodic-timer byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
