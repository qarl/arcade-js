// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runEagleApproachPhaseFrame (ROM 0x71c7, Pooyan) — the bonus phase-0 body: step the
 * eagle/arrow approach state machine, then run the shared per-frame object update.
 *
 * SEATING: BALANCED-WIRE. Two push16/call pairs (each callee pops its return) then a plain `ret`
 * (net SP 0). The state machine is dissolved to a direct idiomatic call; the object update is a
 * larger routine not lifted this batch, so its call is kept marshalled. The state machine reads
 * no register the update needs (the update loads its own), so no bridging is required. LIVE-OUT
 * is memory only; equivalence is RAM (dumpState) minus stack scratch below the entry SP (SP parked there).
 *
 * The craft holds the approach hold-timer nonzero, so the state machine merely ticks that one
 * timer down — an isolated footprint the object update never touches — while the update takes its
 * full helper-chain path.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack).
 *   2. TEETH — dropping the object update leaves the chain's writes missing (RAM diverges);
 *      dropping the state machine leaves the hold-timer un-ticked (that byte diverges).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-71c7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_71c7 as oracle } from "../../translated/loc_71c7.js";
import { runEagleApproachPhaseFrame } from "../runEagleApproachPhaseFrame.js";
import { advanceEagleApproachAndPaintGridMarker } from "../advanceEagleApproachAndPaintGridMarker.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const HOLD = 0x8f36; // WAVE_HOLD_TIMER — the state machine ticks it down while nonzero
const UPDATE_GATE = 0x8f50; // cleared -> dispatchPerFrameActorUpdatePasses takes its helper-chain path
const GRAB_FLAG = 0x8d32; // zero -> not the early tail path
const OBJECT_UPDATE = 0x20d4;
const SP0 = 0x8fe0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(HOLD, 0x05); // nonzero -> state machine only ticks this down
  m.mem.write8(UPDATE_GATE, 0x00);
  m.mem.write8(GRAB_FLAG, 0x00);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: module == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  runEagleApproachPhaseFrame(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: RAM identical");
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: dropping the object update leaves its chain writes missing", () => {
  const o = craft();
  const twin = craft();
  oracle(o);
  advanceEagleApproachAndPaintGridMarker(twin); // only the state machine, no object update
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "omitting the object update was NOT caught — worthless");
  console.log(`  TEETH no-update: caught at ${hx(d.addr)}`);
});

test("TEETH: dropping the state machine leaves the hold-timer un-ticked", () => {
  const o = craft();
  const twin = craft();
  oracle(o);
  twin.call(OBJECT_UPDATE); // only the object update, no state machine
  assert.notEqual(
    o.mem.read8(HOLD),
    twin.mem.read8(HOLD),
    "omitting the state machine did not change the hold-timer — teeth blunt",
  );
  console.log(`  TEETH no-state-machine: hold-timer oracle=${o.mem.read8(HOLD)} twin=${twin.mem.read8(HOLD)}`);
});
