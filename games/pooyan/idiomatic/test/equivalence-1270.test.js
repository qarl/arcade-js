// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEnemyCountdownThenRetireAndTickStage (Pooyan) — per-object fine/coarse position countdown + retire.
 *
 * Steps the object animation, then adds the signed step (+0x0a) to the fine position (+0x05),
 * borrowing from the coarse counter (+0x06) when the fine value underflows. While the coarse counter
 * is non-zero it returns. On coarse rollover it blanks the sprite band and runs the retire counters:
 * dec ACTIVE_ENEMY_COUNT; dec STAGE_COUNTDOWN when non-zero; in PLAY_STATE_INDEX 4 bump
 * SPAWN_PHASE_COUNTER; and when the pre-decrement countdown minus one is below 0x0a, mirror it into
 * HUD_STAGE_DIGIT_LO.
 *
 * The record base is a register-bridge input (IX); both sides seat IX to the same RAM record. The
 * animation field +0x0e is pre-loaded non-zero so the animation step is a deterministic decrement
 * (no stream reads). Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH
 * so the oracle's call/ret drops fall out of the diff.
 *
 * Jobs: 1. EQUAL across borrow / no-borrow / retire (state!=4) / retire (state==4) / digit-capped /
 * countdown-zero branches; 2. WRITE-SET (fine, coarse, retire counters, HUD digit); 3. TEETH (a
 * corrupted fine byte is caught; the early-return and retire branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1270.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1270 as oracle } from "../../translated/loc_1270.js";
import { advanceEnemyCountdownThenRetireAndTickStage } from "../advanceEnemyCountdownThenRetireAndTickStage.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ENEMY_ACTOR_TABLE,
  ACTIVE_ENEMY_COUNT,
  STAGE_COUNTDOWN,
  SPAWN_PHASE_COUNTER,
  PLAY_STATE_INDEX,
  HUD_STAGE_DIGIT_LO,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ENEMY_ACTOR_TABLE; // 0x8ae0 — a record clear of the retire cells and the stack
const FINE = REC + 0x05;
const COARSE = REC + 0x06;
const STEP = REC + 0x0a;
const ANIM_HOLD = REC + 0x0e;
const SP0 = 0x8fe0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record fields and the retire cells; IX points at the record. */
function seat({ step = 0x02, fine = 0x10, coarse = 0x03, countdown = 0x05, playState = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem.write8(STEP, step);
  m.mem.write8(FINE, fine);
  m.mem.write8(COARSE, coarse);
  m.mem.write8(ANIM_HOLD, 0x05); // non-zero -> animation step is a plain decrement
  m.mem.write8(ACTIVE_ENEMY_COUNT, 0x08);
  m.mem.write8(STAGE_COUNTDOWN, countdown);
  m.mem.write8(SPAWN_PHASE_COUNTER, 0x00);
  m.mem.write8(PLAY_STATE_INDEX, playState);
  m.mem.write8(HUD_STAGE_DIGIT_LO, 0x77); // pre-dirty so a HUD store is visible
  return m;
}

const CASES = [
  { name: "borrow -> early return", cfg: { step: 0x02, fine: 0x10, coarse: 0x03 } },
  { name: "no borrow -> early return", cfg: { step: 0x02, fine: 0xff, coarse: 0x03 } },
  { name: "retire, state!=4, digit<0x0a", cfg: { step: 0x02, fine: 0x10, coarse: 0x01, countdown: 0x05, playState: 0x00 } },
  { name: "retire, state==4 -> bump spawn phase", cfg: { step: 0x02, fine: 0x10, coarse: 0x01, countdown: 0x03, playState: 0x04 } },
  { name: "retire, countdown-1 >= 0x0a -> no HUD store", cfg: { step: 0x02, fine: 0x10, coarse: 0x01, countdown: 0x20 } },
  { name: "retire, countdown == 0 -> no dec, no HUD store", cfg: { step: 0x02, fine: 0x10, coarse: 0x01, countdown: 0x00 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceEnemyCountdownThenRetireAndTickStage == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    advanceEnemyCountdownThenRetireAndTickStage(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: fine advances + borrow; retire runs the counters", () => {
  // borrow branch: coarse decrements, fine = fine + step, no retire
  const bor = seat({ step: 0x02, fine: 0x10, coarse: 0x03 });
  oracle(bor);
  assert.equal(bor.mem.read8(COARSE), 0x02, "borrow decrements the coarse counter");
  assert.equal(bor.mem.read8(FINE), 0x12, "fine advances by the step");
  assert.equal(bor.mem.read8(ACTIVE_ENEMY_COUNT), 0x08, "no retire while coarse is non-zero");

  // retire, state != 4, digit < 0x0a
  const ret = seat({ step: 0x02, fine: 0x10, coarse: 0x01, countdown: 0x05, playState: 0x00 });
  oracle(ret);
  assert.equal(ret.mem.read8(COARSE), 0x00, "coarse rolled to zero");
  assert.equal(ret.mem.read8(ACTIVE_ENEMY_COUNT), 0x07, "active-enemy count decremented");
  assert.equal(ret.mem.read8(STAGE_COUNTDOWN), 0x04, "stage countdown decremented");
  assert.equal(ret.mem.read8(SPAWN_PHASE_COUNTER), 0x00, "spawn phase untouched outside state 4");
  assert.equal(ret.mem.read8(HUD_STAGE_DIGIT_LO), 0x04, "HUD digit = countdown - 1");

  // retire, state == 4 -> spawn phase bumps
  const s4 = seat({ step: 0x02, fine: 0x10, coarse: 0x01, countdown: 0x03, playState: 0x04 });
  oracle(s4);
  assert.equal(s4.mem.read8(SPAWN_PHASE_COUNTER), 0x01, "state 4 bumps the spawn-phase counter");

  // retire, countdown - 1 >= 0x0a -> HUD not stored
  const cap = seat({ step: 0x02, fine: 0x10, coarse: 0x01, countdown: 0x20 });
  oracle(cap);
  assert.equal(cap.mem.read8(HUD_STAGE_DIGIT_LO), 0x77, "capped countdown leaves the HUD digit alone");

  // retire, countdown == 0 -> no dec, no store
  const zero = seat({ step: 0x02, fine: 0x10, coarse: 0x01, countdown: 0x00 });
  oracle(zero);
  assert.equal(zero.mem.read8(STAGE_COUNTDOWN), 0x00, "zero countdown is not decremented");
  assert.equal(zero.mem.read8(HUD_STAGE_DIGIT_LO), 0x77, "zero countdown leaves the HUD digit alone");
  console.log("  WRITE-SET: fine/coarse advance; ACTIVE_ENEMY_COUNT/STAGE_COUNTDOWN/SPAWN_PHASE/HUD");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted fine byte is CAUGHT; branches are load-bearing", () => {
  const o = seat({ step: 0x02, fine: 0x10, coarse: 0x03 });
  const c = seat({ step: 0x02, fine: 0x10, coarse: 0x03 });
  oracle(o);
  advanceEnemyCountdownThenRetireAndTickStage(c);
  c.mem.write8(FINE, (o.mem.read8(FINE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted fine byte");
  assert.equal(d.addr, FINE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // early-return and retire branches must differ, or the coarse guard is dead
  const early = seat({ step: 0x02, fine: 0x10, coarse: 0x03 });
  const retire = seat({ step: 0x02, fine: 0x10, coarse: 0x01 });
  oracle(early);
  oracle(retire);
  assert.notEqual(ramDiffMinusStack(early, retire), null, "early-return and retire branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; coarse guard load-bearing`);
});
