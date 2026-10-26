// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for testHangingRopeGrabConnect (ROM 0x305f) — "rope-grab trigger test", a dissolved
 * caller-skip. It looks up a catch-window half-width from a table (keyed by IXL&3), tests the
 * player coordinate at 0x8a84 against a +/-7 window, and — inside the window with neither the
 * formation state (0x8f08) nor the wave-teardown state (0x8f24) busy — raises the grab latch
 * (0x8d32 := 1) and enqueues the grab command. It reports the path as a JS boolean: true = the
 * normal (no-grab) path, false = the grab path (the skip its caller early-returns on).
 *
 * Cycle-free memory-equivalence gate: a FRESH clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP — the oracle's call trampolines and its pop-af/ret land there). pc/SP/cycles are
 * NOT compared, and no register is a live-out (the boolean is the whole result). The oracle path
 * is selected by seated input (player coordinate + busy flags) and confirmed by the grab-latch
 * footprint, so the boolean contract is checked against the path the oracle actually ran.
 *
 * The half-width is read from the table at runtime; the player coordinate is crafted relative to
 * it so each path is reached deterministically. IXL&3 == 0 selects window slot 0.
 *
 * Jobs:
 *   1. EQUAL (normal paths) — three no-grab cases (below window, above window, busy): oracle ==
 *      testHangingRopeGrabConnect in RAM (−stack); both return true; the grab latch stays clear.
 *   2. EQUAL (grab path) — inside the window and idle: oracle == testHangingRopeGrabConnect in RAM (−stack); both
 *      return false; the grab latch is raised to 1.
 *   3. FOOTPRINT — the grab path raises 0x8d32 to 1 (the no-grab path leaves it untouched).
 *   4. TEETH — a wrong grab-latch byte is caught by the RAM diff; a twin returning the WRONG
 *      boolean is caught by the boolean-contract check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-305f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_305f as oracle } from "../../translated/loc_305f.js";
import { testHangingRopeGrabConnect } from "../testHangingRopeGrabConnect.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  GRAB_WINDOW_TABLE,
  PLAYER_Y,
  FORMATION_STATE,
  WAVE_TEARDOWN_STATE,
  GRAB_ACTIVE_FLAG,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IXBASE = 0x8a80; // IXL&3 == 0 selects window slot 0
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// The slot-0 half-width, read from the table so the window inputs stay derived from the data.
const HALF = ROM_PRESENT ? BASE.mem.read8(GRAB_WINDOW_TABLE) : 0;

/** A fresh clone: IX at slot 0, player coordinate + busy flags seated, grab latch cleared. */
function craft({ pos, f08 = 0, f24 = 0 }) {
  const m = BASE.clone();
  m.regs.ix = IXBASE;
  m.regs.sp = 0x8ffe; // inside STACK_SCRATCH: the oracle's pop-af/ret only read here
  m.mem.write8(PLAYER_Y, pos & 0xff);
  m.mem.write8(FORMATION_STATE, f08);
  m.mem.write8(WAVE_TEARDOWN_STATE, f24);
  m.mem.write8(GRAB_ACTIVE_FLAG, 0x00);
  return m;
}

// Player coordinates relative to the half-width: below the window, above it, and dead-centre.
const POS_BELOW = 0x00; //          window high edge < HALF -> no grab
const POS_ABOVE = (HALF + 0x12) & 0xff; // window low edge >= HALF -> no grab
const POS_INSIDE = HALF; //         low edge < HALF <= high edge -> inside the window

// -- 1. EQUAL (normal / no-grab paths) ----------------------------------------

