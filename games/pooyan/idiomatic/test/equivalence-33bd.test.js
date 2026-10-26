// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEnemyState0AndArmFlapReset (ROM 0x33bd, Pooyan) — enemy-actor state-0 handler. Counts the
 * state timer (rec+0x11) down; on expiry advances the frame (rec+0x02) and branches on bit0 of the
 * flap byte (rec+0x0b): clear -> fall into the shared turn-select tail (seatTurnAnimationFromColumnLimit); set -> the
 * flap-reset arm (bump EAGLE_TARGET_COLUMN_BIAS, re-latch STAGE_COUNTDOWN=6, clear SPAWN_ACTIVE_FLAG
 * and the flap byte, re-run seatTurnAnimationFromColumnLimit, then install the 0x3847/0x3856 flap table by bit0 of rec+0x08).
 *
 * Cycle-free / memory-equivalence gate: a fresh clone per side, oracle on one and advanceEnemyState0AndArmFlapReset on the
 * other, compared on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared, and there
 * is NO register live-out (the record-dispatch caller reloads A and reads no other register back).
 * The oracle's seatTurnAnimationFromColumnLimit call (frozen return-slot push at 0x340a), rst-0x20 lookup, and any armInteriorBandOrMarkActorActive
 * tail all land inside STACK_SCRATCH; the idiomatic layer drops that push, so the SP-tooth is what
 * proves the drop is SP-neutral.
 *
 * The 0x3418 table's phase-0 entry is read from ROM so the crafted targets steer seatTurnAnimationFromColumnLimit's arm
 * deterministically. The leaf is not reached in a plain boot, so every case is CRAFTED (identical
 * pokes on both sides), the record pre-dirtied to 0xAA.
 *
 * Jobs:
 *   1. EQUAL — timer-running (ret nz), the non-flap fall-through (both a straight arm and the
 *      armInteriorBandOrMarkActorActive defer), and BOTH flap-reset arms (bit0 of rec+0x08 clear->0x3847, set->0x3856).
 *   2. WRITE-SET — the non-flap straight arm advances the timer + frame and lands seatTurnAnimationFromColumnLimit's writes.
 *   3. TEETH — a wrong STAGE_COUNTDOWN on the flap arm and a wrong frame byte are each CAUGHT.
 *   4. SP-TOOTH — dropping the 0x340a return-slot push is SP-neutral (seam-placeable); a leak is NOT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-33bd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_33bd as oracle } from "../../translated/loc_33bd.js";
import { advanceEnemyState0AndArmFlapReset } from "../advanceEnemyState0AndArmFlapReset.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ANIM_TABLE_3418,
  TURN_COLUMN_LIMIT,
  SPAWN_PHASE_SNAPSHOT,
  ANIM_ARMED_LATCH,
  EAGLE_TARGET_COLUMN_BIAS,
  STAGE_COUNTDOWN,
  SPAWN_ACTIVE_FLAG,
  ANIM_TABLE_3829,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b60; //          work-RAM record base (IX); disjoint from every shared cell touched
const REC_LEN = 0x18;
const OFF_FRAME = 0x02;
const OFF_TARGET = 0x06;
const OFF_SPRITE = 0x08;
const OFF_FLAP = 0x0b;
const OFF_TIMER = 0x11;
const OFF_ANIM = 0x0c;
const DIRT = 0xaa;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0); // the RAM diffs all enter at the craft seat
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const LIMIT0 = ROM_PRESENT ? BASE.mem.read8(ANIM_TABLE_3418) : 0; // phase-0 rst-0x20 limit

/** A fresh clone: record pre-dirtied, timer/flap/target + shared cells seated, IX=REC, SP in dead stack. */
function craft(f) {
  const m = BASE.clone();
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, DIRT);
  m.mem.write8(REC + OFF_TIMER, f.timer);
  m.mem.write8(REC + OFF_FLAP, f.flap ?? 0x00);
  m.mem.write8(REC + OFF_TARGET, f.target ?? DIRT);
  m.mem.write8(REC + 0x05, f.subpos ?? DIRT);
  m.mem.write8(REC + 0x09, f.aim ?? DIRT);
  m.mem.write8(SPAWN_PHASE_SNAPSHOT, f.phase ?? 0x00);
  m.mem.write8(TURN_COLUMN_LIMIT, DIRT);
  m.mem.write8(ANIM_ARMED_LATCH, f.armed ?? 0x00);
  m.mem.write8(EAGLE_TARGET_COLUMN_BIAS, 0x10); // observable inc on the flap arm
  m.mem.write8(STAGE_COUNTDOWN, DIRT);
  m.mem.write8(SPAWN_ACTIVE_FLAG, DIRT);
  m.regs.ix = REC;
  m.regs.sp = 0x8fe0; // deep in STACK_SCRATCH: the nested call/push/ret stay inside
  return m;
}

