// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchSpecialObjectRecordState (ROM 0x6822) — the special-object (0x8b28) record state
 * dispatcher. Returns when the gate (0x8afa) is zero; otherwise dispatches (0x8b2a) state 0..2 via the
 * inline table 0x6834 (tail dispatch). Oracle reaches handlers through rst 0x28; the module calls the
 * same handler directly, so game RAM is identical (only the trampoline stack differs — excluded).
 *
 * Jobs: CAPTURE (real dispatches), gate-closed (no-op), each state 0/1/2, SP-TOOTH, TEETH (mis-route).
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6822.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { loc_6822 as oracle } from "../../translated/loc_6822.js";
import { dispatchSpecialObjectRecordState } from "../dispatchSpecialObjectRecordState.js";
import { advanceObjectToNextStateAndArmAnim } from "../advanceObjectToNextStateAndArmAnim.js";
import { verifyPlayfieldTileChecksumOnce } from "../verifyPlayfieldTileChecksumOnce.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_REC_DISPATCH_GATE, ENEMY_ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (n, f) => nodeTest(n, { skip: "skipped: ROM not built" }, f);
const TARGET = 0x6822;
const REC = ENEMY_ACTOR_TABLE + 0x48; // 0x8b28
const SP0 = 0x8fe0;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const ramDiffMinusStack = (ma, mb, dead = inDeadStack) => firstStateDiff(ma.dumpState(), mb.dumpState(), (o) => ma.stateOffsetToAddr(o), dead);
const runGuarded = (fn, m) => { try { fn(m); return { threw: false }; } catch (e) { return { threw: true, msg: String(e && e.message) }; } };
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(gate, state) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(ENEMY_REC_DISPATCH_GATE, gate);
  m.mem.write8(REC + 0x02, state);
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep */ }
  return caps;
}

test("CAPTURE: real 0x6822 dispatches replay identically", () => {
  const caps = ROM_PRESENT ? captureDispatches(24, 4000) : [];
  for (const cap of caps) {
    const o = cap.clone(), c = cap.clone();
    const ro = runGuarded(oracle, o), rc = runGuarded(dispatchSpecialObjectRecordState, c);
    assert.equal(ro.threw, rc.threw, `divergent control flow (oracle=${ro.threw} module=${rc.threw})`);
    if (!ro.threw) { const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp)); assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}`); }
  }
  console.log(`  CAPTURE: ${caps.length} real 0x6822 dispatch(es) replayed identically`);
});

test("CRAFTED: gate-closed no-op + each state 0/1/2 route identically", () => {
  const cases = [
    { name: "gate closed", gate: 0x00, state: 0x01 },
    { name: "state 0", gate: 0x01, state: 0x00 },
    { name: "state 1", gate: 0x01, state: 0x01 },
    { name: "state 2", gate: 0x01, state: 0x02 },
  ];
  for (const { name, gate, state } of cases) {
    const o = craft(gate, state), c = craft(gate, state);
    const ro = runGuarded(oracle, o), rc = runGuarded(dispatchSpecialObjectRecordState, c);
    assert.equal(ro.threw, rc.threw, `${name}: divergent control flow`);
    if (!ro.threw) { const d = ramDiffMinusStack(o, c); assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}`); }
  }
  console.log(`  CRAFTED: ${cases.length} gate/state cases routed identically`);
});

test("SP-TOOTH: the gated tail dispatch is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, dispatchSpecialObjectRecordState, TARGET, craft(0x01, 0x00));
  assert.equal(r.placeable, true, `dispatcher must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: gated tail dispatch seats cleanly");
});

test("TEETH: a twin routing state 0 to the wrong handler is caught", () => {
  const brokenWrong = (m) => {
    const { mem8 } = m;
    if (mem8[ENEMY_REC_DISPATCH_GATE] === 0) return;
    const rec = ENEMY_ACTOR_TABLE + 0x48;
    switch (mem8[rec + 0x02]) { case 0: return verifyPlayfieldTileChecksumOnce(m); default: return advanceObjectToNextStateAndArmAnim(m, rec); } // BUG: state 0 -> verifyPlayfieldTileChecksumOnce
  };
  const o = craft(0x01, 0x00), c = craft(0x01, 0x00);
  const ro = runGuarded(oracle, o), rc = runGuarded(brokenWrong, c);
  const caught = ro.threw !== rc.threw || (!ro.threw && ramDiffMinusStack(o, c) !== null);
  assert.equal(caught, true, "the gate FAILED to catch a mis-routed state");
  console.log("  TEETH: mis-route caught");
});