test("EQUAL: no-grab paths (below / above / busy) — testHangingRopeGrabConnect == oracle in RAM (−stack), both true", () => {
  const CASES = [
    { label: "below window", pos: POS_BELOW },
    { label: "above window", pos: POS_ABOVE },
    { label: "inside but formation busy", pos: POS_INSIDE, f08: 0x01 },
    { label: "inside but teardown busy", pos: POS_INSIDE, f24: 0x01 },
  ];
  for (const { label, pos, f08 = 0, f24 = 0 } of CASES) {
    const o = craft({ pos, f08, f24 });
    const c = craft({ pos, f08, f24 });
    const oRet = oracle(o);
    const cRet = testHangingRopeGrabConnect(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
    assert.equal(oRet, true, `${label}: oracle took the normal path`);
    assert.equal(cRet, oRet, `${label}: module boolean matches the oracle path`);
    assert.equal(o.mem.read8(GRAB_ACTIVE_FLAG), 0x00, `${label}: grab latch untouched on the no-grab path`);
  }
  console.log(`  EQUAL(no-grab): ${CASES.length} cases identical (RAM −stack), all return true`);
});

// -- 2. EQUAL (grab / skip path) ----------------------------------------------

test("EQUAL: grab path (inside + idle) — testHangingRopeGrabConnect == oracle in RAM (−stack), both false", () => {
  const o = craft({ pos: POS_INSIDE });
  const c = craft({ pos: POS_INSIDE });
  const oRet = oracle(o);
  const cRet = testHangingRopeGrabConnect(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `grab: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
  assert.equal(oRet, false, "oracle took the grab (skip) path");
  assert.equal(cRet, oRet, "module boolean matches the oracle skip path");
  assert.equal(o.mem.read8(GRAB_ACTIVE_FLAG), 0x01, "grab latch raised on the grab path");
  console.log("  EQUAL(grab): identical (RAM −stack), both return false, latch := 1");
});

// -- 3. FOOTPRINT -------------------------------------------------------------

test("FOOTPRINT: the grab path raises 0x8d32; the no-grab path leaves it clear", () => {
  const grab = craft({ pos: POS_INSIDE });
  const before = grab.mem.read8(GRAB_ACTIVE_FLAG);
  oracle(grab);
  assert.equal(before, 0x00, "latch starts clear");
  assert.equal(grab.mem.read8(GRAB_ACTIVE_FLAG), 0x01, "latch raised by the grab path");

  const noGrab = craft({ pos: POS_BELOW });
  oracle(noGrab);
  assert.equal(noGrab.mem.read8(GRAB_ACTIVE_FLAG), 0x00, "latch clear on the no-grab path");
  console.log("  FOOTPRINT: grab -> 0x8d32 := 1; no-grab -> 0x8d32 unchanged");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong grab-latch byte is CAUGHT by the RAM diff", () => {
  const o = craft({ pos: POS_INSIDE });
  const c = craft({ pos: POS_INSIDE });
  oracle(o);
  testHangingRopeGrabConnect(c);
  c.mem.write8(GRAB_ACTIVE_FLAG, 0x00); // BUG: a twin that fails to raise the latch

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing grab-latch write — it is worthless");
  assert.equal(d.addr, GRAB_ACTIVE_FLAG, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: missing grab-latch write caught at ${hx(d.addr)}`);
});

test("TEETH: a twin returning the WRONG boolean is CAUGHT by the boolean-contract check", () => {
  // The EQUAL jobs assert the module boolean equals the oracle path. A twin that always returns
  // true would slip past a memory-only gate but must fail that boolean check on the skip path.
  const brokenAlwaysTrue = (mm) => {
    testHangingRopeGrabConnect(mm); // real memory effect
    return true; // BUG: never reports the skip
  };
  assert.throws(
    () => {
      const o = craft({ pos: POS_INSIDE });
      const c = craft({ pos: POS_INSIDE });
      const oRet = oracle(o);
      const cRet = brokenAlwaysTrue(c);
      assert.equal(cRet, oRet); // the boolean-contract check the EQUAL(grab) job runs
    },
    "boolean teeth: a twin that never returns false is caught",
  );
  console.log("  TEETH/BOOL: an always-true twin rejected on the skip path");
});
