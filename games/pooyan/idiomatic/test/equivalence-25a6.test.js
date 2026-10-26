// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for renderMarkerColumnExtendOrRetract (ROM 0x25a6, Pooyan) — the per-frame lift/marker column
 * driver at the layout pointer.
 *
 * SEATING: BALANCED (plain ret) — a void per-frame driver dispatched from the frame coordinator;
 * no caller reads a register back, so the register file is NOT compared. Equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP, with SP parked in the scratch so the oracle's nested call pushes
 * drop out of the diff. The even-frame branch (round bit0 == 0 -> driveRopeExtendAndRenderCells) is a sibling's job and
 * is kept out of every crafted state (round bit0 forced to 1) so this gate isolates 0x25a6's own
 * three modes: retract, extend (begin a sweep + grow), and steady, plus the two entry gates.
 *
 * Cases are CRAFTED: a plain boot does not seat this timer/phase/pointer geometry.
 *
 * Jobs:
 *   1. EQUAL — timer-not-expired (only the timer ticks), no-phase (timer reloads then bails),
 *      steady redraw, begin-sweep+extend, sweep-end clear, complete-latch, and both retract
 *      variants (blank-then-redraw / already-blank): oracle == module in RAM (−stack).
 *   2. WRITE-SET — a not-expired frame touches only the step timer; a steady frame stamps the
 *      column and advances the animation parity.
 *   3. TEETH — a corrupted stamped tile is caught by the RAM diff; a no-op module (never ticks the
 *      timer) and a module that skips the parity advance both diverge from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-25a6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_25a6 as oracle } from "../../translated/loc_25a6.js";
import { renderMarkerColumnExtendOrRetract } from "../renderMarkerColumnExtendOrRetract.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ROUND = 0x8907; // ROUND_COUNTER; bit0 == 1 keeps us out of the driveRopeExtendAndRenderCells branch
const TIMER = 0x8f09; // step timer
const PHASE = 0x8902; // spawn-phase counter (0 => nothing to draw)
const FORM = 0x8920; // formation-slot byte; != 0 => retract mode
const COUNT = 0x8934; // rope-draw count
const EXTEND = 0x8f05; // extend-active flag
const COMPLETE = 0x8f04; // complete latch
const ANIM = 0x8f0a; // animation parity
const ARMED = 0x8f63; // anim-armed latch (cleared at sweep end)
const PTR = 0x8932; // layout pointer (16-bit, LE)
const PTR_DEFAULT = 0x8680; // into video RAM; stamps + retract band stay in writable RAM
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the driver's cells. Round bit0 forced on; everything else per the case. */
function seat(m, o = {}) {
  const {
    timer = 0x01, // expires this frame by default
    phase = 0x03,
    form = 0x00,
    count = 0x03,
    extend = 0x00,
    anim = 0x00,
    ptr = PTR_DEFAULT,
  } = o;
  m.regs.sp = SP0;
  m.mem.write8(ROUND, 0x01); // odd frame: run this driver, not driveRopeExtendAndRenderCells
  m.mem.write8(TIMER, timer);
  m.mem.write8(PHASE, phase);
  m.mem.write8(FORM, form);
  m.mem.write8(COUNT, count);
  m.mem.write8(EXTEND, extend);
  m.mem.write8(ANIM, anim);
  m.mem.write16(PTR, ptr);
  return m;
}

const craftStillCounting = () => seat(BASE.clone(), { timer: 0x03 });
const craftNoPhase = () => seat(BASE.clone(), { timer: 0x01, phase: 0x00 });
const craftSteady = () => seat(BASE.clone(), { phase: 0x03, count: 0x03, extend: 0x00, anim: 0x00 });
const craftBeginSweep = () => seat(BASE.clone(), { phase: 0x05, count: 0x03, extend: 0x00, anim: 0x01 });
function craftSweepEnd() {
  // flag set + pointer low byte 0xa3 -> clears the flag and the armed latch, then redraws steady
  const m = seat(BASE.clone(), { phase: 0x03, count: 0x03, extend: 0x01, ptr: 0x86a3 });
  m.mem.write8(ARMED, 0x01); // pre-set so the clear is observable
  return m;
}
// count >= 7 with pointer low byte 0xc3 -> latches the complete flag
const craftComplete = () => seat(BASE.clone(), { phase: 0x08, count: 0x08, extend: 0x00, ptr: 0x86c3 });
const craftRetract = () => seat(BASE.clone(), { phase: 0x03, form: 0x01, anim: 0x00 });
function craftRetractBlanked() {
  const m = seat(BASE.clone(), { phase: 0x03, form: 0x01, anim: 0x00 });
  m.mem.write8(PTR_DEFAULT - 0x400, 0x80); // band already blanked -> skip the blank loop
  return m;
}

const CASES = [
  { name: "timer not expired", craft: craftStillCounting },
  { name: "no phase", craft: craftNoPhase },
  { name: "steady redraw", craft: craftSteady },
  { name: "begin sweep + extend", craft: craftBeginSweep },
  { name: "sweep end (clear latches)", craft: craftSweepEnd },
  { name: "complete latch", craft: craftComplete },
  { name: "retract (blank then redraw)", craft: craftRetract },
  { name: "retract (already blank)", craft: craftRetractBlanked },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: renderMarkerColumnExtendOrRetract == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    renderMarkerColumnExtendOrRetract(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} modes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a not-expired frame ticks only the timer; a steady frame stamps + advances parity", () => {
  const still = craftStillCounting();
  oracle(still);
  assert.equal(still.mem.read8(TIMER), 0x02, "the step timer must decrement");
  const expected = craftStillCounting();
  expected.mem.write8(TIMER, 0x02); // the ONLY change a not-expired frame makes
  assert.deepEqual([...still.dumpState()], [...expected.dumpState()], "only the step timer changed");

  const steady = craftSteady();
  const anim0 = steady.mem.read8(ANIM);
  oracle(steady);
  assert.equal(steady.mem.read8(ANIM), (anim0 + 1) & 0xff, "steady must advance the animation parity");
  assert.notEqual(steady.mem.read8(PTR_DEFAULT), 0x00, "steady must stamp a tile at the layout pointer");
  console.log("  WRITE-SET: timer-only tick; steady stamps + advances parity");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted stamped tile is CAUGHT by the RAM diff", () => {
  const o = craftSteady();
  const c = craftSteady();
  oracle(o);
  renderMarkerColumnExtendOrRetract(c);
  c.mem.write8(PTR_DEFAULT, (o.mem.read8(PTR_DEFAULT) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted stamped tile — worthless");
  assert.equal(d.addr, PTR_DEFAULT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a no-op module and a skipped-parity module both diverge from the oracle", () => {
  // a dead rewrite that never ticks the timer
  const o1 = craftSteady();
  const noop = craftSteady();
  oracle(o1);
  const d1 = ramDiffMinusStack(o1, noop); // noop untouched
  assert.notEqual(d1, null, "an inert module must diverge (the real driver always ticks the timer)");

  // a rewrite that runs but forgets to advance the animation parity
  const o2 = craftSteady();
  const skip = craftSteady();
  oracle(o2);
  renderMarkerColumnExtendOrRetract(skip);
  skip.mem.write8(ANIM, skip.mem.read8(ANIM) - 1); // undo the parity advance
  const d2 = ramDiffMinusStack(o2, skip);
  assert.notEqual(d2, null, "the gate FAILED to catch a missing parity advance");
  assert.equal(d2.addr, ANIM, `parity teeth caught wrong address ${hx(d2.addr ?? 0)}`);
  console.log("  TEETH(twin): inert module and skipped-parity module both caught");
});
