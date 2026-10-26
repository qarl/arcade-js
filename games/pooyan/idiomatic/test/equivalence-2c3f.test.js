// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for dispatchOneHunterRecordState (ROM 0x2c3f) — the per-hunter-record state dispatcher
 * (DISSOLVED boolean caller-skip: dispatchAllHunterRecordStates early-returns on false). Returns true for an inactive slot
 * or a state below 0x11; otherwise ((IX+2)&0x1f)-0x11 selects one of four handlers via table 0x2c50
 * and propagates their boolean. The oracle reaches handlers through rst 0x28; the module switches to the
 * same handler directly. Compared per case: RAM (dumpState − stack scratch below the entry SP) PLUS the JS boolean.
 *
 * Jobs: CAPTURE (real dispatches), guard cases (inactive/below-range -> true), each dispatch state
 * 0x11..0x14 routes + propagates, TEETH (RAM + mis-route).
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2c3f.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loc_2c3f as oracle } from "../../translated/loc_2c3f.js";
import { dispatchOneHunterRecordState } from "../dispatchOneHunterRecordState.js";
import { climbHunterToLaunchRowThenPromoteGroup } from "../climbHunterToLaunchRowThenPromoteGroup.js";
import { clearWaveHoldTimerToArmNextWave } from "../clearWaveHoldTimerToArmNextWave.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (n, f) => nodeTest(n, { skip: "skipped: ROM not built" }, f);
const TARGET = 0x2c3f;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff8);
const ramDiffMinusStack = (ma, mb, dead = inDeadStack) => firstStateDiff(ma.dumpState(), mb.dumpState(), (o) => ma.stateOffsetToAddr(o), dead);
const runGuarded = (fn, m) => { try { return { threw: false, ret: fn(m) }; } catch (e) { return { threw: true, msg: String(e && e.message) }; } };
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

const REC = 0x8a80;
const HOLD = 0x0e;

function craft(b0, b1, state) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ff8; // in STACK_SCRATCH
  m.mem.write8(REC + 0x00, b0);
  m.mem.write8(REC + 0x01, b1);
  m.mem.write8(REC + 0x02, state);
  m.mem.write8(REC + HOLD, 0x05); // frame-hold nonzero -> handler animation step is shallow
  return m;
}

// -- CAPTURE ------------------------------------------------------------------
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep captured */ }
  return caps;
}
test("CAPTURE: real 0x2c3f dispatches replay identically (RAM −stack + boolean)", () => {
  const caps = ROM_PRESENT ? captureDispatches(32, 4000) : [];
  for (const cap of caps) {
    const o = cap.clone(), c = cap.clone();
    const ro = runGuarded(oracle, o), rc = runGuarded(dispatchOneHunterRecordState, c);
    assert.equal(ro.threw, rc.threw, `divergent control flow (oracle=${ro.threw} module=${rc.threw})`);
    if (!ro.threw) {
      assert.equal(rc.ret, ro.ret, `boolean mismatch: oracle=${ro.ret} module=${rc.ret}`);
      const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
      assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    }
  }
  console.log(`  CAPTURE: ${caps.length} real 0x2c3f dispatch(es) replayed identically`);
});

// -- guards + dispatch --------------------------------------------------------
test("GUARDS: inactive slot and below-range state both return true (no dispatch)", () => {
  for (const { name, b0, b1, state } of [
    { name: "inactive (0,0)", b0: 0x00, b1: 0x00, state: 0x11 },
    { name: "active, state 0x05 < 0x11", b0: 0x01, b1: 0x00, state: 0x05 },
  ]) {
    const o = craft(b0, b1, state), c = craft(b0, b1, state);
    const ro = oracle(o), rc = dispatchOneHunterRecordState(c);
    assert.equal(ro, true, `${name}: oracle returns true`);
    assert.equal(rc, ro, `${name}: idiomatic boolean must match`);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}`);
  }
  console.log("  GUARDS: inactive + below-range both true, RAM identical");
});

test("DISPATCH: each state 0x11..0x14 routes + propagates the boolean identically", () => {
  for (let i = 0; i < 4; i++) {
    const state = 0x11 + i;
    const o = craft(0x01, 0x00, state), c = craft(0x01, 0x00, state);
    const ro = runGuarded(oracle, o), rc = runGuarded(dispatchOneHunterRecordState, c);
    assert.equal(ro.threw, rc.threw, `state ${hx(state)}: divergent control flow`);
    if (!ro.threw) {
      assert.equal(rc.ret, ro.ret, `state ${hx(state)}: boolean mismatch oracle=${ro.ret} module=${rc.ret}`);
      const d = ramDiffMinusStack(o, c);
      assert.equal(d, null, d && `state ${hx(state)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    }
  }
  console.log("  DISPATCH: states 0x11..0x14 routed + boolean propagated identically");
});

// -- TEETH --------------------------------------------------------------------
test("TEETH: a mis-routed state (0x11 -> wrong handler) is caught", () => {
  const brokenWrong = (m, rec = m.regs.ix) => {
    const { mem8 } = m;
    if (((mem8[rec + 0] | mem8[rec + 1]) & 1) === 0) return true;
    const state = mem8[rec + 2] & 0x1f;
    if (state < 0x11) return true;
    return clearWaveHoldTimerToArmNextWave(m, rec); // BUG: state 0x11 should route to climbHunterToLaunchRowThenPromoteGroup
  };
  const o = craft(0x01, 0x00, 0x11), c = craft(0x01, 0x00, 0x11);
  const ro = runGuarded(oracle, o), rc = runGuarded(brokenWrong, c);
  const caught = ro.threw !== rc.threw || rc.ret !== ro.ret || (!ro.threw && ramDiffMinusStack(o, c) !== null);
  assert.equal(caught, true, "the gate FAILED to catch a mis-routed state");
  console.log("  TEETH: mis-route caught");
  void climbHunterToLaunchRowThenPromoteGroup;
});
