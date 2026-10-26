// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drivePhase1RecordsThenCheckCompletion (ROM 0x6edb, Pooyan) — the phase-1 per-record driver and
 * completion check. It runs the per-record state handler over the 14 enemy-actor records (0x8ae0,
 * stride 0x18); then, only if the launch script has reached its 0xff terminator AND all three
 * projectile slots are idle, it advances the intro phase, queues a display command, compares 3x the
 * target-group count to the hit tally — on a match forcing intro phase 4 and swapping the queued
 * command — reprimes the intro delay, queues that command, and clears the 0x30-byte target block.
 *
 * NOTE: the three "projectile slots" scanned (0x8bea / 0x8c02 / 0x8c1a) are the state bytes (+0x02)
 * of records 11/12/13 — the slot scan overlaps the actor arena. So for completion those records must
 * hold state 0 (idle); the loop then runs advanceObjectAnimationFrame on them, which just decrements the frame-hold
 * (+0x0e) when it is nonzero. Records 0-10 hold state 0x0d, a dispatchEnemyActorRecordState no-op.
 *
 * Comparison is the go-forward contract: RAM (dumpState) minus stack scratch below the entry SP. The caller (runPhase1LauncherThenDriver)
 * returns straight after and reads no register back, so live-out is memory only (the closing fill
 * leaves A/HL/B, but nothing consumes them). The leaf is not reached in a plain boot, so every case
 * is CRAFTED.
 *
 * Jobs:
 *   1. EQUAL — script-not-finished return, slot-busy return, completion(mismatch), completion(match).
 *   2. WRITE-SET — the completion footprint: phase advanced, intro delay 0x40, target block zeroed,
 *      the two display commands queued into a freed ring.
 *   3. TEETH — a twin that skips the phase advance, and a corrupted target-clear cell.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6edb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6edb as oracle } from "../../translated/loc_6edb.js";
import { drivePhase1RecordsThenCheckCompletion } from "../drivePhase1RecordsThenCheckCompletion.js";
import { dispatchEnemyActorRecordState } from "../dispatchEnemyActorRecordState.js";
import { enqueueDisplayCommand } from "../enqueueDisplayCommand.js";
import { fillByteRun } from "../fillByteRun.js";
import { u16 } from "../../../../core/int.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ENEMY_ACTOR_TABLE,
  LAUNCH_SCRIPT_PTR,
  INTRO_PHASE_INDEX,
  HIT_TALLY,
  TARGET_GROUP_COUNT,
  INTRO_DELAY_CKSUM_WORD,
  ENEMY_TARGET_REC0,
  DISPLAY_CMD_RING_WRITE_PTR,
  PROJECTILE_SLOT_STATE,
  PHASE1_COMPLETE_DISPLAY_CMD,
  TARGET_MISMATCH_DISPLAY_CMD,
  TARGET_MATCH_DISPLAY_CMD,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const STRIDE = 0x18;
const NOOP_STATE = 0x00; // a registered dispatchEnemyActorRecordState path (state 0 -> advanceObjectAnimationFrame, which just decrements a set frame-hold)
const SCRIPT_PTR_TARGET = 0x8d00; // where LAUNCH_SCRIPT_PTR is aimed (clear of every write)

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const rec = (n) => (ENEMY_ACTOR_TABLE + n * STRIDE) & 0xffff;

/**
 * Craft a phase-1 machine.
 *  scriptTerm  — launch-script byte is 0xff (finished) vs 0x00.
 *  slotsIdle   — records 11-13 hold state 0 (idle, +0x0e frame-hold set) vs 0x0d (busy).
 *  targetGroup / hit — seed TARGET_GROUP_COUNT and HIT_TALLY for the 3x compare.
 *  dirtyTarget — pre-dirty the 0x8c90 target block so the closing fill is observable.
 *  freeRing    — free ring slots so the queued display commands are observable.
 */
