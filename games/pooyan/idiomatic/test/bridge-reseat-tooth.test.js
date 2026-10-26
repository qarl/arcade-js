// SPDX-License-Identifier: GPL-3.0-only
/**
 * REGISTER-BRIDGE RE-SEAT TOOTH — self-proving test for core `bridgeReseatEquivalent` (reviewer-rules R37).
 *
 * The register-bridge live-out class is invisible to memory-eq: a rewrite that forwards a bridge value as
 * a param while a deeper callee reads it from `= m.regs.X` passes eq-green (the eq craft seats the register
 * == the param) yet writes to a STALE register in the live game (b0602b4f: loc_5733 -> decrementPhaseCounterAndDispatchSpawnOrStep -> advanceEagleStageTimersAndLatchMoveElseRearm,
 * which reads m.regs.ix and writes rec+0x16). The tooth poisons the bridge register and hands the intended
 * value in as a param: a re-seat recovers, a missing re-seat leaks the poison into the deep write.
 *
 * This NULL-MUTANTS the tooth (a check that cannot fail proves nothing) and proves it DISCRIMINATES — the
 * static "delegates without re-seat" filter flags 184/269 bridge routines (noise); the dynamic tooth must
 * clear the safe ones:
 *   A. correct loc_5733 (re-seats m.regs.ix before delegating) is bridge-equivalent (no false positive);
 *   B. the SAME routine with the re-seat DROPPED (the b0602b4f defect) is NOT bridge-equivalent (the teeth);
 *   C. advanceEnemyAnimationPhase (threads the record as a param to every delegate, never re-seats) is
 *      bridge-equivalent — a routine the static filter WRONGLY flags, the dynamic tooth correctly clears.
 *
 * Run: node --test games/pooyan/idiomatic/test/bridge-reseat-tooth.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5733 } from "../loc_5733.js";
import { loc_5733 as oracle5733 } from "../../translated/loc_5733.js";
import { advanceEnemyAnimationPhase } from "../advanceEnemyAnimationPhase.js";
import { loc_3d5c as oracle3d5c } from "../../translated/loc_3d5c.js";
import { Machine } from "../../machine.js";
import { bridgeReseatEquivalent } from "../../../../core/bridge-reseat.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { adjustSpawnColumn } from "../adjustSpawnColumn.js";
import { fetchByteFromTableIndex } from "../fetchByteFromTableIndex.js";
import { setActorAnimation } from "../setActorAnimation.js";
import { decrementPhaseCounterAndDispatchSpawnOrStep } from "../decrementPhaseCounterAndDispatchSpawnOrStep.js";
import {
  STACK_SCRATCH,
  ROUND_COUNTER,
  DIFFICULTY_DSW,
  GAUGE_PHASE_COUNTER,
  SPAWN_COLUMN_BIAS,
  SPAWN_FIELD_TABLE,
  SPAWN_FIELD_TABLE_ODD,
  ENEMY_SPAWN_TIMER,
  SPAWN_TIMER_TABLE_ODD,
  SPAWN_TIMER_TABLE_EVEN,
  ACTIVE_ENEMY_COUNT,
  ANIM_TABLE_3829,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REAL_IX = 0x8ae0; //   the actual actor slot the caller means (its record)
const POISON_IX = 0x8b40; //  a distinct valid work-RAM slot; a missing re-seat writes rec+0x13/0x16 here
const SEED = 0xff; //         entry column seed -> keeps the sub-state stepper off the spawn path
const E = 0x40; //            a field byte
const SP0 = 0x8ff0; //        inside STACK_SCRATCH (the oracle's push/pop/ret land in dead stack)
const REC_3D5C = 0x8a80; //   advanceEnemyAnimationPhase record base (from equivalence-3d5c)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** The b0602b4f mutant: loc_5733 verbatim MINUS its `m.regs.ix = ix` re-seat (idiomatic/loc_5733.js:77). */
const CLAMP_DIFFICULTY = 0x03;
const GAUGE_BIAS_THRESHOLD = 0x04;
const COLUMN_MAX = 0x20;
function loc_5733_missingReseat(m, c = m.regs.c, ix = m.regs.ix, e = m.regs.e) {
  const { mem8 } = m;
  const stateSeed = c;
  mem8[ix + 0x00] = 0x01;
  mem8[ix + 0x02] = 0x03;
  mem8[ix + 0x04] = e;
  mem8[ix + 0x03] = 0x00;
  mem8[ix + 0x05] = 0x00;
  mem8[ix + 0x06] = 0x00;
  mem8[ix + 0x08] = 0x00;
  mem8[ix + 0x07] = 0x01;
  mem8[ix + 0x0b] = 0x00;
  const odd = mem8[ROUND_COUNTER] & 0x01;
  let col = mem8[DIFFICULTY_DSW];
  if (col >= CLAMP_DIFFICULTY) col = CLAMP_DIFFICULTY;
  if (mem8[GAUGE_PHASE_COUNTER] >= GAUGE_BIAS_THRESHOLD) col = (col + mem8[SPAWN_COLUMN_BIAS]) & 0xff;
  if (odd === 0) col = adjustSpawnColumn(m, col);
  col = (mem8[ROUND_COUNTER] + col) & 0xff;
  if (col >= COLUMN_MAX) col = COLUMN_MAX - 1;
  const fieldTable = odd ? SPAWN_FIELD_TABLE_ODD : SPAWN_FIELD_TABLE;
  const [motion] = fetchByteFromTableIndex(m, fieldTable, col);
  mem8[ix + 0x09] = motion;
  mem8[ix + 0x0a] = -motion;
  setActorAnimation(m, ix, ANIM_TABLE_3829);
  const timerTable = odd ? SPAWN_TIMER_TABLE_ODD : SPAWN_TIMER_TABLE_EVEN;
  const [timer] = fetchByteFromTableIndex(m, timerTable, col);
  mem8[ENEMY_SPAWN_TIMER] = timer;
  mem8[ACTIVE_ENEMY_COUNT] = mem8[ACTIVE_ENEMY_COUNT] + 1;
  // BUG (b0602b4f): the `m.regs.ix = ix` re-seat is gone -> advanceEagleStageTimersAndLatchMoveElseRearm down the chain reads a stale m.regs.ix.
  decrementPhaseCounterAndDispatchSpawnOrStep(m, stateSeed);
}

