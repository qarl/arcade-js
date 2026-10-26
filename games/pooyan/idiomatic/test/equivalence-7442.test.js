// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchSelfTestState (ROM 0x7442, Pooyan) — the attract/self-test state dispatcher.
 *
 * The oracle reads the self-test state (0x8921 & 3) and reaches one of three handlers via rst 0x28
 * (inline table 0x7448 {0->744e, 1->7517, 2->755d}) with no return pushed — a tail dispatch. The
 * module replaces the trampoline with a direct switch to the same handler. Both drive the SAME
 * handler, so equivalence is RAM (dumpState) minus stack scratch below the entry SP; the dispatcher itself writes no game
 * RAM, so any diff is a mis-route or a missed register bridge.
 *
 * Jobs:
 *   1. CAPTURE (load-bearing) — replay every real 0x7442 dispatch a boot reaches; oracle == module.
 *   2. CRAFTED — each selector 0/1/2 (+ high bits proving the &3 mask) routes identically.
 *   3. SP-TOOTH (R36) — the tail dispatch is seam-placeable.
 *   4. TEETH — a twin routing selector 1 to the wrong handler is caught in RAM.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7442.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7442 as oracle } from "../../translated/loc_7442.js";
import { dispatchSelfTestState } from "../dispatchSelfTestState.js";
import { seedDisplayListPointersAndVerifyRomSignature } from "../seedDisplayListPointersAndVerifyRomSignature.js";
import { runDisplayListAndAdvanceToGameplay } from "../runDisplayListAndAdvanceToGameplay.js";
import { updateGameplayFrame } from "../updateGameplayFrame.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SELFTEST_DISPATCH_STATE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x7442;
const SP0 = 0x8fe0; // inside STACK_SCRATCH
const CALLER_RET = 0xfffc;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/** Run fn(m) capturing a thrown error; the handler may dive into deep code from a fresh state. */
function runGuarded(fn, m) {
  try { fn(m); return { threw: false }; } catch (e) { return { threw: true, msg: String(e && e.message) }; }
}

/** A fresh clone with the selector seated + a caller-return parked at SP0. */
function craft(state) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.mem8[SELFTEST_DISPATCH_STATE] = state & 0xff;
  return m;
}

// -- 1. CAPTURE (load-bearing) ------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep captured */ }
  return caps;
}

test("CAPTURE: real 0x7442 dispatches replay identically (oracle vs module)", () => {
  const caps = ROM_PRESENT ? captureDispatches(24, 1200) : [];
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    const ro = runGuarded(oracle, o);
    const rc = runGuarded(dispatchSelfTestState, c);
    assert.equal(ro.threw, rc.threw, `divergent control flow: oracle threw=${ro.threw} module threw=${rc.threw}`);
    if (!ro.threw) {
      const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
      assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    }
  }
  console.log(`  CAPTURE: ${caps.length} real 0x7442 dispatch(es) replayed identically`);
});

// -- 2. CRAFTED (routing) -----------------------------------------------------

test("CRAFTED: each selector 0/1/2 (+ &3 mask) routes identically (oracle vs module)", () => {
  const cases = [
    { name: "state 0", state: 0x00 },
    { name: "state 1", state: 0x01 },
    { name: "state 2", state: 0x02 },
    { name: "high bits &3=0", state: 0x04 },
    { name: "high bits &3=1", state: 0x05 },
    { name: "high bits &3=2", state: 0x06 },
  ];
  for (const { name, state } of cases) {
    const o = craft(state);
    const c = craft(state);
    const ro = runGuarded(oracle, o);
    const rc = runGuarded(dispatchSelfTestState, c);
    assert.equal(ro.threw, rc.threw, `${name}: divergent control flow (oracle threw=${ro.threw} module threw=${rc.threw})`);
    if (!ro.threw) {
      const d = ramDiffMinusStack(o, c);
      assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    }
  }
  console.log(`  CRAFTED: ${cases.length} selector/mask cases routed identically`);
});

// -- 3. SP-TOOTH (R36) --------------------------------------------------------

test("SP-TOOTH: the tail dispatch is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, dispatchSelfTestState, TARGET, craft(0x00));
  assert.equal(r.placeable, true, `dispatcher must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: tail dispatch seats cleanly");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: routes selector 1 to the wrong handler (state 2's). */
function brokenWrongSelector(m) {
  switch (m.mem8[SELFTEST_DISPATCH_STATE] & 0x03) {
    case 0: return seedDisplayListPointersAndVerifyRomSignature(m);
    case 1: return updateGameplayFrame(m); // BUG: selector 1 should be runDisplayListAndAdvanceToGameplay
    case 2: return updateGameplayFrame(m);
    default: throw new Error("guard-slack");
  }
}

test("TEETH: a twin routing selector 1 to the wrong handler is caught", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  const ro = runGuarded(oracle, o);
  const rc = runGuarded(brokenWrongSelector, c);
  // A mis-route must show up as either a control-flow split or a RAM diff.
  const caught = ro.threw !== rc.threw || (!ro.threw && ramDiffMinusStack(o, c) !== null);
  assert.equal(caught, true, "the gate FAILED to catch a mis-routed selector — it is worthless");
  console.log("  TEETH(selector): mis-route caught");
});