const CASES = [
  { name: "timer running -> ret nz", f: { timer: 0x05 } },
  { name: "non-flap fall-through, limit>target (0x3829)", f: { timer: 0x01, flap: 0x00, target: LIMIT0 - 1 } },
  { name: "non-flap fall-through, equal -> defer armInteriorBandOrMarkActorActive", f: { timer: 0x01, flap: 0x00, target: LIMIT0, aim: 0x20, subpos: 0x10, armed: 0x01 } },
  { name: "flap-reset arm, rec+0x08 bit0 clear -> 0x3847", f: { timer: 0x01, flap: 0x01, target: LIMIT0 - 1 } },
  { name: "flap-reset arm, rec+0x08 bit0 set -> 0x3856", f: { timer: 0x01, flap: 0x01, target: LIMIT0 + 1 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: timer / non-flap / both flap-reset arms — advanceEnemyState0AndArmFlapReset == oracle in RAM (−stack)", () => {
  for (const cse of CASES) {
    const o = craft(cse.f);
    oracle(o);
    const c = craft(cse.f);
    advanceEnemyState0AndArmFlapReset(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack); LIMIT0=${hx(LIMIT0)}`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the non-flap straight arm ticks timer+frame and lands seatTurnAnimationFromColumnLimit's writes", () => {
  const c = craft({ timer: 0x01, flap: 0x00, target: LIMIT0 - 1 });
  advanceEnemyState0AndArmFlapReset(c);
  assert.equal(c.mem8[REC + OFF_TIMER], 0x00, "timer 0x01 -> 0x00");
  assert.equal(c.mem8[REC + OFF_FRAME], (DIRT + 1) & 0xff, "frame advanced 0xaa -> 0xab");
  assert.equal(c.mem8[TURN_COLUMN_LIMIT], LIMIT0, "seatTurnAnimationFromColumnLimit latched the limit");
  assert.equal(c.mem8[REC + OFF_SPRITE], 0x00, "seatTurnAnimationFromColumnLimit seated frame 0 (limit > target)");
  assert.equal(c.mem8[REC + OFF_ANIM], ANIM_TABLE_3829 & 0xff, "anim pointer low = 0x3829");
  assert.equal(c.mem8[REC + OFF_ANIM + 1], (ANIM_TABLE_3829 >> 8) & 0xff, "anim pointer high = 0x3829");
  assert.equal(c.mem8[REC + OFF_ANIM + 2], 0x00, "anim frame index reset to 0");
  console.log(`  WRITE-SET: timer->0, frame->0xab, limit=${hx(LIMIT0)}, anim->${hx(ANIM_TABLE_3829)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong STAGE_COUNTDOWN on the flap-reset arm is CAUGHT by the RAM diff", () => {
  const f = { timer: 0x01, flap: 0x01, target: LIMIT0 - 1 };
  const o = craft(f);
  const c = craft(f);
  oracle(o);
  advanceEnemyState0AndArmFlapReset(c);
  c.mem8[STAGE_COUNTDOWN] = 0x05; // BUG: the flap-reset arm re-latches it to 6
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong STAGE_COUNTDOWN — it is worthless");
  assert.equal(d.addr, STAGE_COUNTDOWN, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong STAGE_COUNTDOWN caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced frame byte is CAUGHT by the RAM diff", () => {
  const f = { timer: 0x01, flap: 0x00, target: LIMIT0 - 1 };
  const o = craft(f);
  const c = craft(f);
  oracle(o);
  advanceEnemyState0AndArmFlapReset(c);
  c.mem8[REC + OFF_FRAME] = DIRT; // BUG: the frame must have been advanced
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong frame byte — it is worthless");
  assert.equal(d.addr, REC + OFF_FRAME, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong frame byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: dropping the 0x340a return-slot push is SP-neutral (seam-placeable); a leak is NOT", () => {
  const CALLER_RET = 0xfffc;
  const entry = () => {
    const m = craft({ timer: 0x01, flap: 0x01, target: LIMIT0 - 1 }); // flap arm: exercises the dropped push
    m.regs.sp = 0x8ff0;
    m.mem.write16(0x8ff0, CALLER_RET);
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, advanceEnemyState0AndArmFlapReset, 0x33bd, entry());
  assert.equal(ok.placeable, true, `the flap-reset arm must be seam-placeable; got: ${ok.error}`);

  const leaky = (mm, rec) => { mm.push16(0x0000); return advanceEnemyState0AndArmFlapReset(mm, rec); };
  const bad = seamPlaceable(withOmittedRet, leaky, 0x33bd, entry());
  assert.equal(bad.placeable, false, "SP-tooth null-mutant: a leaked stack word MUST NOT be placeable");
  console.log("  SP-TOOTH: advanceEnemyState0AndArmFlapReset seam-placeable (moved 0, dropped push); leaked-push mutant caught");
});
