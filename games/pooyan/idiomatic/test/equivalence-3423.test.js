// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchActorState1MovementByMode (ROM 0x3423, Pooyan) — enemy-actor state-1 entry prologue.
 * Steps the record's animation frame (loc_4006), then branches on bit0 of the mode byte (rec+0x01):
 *   - clear: dispatch on the state byte (rec+0x08) — nonzero tails into advanceObjectColumnByStepAndDispatch, zero delegates into
 *     advanceActorColumnAndArmTurnOrBand;
 *   - set: gate on the anim-armed latch (0x8f63) — nonzero returns; otherwise clear rec+0x01 and defer
 *     to armInteriorBandOrMarkActorActive.
 *
 * Cycle-free / memory-equivalence gate: a fresh clone per side, oracle on one and dispatchActorState1MovementByMode on the
 * other, compared on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared, and there
 * is NO register live-out (the record-dispatch caller reloads A and reads no other register back).
 * The oracle's loc_4006 call (frozen return-slot push at 0x3426) and every tail land inside
 * STACK_SCRATCH; the idiomatic layer drops that push, so the SP-tooth proves the drop is SP-neutral.
 *
 * Every record seats rec+0x0e (the anim frame-hold) non-zero so loc_4006 just decrements it — an
 * isolated, ROM-walk-free prologue. The leaf is not reached in a plain boot, so every case is CRAFTED
 * (identical pokes on both sides), the record pre-dirtied to 0xAA.
 *
 * Jobs:
 *   1. EQUAL — bit0-clear -> advanceObjectColumnByStepAndDispatch (nonzero state) and -> advanceActorColumnAndArmTurnOrBand (zero state); bit0-set -> ret
 *      (latch armed) and -> clear+armInteriorBandOrMarkActorActive (latch clear) all agree in RAM (−stack).
 *   2. WRITE-SET — the latch-armed ret path's only write is the frame-hold decrement (rec+0x0e).
 *   3. TEETH — a wrong frame-hold byte and a wrong advanced sub-position (advanceActorColumnAndArmTurnOrBand) are each CAUGHT.
 *   4. SP-TOOTH — dropping the 0x3426 return-slot push is SP-neutral (seam-placeable); a leak is NOT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3423.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3423 as oracle } from "../../translated/loc_3423.js";
import { dispatchActorState1MovementByMode } from "../dispatchActorState1MovementByMode.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ANIM_ARMED_LATCH,
  TURN_COLUMN_LIMIT,
  PLAY_STATE_INDEX,
  SPAWN_PHASE_SNAPSHOT,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b60; //          work-RAM record base (IX); disjoint from every shared cell touched
const REC_LEN = 0x18;
const OFF_MODE = 0x01;
const OFF_SUBPOS = 0x05;
const OFF_COL = 0x06;
const OFF_STATE = 0x08;
const OFF_AIM = 0x09;
const OFF_STEP = 0x0a;
const OFF_HOLD = 0x0e; // anim frame-hold counter
const DIRT = 0xaa;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0); // the RAM diffs all enter at the craft seat
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record pre-dirtied, mode/state/motion + shared cells seated, IX=REC, SP in dead stack. */
function craft(f) {
  const m = BASE.clone();
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, DIRT);
  m.mem.write8(REC + OFF_HOLD, 0x05); //         frame-hold non-zero -> loc_4006 just decrements
  m.mem.write8(REC + OFF_MODE, f.mode);
  m.mem.write8(REC + OFF_STATE, f.state ?? DIRT);
  m.mem.write8(REC + OFF_SUBPOS, f.subpos ?? DIRT);
  m.mem.write8(REC + OFF_COL, f.col ?? DIRT);
  m.mem.write8(REC + OFF_AIM, f.aim ?? DIRT);
  m.mem.write8(REC + OFF_STEP, f.step ?? 0x00);
  m.mem.write8(ANIM_ARMED_LATCH, f.armed ?? 0x00);
  m.mem.write8(TURN_COLUMN_LIMIT, f.limit ?? 0x00);
  m.mem.write8(PLAY_STATE_INDEX, f.play ?? 0x00);
  m.mem.write8(SPAWN_PHASE_SNAPSHOT, f.phase ?? 0x00);
  m.regs.ix = REC;
  m.regs.sp = 0x8fe0; // deep in STACK_SCRATCH: the nested call/push/ret stay inside
  return m;
}