function craft({ scriptTerm, slotsIdle, targetGroup = 0, hit = 0, dirtyTarget = false, freeRing = false }) {
  const m = new Machine(ROM);
  for (let n = 0; n <= 10; n++) {
    m.mem.write8((rec(n) + 0x02) & 0xffff, NOOP_STATE);
    m.mem.write8((rec(n) + 0x0e) & 0xffff, 0x40); // frame-hold: advanceObjectAnimationFrame decrements and returns
  }
  for (let n = 11; n <= 13; n++) {
    if (slotsIdle) {
      m.mem.write8((rec(n) + 0x02) & 0xffff, 0x00);  // idle slot
      m.mem.write8((rec(n) + 0x0e) & 0xffff, 0x40);  // frame-hold: advanceObjectAnimationFrame decrements and returns
    } else {
      m.mem.write8((rec(n) + 0x02) & 0xffff, 0x03);  // busy slot (nonzero, state < 0x0b -> registered path)
      m.mem.write8((rec(n) + 0x0e) & 0xffff, 0x40);  // frame-hold: advanceObjectAnimationFrame decrements and returns
    }
  }
  // launch script pointer -> a controlled byte
  m.mem.write8(LAUNCH_SCRIPT_PTR, SCRIPT_PTR_TARGET & 0xff);
  m.mem.write8((LAUNCH_SCRIPT_PTR + 1) & 0xffff, SCRIPT_PTR_TARGET >> 8);
  m.mem.write8(SCRIPT_PTR_TARGET, scriptTerm ? 0xff : 0x00);
  m.mem.write8(TARGET_GROUP_COUNT, targetGroup);
  m.mem.write8(HIT_TALLY, hit);
  if (dirtyTarget) for (let i = 0; i < 0x30; i++) m.mem.write8((ENEMY_TARGET_REC0 + i) & 0xffff, 0xaa);
  if (freeRing) {
    m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, 0xc0);
    for (let i = 0; i < 8; i++) m.mem.write8((0x8800 + 0xc0 + i) & 0xffff, 0xff); // free ring slots
  }
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: script not finished -> early return, RAM identical", () => {
  const o = craft({ scriptTerm: false, slotsIdle: false });
  const c = craft({ scriptTerm: false, slotsIdle: false });
  oracle(o);
  drivePhase1RecordsThenCheckCompletion(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL(script-unfinished): early return, RAM identical");
});

