// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEnemyVerticalAndDispatchByAltitude (ROM 0x39ba, Pooyan) — advance the enemy actor's vertical
 * position along its velocity, then branch on the state byte and the new high position.
 *
 * SEATING: BALANCED. LIVE-OUT is memory only — the routine rets or tail-delegates (armActorDropAnimationNearTop,
 * resetActorSubstateAndReloadStateTimer, fireEnemyShotWhenAlignedWithPlayer, all decompiled this batch / verified); the comparison is RAM (dumpState)
 * minus stack scratch below the entry SP. The register file is not compared.
 *
 * INPUT: IX (the actor record). The low position (+3) advances by the signed velocity (+0x0a),
 * borrowing one from the high byte (+4) on underflow. Crafted paths: no-borrow ret and borrow ret
 * (self arithmetic), the sub-state reset (resetActorSubstateAndReloadStateTimer), the arrival delegate (armActorDropAnimationNearTop, seated to
 * return), and the fire/drop gate (fireEnemyShotWhenAlignedWithPlayer, seated to return). Delegatee modules resolve at
 * reconcile; both sides run the SAME chosen delegatee so those agree by construction.
 *
 * Jobs:
 *   1. EQUAL — every crafted path: oracle == module in RAM (−stack).
 *   2. WRITE-SET — the borrow-ret path writes exactly the low and high position bytes.
 *   3. TEETH — a corrupted position byte is caught; a twin that skips the borrow diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-39ba.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_39ba as oracle } from "../../translated/loc_39af.js";
import { advanceEnemyVerticalAndDispatchByAltitude } from "../advanceEnemyVerticalAndDispatchByAltitude.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, WAVE_PROGRESS_COUNTER, LANE_SPAWN_COUNTDOWN } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b80; // isolated actor record base
const REC_POSLOW = 0x03;
const REC_POSHIGH = 0x04;
const REC_STATE = 0x07;
const REC_VEL = 0x0a;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** IX=REC, zeroed record, SP inside STACK_SCRATCH, then pokes applied. */
function craft(pokes) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ff0;
  for (let i = 0; i < 0x18; i++) m.mem8[REC + i] = 0x00;
  for (const [addr, val] of pokes) m.mem8[addr] = val & 0xff;
  return m;
}

