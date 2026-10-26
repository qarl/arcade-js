// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchBonusStagePhase (ROM 0x71b9) — the bonus/eagle-stage phase dispatcher. Selects
 * a handler by the outer wave phase (0x8f38) via the inline table 0x71c1, then runs the shared epilogue
 * 0x02ef. Oracle reaches the handler through rst 0x28 with 0x02ef seated as the return; the module calls
 * the handler directly then runs rebuildSpriteDisplayList. Compared: RAM (dumpState − stack scratch below the entry SP).
 *
 * 71b9 seats NO return via m.push16 and does no m.call to a translated routine — it switches to
 * idiomatic handlers then runs the idiomatic epilogue directly, so the missing-push16 class (R36) cannot
 * arise and no SP-tooth applies (matching dispatchActiveObjectState, the pure-switch template). The
 * callees are SP-neutral by their own equivalence tests.
 *
 * Jobs: CAPTURE (real dispatches), each phase 0/1/2, TEETH (mis-route).
 * Run: node --test games/pooyan/idiomatic/test/equivalence-71b9.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loc_71b9 as oracle } from "../../translated/loc_71b9.js";
import { dispatchBonusStagePhase } from "../dispatchBonusStagePhase.js";
import { runEagleApproachPhaseFrame } from "../runEagleApproachPhaseFrame.js";
import { clearWaveStateAndArenaOnHoldExpiry } from "../clearWaveStateAndArenaOnHoldExpiry.js";
import { rebuildSpriteDisplayList } from "../rebuildSpriteDisplayList.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, WAVE_OUTER_PHASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (n, f) => nodeTest(n, { skip: "skipped: ROM not built" }, f);
const TARGET = 0x71b9;
const SP0 = 0x8fe0;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const ramDiffMinusStack = (ma, mb, dead = inDeadStack) => firstStateDiff(ma.dumpState(), mb.dumpState(), (o) => ma.stateOffsetToAddr(o), dead);
const runGuarded = (fn, m) => { try { fn(m); return { threw: false }; } catch (e) { return { threw: true, msg: String(e && e.message) }; } };
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(phase) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(WAVE_OUTER_PHASE, phase);
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep */ }
  return caps;
}

test("CAPTURE: real 0x71b9 dispatches replay identically", () => {
  const caps = ROM_PRESENT ? captureDispatches(24, 6000) : [];
  for (const cap of caps) {
    const o = cap.clone(), c = cap.clone();
    const ro = runGuarded(oracle, o), rc = runGuarded(dispatchBonusStagePhase, c);
    assert.equal(ro.threw, rc.threw, `divergent control flow (oracle=${ro.threw} module=${rc.threw})`);
    if (!ro.threw) { const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp)); assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}`); }
  }
  console.log(`  CAPTURE: ${caps.length} real 0x71b9 dispatch(es) replayed identically`);
});

test("CRAFTED: each phase 0/1/2 (dispatch + epilogue) routes identically", () => {
  for (const phase of [0, 1, 2]) {
    const o = craft(phase), c = craft(phase);
    const ro = runGuarded(oracle, o), rc = runGuarded(dispatchBonusStagePhase, c);
    assert.equal(ro.threw, rc.threw, `phase ${phase}: divergent control flow`);
    if (!ro.threw) { const d = ramDiffMinusStack(o, c); assert.equal(d, null, d && `phase ${phase}: RAM diff at ${hx(d.addr ?? 0)}`); }
  }
  console.log("  CRAFTED: phases 0/1/2 routed + epilogue run identically");
});

test("TEETH: a twin routing phase 0 to the wrong handler is caught", () => {
  const brokenWrong = (m) => {
    switch (m.mem8[WAVE_OUTER_PHASE]) { case 0: clearWaveStateAndArenaOnHoldExpiry(m); break; default: runEagleApproachPhaseFrame(m); break; } // BUG: phase 0 -> clearWaveStateAndArenaOnHoldExpiry
    return rebuildSpriteDisplayList(m);
  };
  const o = craft(0), c = craft(0);
  const ro = runGuarded(oracle, o), rc = runGuarded(brokenWrong, c);
  const caught = ro.threw !== rc.threw || (!ro.threw && ramDiffMinusStack(o, c) !== null);
  assert.equal(caught, true, "the gate FAILED to catch a mis-routed phase");
  console.log("  TEETH: mis-route caught");
});
