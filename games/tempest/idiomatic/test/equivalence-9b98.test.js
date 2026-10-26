// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for dispatchSlotMotionHandler (ROM 0x9b98-0x9ba1) -- an RTS-trick COMPUTED-JUMP dispatcher: tay then pushes
// word($9ba2+Y) and rts, jumping to word+1. The incoming A is a PRE-DOUBLED index (the caller left the
// 2-byte table offset in it), so entry N sits at A = 2N -- the idiomatic form is TABLE[a >> 1]. The twenty
// targets each act for their own side effects; none reads the incoming A as data (A is the dispatch index,
// consumed), so the contract is RAM (dumpState minus stack scratch below the entry SP); the oracle's stack gymnastics land
// below the entry SP. Run: node --test games/tempest/idiomatic/test/equivalence-9b98.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9b98 } from "../../translated/loc_9b98.js";
import { dispatchSlotMotionHandler } from "../dispatchSlotMotionHandler.js";
import { endObjectMotionScript } from "../endObjectMotionScript.js";
import { writeScriptConstantToSlot } from "../writeScriptConstantToSlot.js";
import { skipScriptOperandWhenFlagClear } from "../skipScriptOperandWhenFlagClear.js";
import { followScriptGoto } from "../followScriptGoto.js";
import { holdSlotPoseUntilTimerExpires } from "../holdSlotPoseUntilTimerExpires.js";
import { noopDispatchStub } from "../noopDispatchStub.js";
import { stepEnemyDepthInLaneDirection } from "../stepEnemyDepthInLaneDirection.js";
import { advanceClimberTrackingColumnMin } from "../advanceClimberTrackingColumnMin.js";
import { writeScriptVariableToSlot } from "../writeScriptVariableToSlot.js";
import { stepClimberSegmentGuarded } from "../stepClimberSegmentGuarded.js";
import { animateFlipperTurn } from "../animateFlipperTurn.js";
import { toggleEnemyTurnSide } from "../toggleEnemyTurnSide.js";
import { spawnType5OnCoordMatch } from "../spawnType5OnCoordMatch.js";
import { jumpScriptCursorWhenFlagClear } from "../jumpScriptCursorWhenFlagClear.js";
import { setFlagIfSlotPastSegmentBound } from "../setFlagIfSlotPastSegmentBound.js";
import { advanceEnemyPursuit } from "../advanceEnemyPursuit.js";
import { fireHitOnPlayerCollision } from "../fireHitOnPlayerCollision.js";
import { steerSlotCoordinate } from "../steerSlotCoordinate.js";
import { faceEnemyTowardPlayerSegment } from "../faceEnemyTowardPlayerSegment.js";
import { setFlagFromPhaseAccumulatorSign } from "../setFlagFromPhaseAccumulatorSign.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9b98;
const TABLE = [
  endObjectMotionScript, writeScriptConstantToSlot, skipScriptOperandWhenFlagClear, followScriptGoto, holdSlotPoseUntilTimerExpires, noopDispatchStub, stepEnemyDepthInLaneDirection, advanceClimberTrackingColumnMin, writeScriptVariableToSlot, stepClimberSegmentGuarded,
  animateFlipperTurn, toggleEnemyTurnSide, spawnType5OnCoordMatch, jumpScriptCursorWhenFlagClear, setFlagIfSlotPastSegmentBound, advanceEnemyPursuit, fireHitOnPlayerCollision, steerSlotCoordinate, faceEnemyTowardPlayerSegment, setFlagFromPhaseAccumulatorSign,
];
const oracle = atEntry(loc_9b98);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 4000) : [];

test("CAPTURE: real 0x9b98 dispatches -- dispatchSlotMotionHandler == oracle in RAM (-stack); indices are even (pre-doubled)", () => {
  const as = new Set();
  let checked = 0;
  for (const cap of CAPS) {
    as.add(cap.regs.a);
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    dispatchSlotMotionHandler(c);
    assert.equal(ramDiff(o, c), null, `RAM equal for captured A=${cap.regs.a}`);
    checked++;
  }
  for (const a of as) assert.equal(a & 1, 0, `captured dispatch index A=${a} must be even (pre-doubled)`);
  console.log(`  CAPTURE: ${checked}/${CAPS.length} checked; distinct A: [${[...as].sort((a, b) => a - b).join(",")}]`);
});

test("CRAFTED: each entry index (A = 2N) -- dispatchSlotMotionHandler == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (let n = 0; n < TABLE.length; n++) {
    const base = new Machine(ROM, OPTS);
    base.regs.a = n << 1; base.regs.x = 0x00; base.regs.y = 0x00;
    const o = base.clone(), c = base.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // an entry the bare seed cannot provision -- CAPTURE carries it
    dispatchSlotMotionHandler(c);
    assert.equal(ramDiff(o, c), null, `RAM equal dispatching entry N=${n} (A=${n << 1})`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/${TABLE.length} entries provisioned and checked`);
  assert.ok(checked >= 1, "no entry could be provisioned -- seed is inert");
});

test("TEETH: a twin that dispatches the WRONG entry (N^1) diverges in RAM", () => {
  let caught = false, tried = 0;
  for (let n = 0; n < TABLE.length; n++) {
    const base = new Machine(ROM, OPTS);
    base.regs.a = n << 1; base.regs.x = 0x00; base.regs.y = 0x00;
    const o = base.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue;
    const flipped = n ^ 1;
    if (flipped >= TABLE.length) continue;
    const c = base.clone();
    let brokeThrew = false;
    try { TABLE[flipped](c); } catch { brokeThrew = true; }
    if (brokeThrew) continue;
    tried++;
    if (ramDiff(o, c) !== null) { caught = true; break; }
  }
  assert.ok(tried > 0, "no entry pair could be exercised for the teeth arm");
  assert.ok(caught, "the RAM diff FAILED to catch a wrong-entry dispatch on every exercised pair");
});

test("SP-TOOTH: the omitted-ret dispatcher (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.a = 0x00; m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, dispatchSlotMotionHandler, TARGET, m);
  assert.equal(r.placeable, true, `dispatchSlotMotionHandler must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret dispatcher (moved 0) placeable");
});
