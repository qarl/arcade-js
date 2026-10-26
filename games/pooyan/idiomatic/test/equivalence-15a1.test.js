// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchInPlaySubState (ROM 0x15a1) — the in-play sub-state dispatcher. Tail-hands
 * (0x880a)&0x1f to one of 19 handlers via the inline table 0x15a8; the handler returns to the caller's
 * seated continuation (a tail dispatch). Oracle reaches handlers through rst 0x28; the module switches
 * directly. Compared: RAM (dumpState − stack scratch below the entry SP). Indices 15/16/17 dispatch to the deep-state
 * handlers (dispatchLevelIntroElseMainLoop/announceBonusStageAndStartPlay/commitPromotedObjectsAndClearHelpScreenOnCountdown) exactly as the oracle's table does, so they are checked by
 * memory-eq like every other index; only 19..31 (guard-slack past the 19-entry table) throw.
 *
 * Jobs: CAPTURE (load-bearing, real play dispatches), CRAFTED routing (0..18), SP-TOOTH (captured
 * state), GUARD-SLACK (>18 raise), TEETH (mis-route).
 * Run: node --test games/pooyan/idiomatic/test/equivalence-15a1.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loc_15a1 as oracle } from "../../translated/loc_15a1.js";
import { dispatchInPlaySubState } from "../dispatchInPlaySubState.js";
import { initRoundArenaAndRestorePlayerBank } from "../initRoundArenaAndRestorePlayerBank.js";
import { spawnEnemyWave } from "../spawnEnemyWave.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PLAY_STATE_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (n, f) => nodeTest(n, { skip: "skipped: ROM not built" }, f);
const TARGET = 0x15a1;
const SP0 = 0x8fe0;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const ramDiffMinusStack = (ma, mb, dead = inDeadStack) => firstStateDiff(ma.dumpState(), mb.dumpState(), (o) => ma.stateOffsetToAddr(o), dead);
const runGuarded = (fn, m) => { try { fn(m); return { threw: false }; } catch (e) { return { threw: true, msg: String(e && e.message) }; } };
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(state) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, 0xfffc);
  m.regs.hl = 0x15d1; // caller seats the continuation in HL; the idiomatic tail dispatch ignores it
  m.mem8[PLAY_STATE_INDEX] = state & 0xff;
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep */ }
  return caps;
}

test("CAPTURE: real 0x15a1 dispatches replay identically (oracle vs module)", () => {
  const caps = ROM_PRESENT ? captureDispatches(48, 8000) : [];
  for (const cap of caps) {
    const o = cap.clone(), c = cap.clone();
    const ro = runGuarded(oracle, o), rc = runGuarded(dispatchInPlaySubState, c);
    assert.equal(ro.threw, rc.threw, `divergent control flow (oracle=${ro.threw} module=${rc.threw}) msg=${rc.msg}`);
    if (!ro.threw) { const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp)); assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`); }
  }
  console.log(`  CAPTURE: ${caps.length} real 0x15a1 dispatch(es) replayed identically`);
});

test("CRAFTED: each dispatchable index (0..18) routes identically", () => {
  // 15/16/17 dispatch to the deep-state handlers (dispatchLevelIntroElseMainLoop/announceBonusStageAndStartPlay/commitPromotedObjectsAndClearHelpScreenOnCountdown); they match the oracle
  // like every other index, so they belong in the memory-eq sweep rather than a throw assertion.
  for (const state of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
    const o = craft(state), c = craft(state);
    const ro = runGuarded(oracle, o), rc = runGuarded(dispatchInPlaySubState, c);
    assert.equal(ro.threw, rc.threw, `state ${state}: divergent control flow (oracle=${ro.threw} module=${rc.threw})`);
    if (!ro.threw) { const d = ramDiffMinusStack(o, c); assert.equal(d, null, d && `state ${state}: RAM diff at ${hx(d.addr ?? 0)}`); }
  }
  console.log("  CRAFTED: dispatchable indices routed identically");
});

test("SP-TOOTH: the tail dispatch is seam-placeable (on a real captured state)", () => {
  const caps = ROM_PRESENT ? captureDispatches(1, 8000) : [];
  if (caps.length === 0) { console.log("  SP-TOOTH: no capture reached; skipped (15a1 seats no return)"); return; }
  const r = seamPlaceable(withOmittedRet, dispatchInPlaySubState, TARGET, caps[0]);
  assert.equal(r.placeable, true, `dispatcher must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: tail dispatch seats cleanly on a real state");
});

test("GUARD-SLACK: indices > 18 (past the 19-entry table) raise", () => {
  for (const state of [19, 25, 31]) {
    assert.throws(() => dispatchInPlaySubState(craft(state)), /guard-slack/, `state ${state} must throw`);
  }
  console.log("  GUARD-SLACK: >18 raise");
});

test("TEETH: a twin routing state 0 to the wrong handler is caught", () => {
  const brokenWrong = (m) => {
    switch (m.mem8[PLAY_STATE_INDEX] & 0x1f) { case 0: return spawnEnemyWave(m); default: return initRoundArenaAndRestorePlayerBank(m); } // BUG: state 0 -> spawnEnemyWave
  };
  const o = craft(0), c = craft(0);
  const ro = runGuarded(oracle, o), rc = runGuarded(brokenWrong, c);
  const caught = ro.threw !== rc.threw || (!ro.threw && ramDiffMinusStack(o, c) !== null);
  assert.equal(caught, true, "the gate FAILED to catch a mis-routed state");
  console.log("  TEETH: mis-route caught");
});