const CASES = [
  { name: "no-borrow, state!=0, mid position -> ret",
    pokes: [[REC + REC_VEL, 0x80], [REC + REC_POSLOW, 0xa0], [REC + REC_POSHIGH, 0x08], [REC + REC_STATE, 0x01]] },
  { name: "borrow, state!=0, mid position -> ret",
    pokes: [[REC + REC_VEL, 0x05], [REC + REC_POSLOW, 0x02], [REC + REC_POSHIGH, 0x08], [REC + REC_STATE, 0x01]] },
  { name: "state!=0, high position < 4 -> resetActorSubstateAndReloadStateTimer",
    pokes: [[REC + REC_VEL, 0x00], [REC + REC_POSLOW, 0x10], [REC + REC_POSHIGH, 0x03], [REC + REC_STATE, 0x01]] },
  { name: "state == 0 -> armActorDropAnimationNearTop (returns: high >= 2)",
    pokes: [[REC + REC_VEL, 0x00], [REC + REC_POSLOW, 0x10], [REC + REC_POSHIGH, 0x05], [REC + REC_STATE, 0x00]] },
  { name: "state == 0, high < 2 -> armActorDropAnimationNearTop DROP-ARM (no-borrow, deterministic)",
    // vel=0 => u8(-vel)=0 => posLow(0x10) < 0 is false => no borrow => posHigh stays 0x01 < 2:
    // armActorDropAnimationNearTop must seat the drop animation and sub-state/timer. The high-position ARGUMENT is
    // load-bearing here — this is the case reverting to armActorDropAnimationNearTop(m, rec) can no longer pass.
    pokes: [[REC + REC_VEL, 0x00], [REC + REC_POSLOW, 0x10], [REC + REC_POSHIGH, 0x01], [REC + REC_STATE, 0x00]] },
  { name: "state!=0, high position >= 0x10 -> fireEnemyShotWhenAlignedWithPlayer (returns)",
    pokes: [[REC + REC_VEL, 0x00], [REC + REC_POSLOW, 0x10], [REC + REC_POSHIGH, 0x10], [REC + REC_STATE, 0x01],
            [WAVE_PROGRESS_COUNTER, 0x0e], [LANE_SPAWN_COUNTDOWN, 0x01]] },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted paths — advanceEnemyVerticalAndDispatchByAltitude == oracle in RAM (−stack)", () => {
  for (const cse of CASES) {
    const o = craft(cse.pokes);
    const c = craft(cse.pokes);
    oracle(o);
    advanceEnemyVerticalAndDispatchByAltitude(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the borrow-ret path writes exactly the low and high position", () => {
  const before = craft(CASES[1].pokes).dumpState();
  const after = craft(CASES[1].pokes);
  oracle(after);
  const a1 = after.dumpState();
  const changed = [];
  for (let off = 0; off < before.length; off++) if (before[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  assert.deepEqual(changed.sort((a, b) => a - b), [REC + REC_POSLOW, REC + REC_POSHIGH],
    `expected only pos low/high to change, got ${changed.map(hx)}`);
  assert.equal(after.mem8[REC + REC_POSLOW], 0x07, "low: 0x02 + 0x05 = 0x07");
  assert.equal(after.mem8[REC + REC_POSHIGH], 0x07, "high: 0x08 borrowed to 0x07");
  console.log("  WRITE-SET: pos low = 0x07, high = 0x07");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted position byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[1].pokes);
  const c = craft(CASES[1].pokes);
  oracle(o);
  advanceEnemyVerticalAndDispatchByAltitude(c);
  c.mem8[REC + REC_POSLOW] = (c.mem8[REC + REC_POSLOW] + 1) & 0xff; // BUG: wrong advanced position
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted position byte");
  assert.equal(d.addr, REC + REC_POSLOW, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the borrow (high byte) diverges from the oracle", () => {
  const o = craft(CASES[1].pokes);
  const c = craft(CASES[1].pokes);
  oracle(o);
  advanceEnemyVerticalAndDispatchByAltitude(c);
  c.mem8[REC + REC_POSHIGH] = (c.mem8[REC + REC_POSHIGH] + 1) & 0xff; // BUG twin: as if no borrow ran
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped borrow must be caught");
  assert.equal(d.addr, REC + REC_POSHIGH, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(borrow): caught at ${hx(d.addr)}`);
});

test("TEETH: state==0 & high<2 reaches armActorDropAnimationNearTop's DROP-ARM and the module matches the oracle", () => {
  // The state==0 branch delegates to armActorDropAnimationNearTop passing the NEW high-position byte. armActorDropAnimationNearTop only
  // arms the drop when that argument is < 2; the older state==0 case (posHigh>=2) early-returns,
  // so the high-position bridge is untested and reverting to armActorDropAnimationNearTop(m, rec) survives. This case
  // makes the drop-arm fire, so a lost high-position argument diverges.
  const DROP = CASES[4]; // state==0, high<2 (no-borrow)
  const o = craft(DROP.pokes);
  const c = craft(DROP.pokes);
  oracle(o);
  advanceEnemyVerticalAndDispatchByAltitude(c);

  // Live-out is derived from the ORACLE: prove the drop-arm genuinely ran (not another early-out).
  assert.equal(o.mem8[REC + 0x02], 0x02, "oracle: sub-state -> dropping (0x02)");
  assert.equal(o.mem8[REC + 0x11], 0x28, "oracle: phase timer reload 0x28");
  assert.equal(o.mem8[REC + 0x0c], 0xd1, "oracle: drop-anim pointer low byte (0x3bd1)");
  assert.equal(o.mem8[REC + 0x0d], 0x3b, "oracle: drop-anim pointer high byte (0x3bd1)");
  assert.equal(o.mem8[REC + 0x0e], 0x00, "oracle: anim frame index reset to 0");

  // The module must reproduce every one of those writes; a dropped high-position argument
  // (armActorDropAnimationNearTop(m, rec)) turns the drop-arm into an early return and this diff catches it.
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `drop-arm RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  TEETH(drop-arm): high<2 seats anim 0x3bd1 + sub-state 0x02 / timer 0x28; module == oracle");
});
