// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickHudRefresh (ROM 0x1583, Pooyan) — the per-frame HUD-refresh tick with a
 * tamper-gated gameplay dispatch: bump HUD_REFRESH_TICK, and on a 16-frame boundary enqueue a
 * display-refresh command, then (only while TAMPER_STRIKES_ROM is nonzero) fall through into the
 * state-3 dispatcher runPlayStateFrame.
 *
 * The module dissolves enqueueDisplayCommand and the runPlayStateFrame fall-through to direct calls; the oracle inlines
 * that same tail. tickHudRefresh is a void routine, so equivalence is RAM (dumpState) minus stack scratch below the entry SP.
 *
 * Jobs:
 *   1. EQUAL — three reachable arms (no boundary, boundary/gate-off, boundary/dispatch) are
 *      RAM-identical between oracle and module.
 *   2. WRITE-SET — the strike counter gates the dispatch: gate-on runs the play sub-state handler
 *      (phase-timer ticks), gate-off holds it.
 *   3. TEETH — a wrong phase-timer byte is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the dispatch arm is seam-placeable (the tail-delegate seats no adrift return).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1583.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1583 as oracle } from "../../translated/loc_1583.js";
import { tickHudRefresh } from "../tickHudRefresh.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const HUD_TICK = 0x8f4d; //     per-frame refresh counter
const STRIKES = 0x89ef; //      tamper-strike counter (nonzero -> gameplay dispatch)
const STATE_IDX = 0x880a; //    play sub-state index dispatched via table 0x15a8
const PHASE_TIMER = 0x8808; //  play phase timer (idx-1 handler decrements it)
const GAME_ACTIVE = 0x8806; //  0 -> tickActivePlayerPlayTimer bails
const COINAGE = 0x882c; //      != 0x0f -> not free play (resetToBoardBuildToContinuePlay stays off the epilogue tail)
const CREDIT = 0x8802; //       0 -> resetToBoardBuildToContinuePlay returns cleanly
const SP0 = 0x8ff0; //          inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //   caller-return word the tail-delegate consumes

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone; the dispatch tail held on benign arms (game inactive, idx-1 handler, clean continuation). */
function craft({ tick, strikes }) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.mem8[HUD_TICK] = tick;
  m.mem8[STRIKES] = strikes;
  m.mem8[GAME_ACTIVE] = 0x00; // tickActivePlayerPlayTimer bails
  m.mem8[STATE_IDX] = 0x01; // dispatch index 1 -> the phase-timer handler
  m.mem8[PHASE_TIMER] = 0x05; // running -> handler decrements and returns
  m.mem8[COINAGE] = 0x11; // not free play
  m.mem8[CREDIT] = 0x00; // no credit -> continuation returns cleanly
  return m;
}

const ARMS = [
  ["no boundary", { tick: 0x05, strikes: 0x00 }],
  ["boundary, gate off", { tick: 0x0f, strikes: 0x00 }],
  ["boundary, dispatch", { tick: 0x0f, strikes: 0x01 }],
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: three reachable arms — tickHudRefresh == oracle in RAM (−stack)", () => {
  for (const [label, opts] of ARMS) {
    const o = craft(opts);
    oracle(o);
    const c = craft(opts);
    tickHudRefresh(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: no-boundary + enqueue + dispatch arms identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the strike counter gates the gameplay dispatch", () => {
  const disp = craft({ tick: 0x0f, strikes: 0x01 });
  oracle(disp);
  assert.equal(disp.mem8[PHASE_TIMER], 0x04, "gate on -> the play sub-state handler ticked the phase timer");

  const held = craft({ tick: 0x0f, strikes: 0x00 });
  oracle(held);
  assert.equal(held.mem8[PHASE_TIMER], 0x05, "gate off -> dispatch skipped, phase timer held");

  assert.notEqual(disp.mem8[PHASE_TIMER], held.mem8[PHASE_TIMER], "the strike counter must gate the dispatch");
  console.log("  WRITE-SET: gate-on ticks the phase timer, gate-off holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong phase-timer byte is CAUGHT by the RAM diff", () => {
  const opts = { tick: 0x0f, strikes: 0x01 };
  const o = craft(opts);
  const c = craft(opts);
  oracle(o);
  tickHudRefresh(c);
  c.mem8[PHASE_TIMER] = 0x05; // BUG: the dispatch must have ticked the phase timer to 0x04
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase-timer byte — it is worthless");
  assert.equal(d.addr, PHASE_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong phase-timer byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH (reviewer-rules R36) -----------------------------------------

test("SP-TOOTH: the dispatch tail-delegate is seam-placeable (no adrift return)", () => {
  const r = seamPlaceable(withOmittedRet, tickHudRefresh, 0x1583, craft({ tick: 0x0f, strikes: 0x01 }));
  assert.equal(r.placeable, true, `the dispatch delegate must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: tickHudRefresh dispatch delegate placeable (SP balanced through runPlayStateFrame)");
});