const CASES = [
  { name: "bit0 clear, state!=0 -> advanceObjectColumnByStepAndDispatch (col>limit ret)", f: { mode: 0xaa, state: 0x05, col: 0x10, limit: 0x05, step: 0x00, subpos: 0x00 } },
  { name: "bit0 clear, state==0 -> advanceActorColumnAndArmTurnOrBand (col<limit ret)", f: { mode: 0xaa, state: 0x00, subpos: 0x10, aim: 0x05, col: 0x01, limit: 0x05 } },
  { name: "bit0 set, latch armed -> ret", f: { mode: 0xab, armed: 0x01 } },
  { name: "bit0 set, latch clear -> clear mode + armInteriorBandOrMarkActorActive (phase capped)", f: { mode: 0xab, armed: 0x00, phase: 0x07 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted dispatch arms — dispatchActorState1MovementByMode == oracle in RAM (−stack)", () => {
  for (const cse of CASES) {
    const o = craft(cse.f);
    oracle(o);
    const c = craft(cse.f);
    dispatchActorState1MovementByMode(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted dispatch arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the latch-armed ret path writes exactly the frame-hold decrement (rec+0x0e)", () => {
  const f = { mode: 0xab, armed: 0x01 }; // bit0 set, latch armed -> loc_4006 dec then ret
  const before = craft(f);
  const after = craft(f);
  const b = before.dumpState();
  dispatchActorState1MovementByMode(after);
  const a = after.dumpState();

  const changed = [];
  for (let off = 0; off < b.length; off++) {
    const ad = after.stateOffsetToAddr(off);
    if (b[off] !== a[off] && !inDeadStack(ad)) changed.push(ad);
  }
  assert.equal(changed.length, 1, `expected exactly 1 write, got ${changed.length} (${changed.map(hx).join(",")})`);
  assert.equal(changed[0], REC + OFF_HOLD, `the one write must be the frame-hold, got ${hx(changed[0])}`);
  assert.equal(after.mem8[REC + OFF_HOLD], 0x04, "frame-hold 0x05 -> 0x04");
  console.log(`  WRITE-SET: ${hx(REC + OFF_HOLD)} := 0x04 (1 cell)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong frame-hold byte is CAUGHT by the RAM diff", () => {
  const f = { mode: 0xab, armed: 0x01 };
  const o = craft(f);
  const c = craft(f);
  oracle(o);
  dispatchActorState1MovementByMode(c);
  c.mem8[REC + OFF_HOLD] = 0x05; // BUG: loc_4006 must have decremented it
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong frame-hold byte — it is worthless");
  assert.equal(d.addr, REC + OFF_HOLD, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong frame-hold byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced sub-position (advanceActorColumnAndArmTurnOrBand delegate) is CAUGHT by the RAM diff", () => {
  const f = { mode: 0xaa, state: 0x00, subpos: 0x10, aim: 0x05, col: 0x01, limit: 0x05 };
  const o = craft(f);
  const c = craft(f);
  oracle(o);
  dispatchActorState1MovementByMode(c);
  c.mem8[REC + OFF_SUBPOS] = 0x10; // BUG: advanceActorColumnAndArmTurnOrBand advances it 0x10 + 0x05 -> 0x15
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sub-position — it is worthless");
  assert.equal(d.addr, REC + OFF_SUBPOS, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  assert.equal(o.mem8[REC + OFF_SUBPOS], 0x15, "oracle advanced the sub-position 0x10 -> 0x15");
  console.log(`  TEETH/RAM: wrong sub-position caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: dropping the 0x3426 return-slot push is SP-neutral (seam-placeable); a leak is NOT", () => {
  const CALLER_RET = 0xfffc;
  const entry = () => {
    const m = craft({ mode: 0xaa, state: 0x05, col: 0x10, limit: 0x05, step: 0x00, subpos: 0x00 }); // advanceObjectColumnByStepAndDispatch tail
    m.regs.sp = 0x8ff0;
    m.mem.write16(0x8ff0, CALLER_RET);
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, dispatchActorState1MovementByMode, 0x3423, entry());
  assert.equal(ok.placeable, true, `the tail dispatch must be seam-placeable; got: ${ok.error}`);

  const leaky = (mm, rec) => { mm.push16(0x0000); return dispatchActorState1MovementByMode(mm, rec); };
  const bad = seamPlaceable(withOmittedRet, leaky, 0x3423, entry());
  assert.equal(bad.placeable, false, "SP-tooth null-mutant: a leaked stack word MUST NOT be placeable");
  console.log("  SP-TOOTH: dispatchActorState1MovementByMode seam-placeable (moved 0, dropped push); leaked-push mutant caught");
});
