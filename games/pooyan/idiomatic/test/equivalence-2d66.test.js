// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for driveRopeExtendAndRenderCells (ROM 0x2d66, Pooyan) — the even-frame rope driver. It bails
 * while a grab is in progress or the wave-arrival counter is at its hold value; otherwise it runs
 * the rope-tile driver (dispatchRopeExtendState) then the rope-cell writer (driveActiveRopeCells) in order.
 *
 * SEATING: the two guard bails are plain rets (net SP 0, seam-completed). The live path is NOT
 * free-standing balanced: dispatchRopeExtendState always dispatches through the rst-0x28 trampoline, whose handler
 * ret consumes a caller-seated return slot, so driveRopeExtendAndRenderCells pushes that slot (push16 0x2d74) before the
 * call — netting 0 across the dispatch. The cell writer driveActiveRopeCells seats each of its own dispatches
 * internally, so with the dispatchRopeExtendState seat the routine nets 0 overall and WIREs. It is a void per-frame
 * driver: no register survives that a caller reads back (its own caller tail-calls it and forwards),
 * so the register file is not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP, with SP
 * parked in STACK_SCRATCH so the sub-calls' pushes drop out of the diff.
 *
 * Cases are CRAFTED: a plain boot does not seat the guard cells + the rope sub-state.
 *
 * Jobs:
 *   1. EQUAL — grab-busy (inert), arrival-hold (inert), and a live run (both sub-drivers act):
 *      oracle == module in RAM (−stack).
 *   2. WRITE-SET — a guard-bail leaves RAM untouched; a live run bumps the rope segment count.
 *   3. TEETH — a corrupted output byte is caught by the RAM diff; a twin that omits the sub-drivers
 *      diverges from the oracle at the segment-count footprint.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2d66.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d66 as oracle } from "../../translated/loc_2d66.js";
import { driveRopeExtendAndRenderCells } from "../driveRopeExtendAndRenderCells.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const GRAB = 0x8d32; // GRAB_ACTIVE_FLAG
const ARRIVAL = 0x8903; // WAVE_ARRIVAL_COUNTER
const EXTEND_STATE = 0x8f14; // ROPE_EXTEND_STATE (rst-0x28 dispatch selector)
const EXTEND_INDEX = 0x8f18; // ROPE_EXTEND_INDEX
const SEGMENT = 0x8931; // ROPE_SEGMENT_COUNT (addRopeSegmentAndAdvanceExtendState's first write)
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craftBusy() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(GRAB, 0x01); // grab in progress -> bail
  m.mem.write8(ARRIVAL, 0x05);
  return m;
}

function craftHold() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(GRAB, 0x00);
  m.mem.write8(ARRIVAL, 0x02); // arrival at the hold value -> bail
  return m;
}

/** Guards open; rope in extend-state 0 with room to grow -> addRopeSegmentAndAdvanceExtendState writes the segment count. */
function craftRun() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(GRAB, 0x00);
  m.mem.write8(ARRIVAL, 0x05); // != hold
  m.mem.write8(EXTEND_STATE, 0x00); // dispatch -> extend state 0
  m.mem.write8(EXTEND_INDEX, 0x00); // count 0 -> cell writer is a no-op; index < limit -> extend runs
  m.mem.write8(SEGMENT, 0x00);
  return m;
}

const CASES = [
  { name: "grab busy -> bail", craft: craftBusy },
  { name: "arrival hold -> bail", craft: craftHold },
  { name: "guards open -> sub-drivers run", craft: craftRun },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: driveRopeExtendAndRenderCells == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    driveRopeExtendAndRenderCells(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a guard-bail is inert; a live run bumps the segment count", () => {
  const busy = craftBusy();
  const b0 = busy.dumpState();
  oracle(busy);
  assert.deepEqual([...busy.dumpState()], [...b0], "a grab-busy bail must leave RAM untouched");

  const run = craftRun();
  oracle(run);
  assert.equal(run.mem.read8(SEGMENT), 0x01, "a live run bumps the rope segment count");
  console.log("  WRITE-SET: bail inert; run bumps segment count");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted output byte is CAUGHT by the RAM diff", () => {
  const o = craftRun();
  const c = craftRun();
  oracle(o);
  driveRopeExtendAndRenderCells(c);
  c.mem.write8(SEGMENT, (o.mem.read8(SEGMENT) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted output byte");
  assert.equal(d.addr, SEGMENT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that omits the sub-drivers diverges at the segment-count footprint", () => {
  const o = craftRun();
  const twin = craftRun(); // a broken driver that runs neither sub-pass
  oracle(o);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a driver that skips the sub-passes — worthless");
  assert.equal(d.addr, SEGMENT, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(SEGMENT)})`);
  console.log(`  TEETH(omit): caught at ${hx(d.addr)}`);
});