test("EQUAL: slot busy -> early return, RAM identical", () => {
  const o = craft({ scriptTerm: true, slotsIdle: false });
  const c = craft({ scriptTerm: true, slotsIdle: false });
  oracle(o);
  drivePhase1RecordsThenCheckCompletion(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL(slot-busy): early return, RAM identical");
});

test("EQUAL: completion, target/tally MISMATCH -> phase advanced (not forced)", () => {
  const o = craft({ scriptTerm: true, slotsIdle: true, targetGroup: 2, hit: 0, freeRing: true });
  const c = craft({ scriptTerm: true, slotsIdle: true, targetGroup: 2, hit: 0, freeRing: true });
  oracle(o);
  drivePhase1RecordsThenCheckCompletion(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(o.mem.read8(INTRO_PHASE_INDEX), 0x01, "mismatch advances phase 0->1 (not forced to 4)");
  console.log("  EQUAL(completion-mismatch): RAM identical, phase 0->1");
});

test("EQUAL: completion, target/tally MATCH -> phase forced to 4", () => {
  const o = craft({ scriptTerm: true, slotsIdle: true, targetGroup: 2, hit: 6, freeRing: true });
  const c = craft({ scriptTerm: true, slotsIdle: true, targetGroup: 2, hit: 6, freeRing: true });
  oracle(o);
  drivePhase1RecordsThenCheckCompletion(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(o.mem.read8(INTRO_PHASE_INDEX), 0x04, "match forces phase to 4");
  console.log("  EQUAL(completion-match): RAM identical, phase forced to 4");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: completion footprint (phase, intro delay, target block, queued commands)", () => {
  const after = craft({ scriptTerm: true, slotsIdle: true, targetGroup: 2, hit: 0, dirtyTarget: true, freeRing: true });
  oracle(after);

  assert.equal(after.mem.read8(INTRO_PHASE_INDEX), 0x01, "phase advanced 0->1");
  assert.equal(after.mem.read8(INTRO_DELAY_CKSUM_WORD), 0x40, "intro delay reprimed to 0x40");
  for (let i = 0; i < 0x30; i++) {
    assert.equal(after.mem.read8((ENEMY_TARGET_REC0 + i) & 0xffff), 0x00, `target block cell ${hx(ENEMY_TARGET_REC0 + i)} cleared`);
  }
  // first command 0x0635, then the mismatch command 0x0608, queued two-bytes each into the ring
  assert.equal(after.mem.read8(0x88c0), PHASE1_COMPLETE_DISPLAY_CMD >> 8, "cmd0 hi");
  assert.equal(after.mem.read8(0x88c1), PHASE1_COMPLETE_DISPLAY_CMD & 0xff, "cmd0 lo");
  assert.equal(after.mem.read8(0x88c2), TARGET_MISMATCH_DISPLAY_CMD >> 8, "cmd1 hi");
  assert.equal(after.mem.read8(0x88c3), TARGET_MISMATCH_DISPLAY_CMD & 0xff, "cmd1 lo (mismatch)");
  console.log("  WRITE-SET: phase/intro-delay/target-block/commands as expected");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: reaches completion but skips advancing the intro phase. */
function brokenNoPhaseAdvance(m) {
  const { mem8 } = m;
  let r = ENEMY_ACTOR_TABLE;
  for (let i = 0; i < 14; i++) { dispatchEnemyActorRecordState(m, r); r = u16(r + STRIDE); }
  const script = mem8[LAUNCH_SCRIPT_PTR] | (mem8[u16(LAUNCH_SCRIPT_PTR + 1)] << 8);
  if (mem8[script] !== 0xff) return;
  let slot = PROJECTILE_SLOT_STATE;
  for (let i = 0; i < 3; i++) { if (mem8[slot] !== 0) return; slot = u16(slot + STRIDE); }
  // BUG: forgot to advance INTRO_PHASE_INDEX here
  enqueueDisplayCommand(m, PHASE1_COMPLETE_DISPLAY_CMD);
  const target3 = (mem8[TARGET_GROUP_COUNT] * 3) & 0xff;
  let cmd = TARGET_MISMATCH_DISPLAY_CMD;
  if (target3 === mem8[HIT_TALLY]) { mem8[INTRO_PHASE_INDEX] = 0x04; cmd = TARGET_MATCH_DISPLAY_CMD; }
  mem8[INTRO_DELAY_CKSUM_WORD] = 0x40;
  enqueueDisplayCommand(m, cmd);
  fillByteRun(m, ENEMY_TARGET_REC0, 0x00, 0x30);
}

test("TEETH: a twin skipping the phase advance is caught in RAM", () => {
  const o = craft({ scriptTerm: true, slotsIdle: true, targetGroup: 2, hit: 0, freeRing: true });
  const c = craft({ scriptTerm: true, slotsIdle: true, targetGroup: 2, hit: 0, freeRing: true });
  oracle(o);
  brokenNoPhaseAdvance(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped phase advance — it is worthless");
  assert.equal(d.addr, INTRO_PHASE_INDEX, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(phase): skipped advance caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong target-clear byte is caught in RAM", () => {
  const o = craft({ scriptTerm: true, slotsIdle: true, targetGroup: 2, hit: 0, dirtyTarget: true, freeRing: true });
  const c = craft({ scriptTerm: true, slotsIdle: true, targetGroup: 2, hit: 0, dirtyTarget: true, freeRing: true });
  oracle(o);
  drivePhase1RecordsThenCheckCompletion(c);
  c.mem.write8((ENEMY_TARGET_REC0 + 0x10) & 0xffff, 0x99); // BUG: a cell left non-zero
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a dirty target cell — it is worthless");
  assert.equal(d.addr, (ENEMY_TARGET_REC0 + 0x10) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(fill): dirty target cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