/** Entry clone for the loc_5733 spawn: c/e seated for the oracle, the sub-state stepper on its plain arm. */
function craft5733() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.c = SEED;
  m.regs.e = E;
  m.mem8[ROUND_COUNTER] = 0x02; //         even round, low difficulty, no gauge bias
  m.mem8[DIFFICULTY_DSW] = 0x01;
  m.mem8[GAUGE_PHASE_COUNTER] = 0x00;
  m.mem8[SPAWN_COLUMN_BIAS] = 0x00;
  m.mem8[0x8d46] = 0x03; //                sub-state counter 1..6 -> plain stepper arm (advanceEagleStageTimersAndLatchMoveElseRearm stage 1)
  m.mem8[0x8d47] = 0x02; //                first stage timer nonzero -> writes rec+0x13 / rec+0x16
  return m;
}

/** Entry clone for advanceEnemyAnimationPhase: an expiring frame timer on the ordinary-phase path. */
function craft3d5c() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[REC_3D5C + 0x11] = 0x01; //  frame timer -> expires this tick
  m.mem8[REC_3D5C + 0x16] = 0x02; //  animation phase (ordinary: not turn/swap)
  m.mem8[REC_3D5C + 0x0e] = 0x05; //  advanceObjectAnimationFrame frame-hold nonzero -> simple decrement, no ROM walk
  m.mem8[REC_3D5C + 0x07] = 0x01;
  m.mem8[REC_3D5C + 0x02] = 0x03; //  starting state
  return m;
}

// -- A. no false positive on the correct re-seating routine --------------------
test("PLACEABLE: correct loc_5733 (re-seats m.regs.ix) is bridge-equivalent under a poisoned register", () => {
  const r = bridgeReseatEquivalent(craft5733(), oracle5733, loc_5733, {
    live: { ix: REAL_IX }, poison: { ix: POISON_IX }, args: [SEED, REAL_IX, E], excludeAddr: inDeadStack,
  });
  assert.equal(r.equal, true, r.ram && `correct loc_5733 flagged; RAM diff at ${hx(r.ram.addr ?? 0)}`);
  console.log("  PLACEABLE: correct loc_5733 re-seats -> the poison never reaches advanceEagleStageTimersAndLatchMoveElseRearm");
});

// -- B. THE TEETH: the b0602b4f mutant (missing re-seat) diverges ---------------
test("TEETH: loc_5733 with the re-seat DROPPED is NOT bridge-equivalent (the class memory-eq is blind to)", () => {
  const r = bridgeReseatEquivalent(craft5733(), oracle5733, loc_5733_missingReseat, {
    live: { ix: REAL_IX }, poison: { ix: POISON_IX }, args: [SEED, REAL_IX, E], excludeAddr: inDeadStack,
  });
  assert.equal(r.equal, false,
    "the tooth FAILED to catch a missing re-seat — it is worthless (memory-eq passes this mutant green)");
  console.log(`  TEETH: missing-re-seat mutant caught — RAM diff at ${hx(r.ram.addr ?? 0)} (stale-ix write)`);
});

// -- C. no false positive on a param-threading routine the static filter flags --
test("PLACEABLE: advanceEnemyAnimationPhase (threads the record as a param) is bridge-equivalent", () => {
  const r = bridgeReseatEquivalent(craft3d5c(), oracle3d5c, advanceEnemyAnimationPhase, {
    live: { ix: REC_3D5C }, poison: { ix: POISON_IX }, args: [REC_3D5C], excludeAddr: inDeadStack,
  });
  assert.equal(r.equal, true, r.ram && `param-threading routine flagged; RAM diff at ${hx(r.ram.addr ?? 0)}`);
  console.log("  PLACEABLE: advanceEnemyAnimationPhase threads the param -> no false positive");
});

// -- the no-teeth guard: poison must differ from the live value ----------------
test("GUARD: a poison equal to the live value is refused (that equality is the masking that hid the class)", () => {
  assert.throws(
    () => bridgeReseatEquivalent(craft5733(), oracle5733, loc_5733, {
      live: { ix: REAL_IX }, poison: { ix: REAL_IX }, args: [SEED, REAL_IX, E], excludeAddr: inDeadStack,
    }),
    /no teeth/,
    "the tooth must refuse a poison == live (it would silently have no teeth)",
  );
  console.log("  GUARD: poison == live refused");
});
