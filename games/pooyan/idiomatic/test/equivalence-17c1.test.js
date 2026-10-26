// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnEnemyWave (ROM 0x17c1, Pooyan) — the play-state idx3 handler:
 * enemy-wave setup + spawn. Selects a seed/cursor pair, seeds four actor records, nudges,
 * seats the anim-script cursor, steps the animators, then on the play-mode latch either arms a
 * play-state / copies the intro string (zero branch) or fans out a sprite group (nonzero branch).
 *
 * spawnEnemyWave is void — no register survives — so the register file is not compared; equivalence is
 * RAM (dumpState) minus stack scratch below the entry SP via firstStateDiff, SP parked in dead stack. The animator
 * pass (advanceActorAnimationsUnlessGrabbing) is held on its skip arm (grab latch set) so the diff isolates spawnEnemyWave's own
 * writes; the dissolved fetchWordFromTableIndex / setActorAnimation on the group path read/write identical bytes.
 *
 * Jobs:
 *   1. EQUAL — the zero-branch arm-0x12 path and the nonzero-branch group build: oracle == module.
 *   2. WRITE-SET — the play-mode latch selects the branch: zero arms PLAY_STATE_INDEX 0x12,
 *      nonzero arms 0x0f and seats the first group slot.
 *   3. TEETH — a wrong PLAY_STATE_INDEX is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-17c1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_17c1 as oracle } from "../../translated/loc_17c1.js";
import { spawnEnemyWave } from "../spawnEnemyWave.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PLAY_MODE_LATCH = 0x8f50;
const ROUND_COUNTER = 0x8907;
const FLIP = 0x881f;
const GAME_ACTIVE = 0x8806;
const LAUNCH_ARMED = 0x8f3f;
const GRAB = 0x8d32; //     grab latch: set -> the animator pass (advanceActorAnimationsUnlessGrabbing) skips
const PLAY_STATE = 0x880a; // PLAY_STATE_INDEX: 0x12 on the zero branch, 0x0f on the group branch
const ENEMY_TABLE = 0x8ae0; // sprite-group base seeded by the nonzero branch
const SP0 = 0x8ff0; //      inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Zero branch: latch=0, even round, unflipped, no game, launch armed -> arm PLAY_STATE_INDEX 0x12. */
function craftArm() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[GRAB] = 0x01; // hold the animator pass on its skip arm
  m.mem8[PLAY_MODE_LATCH] = 0x00; // zero branch
  m.mem8[ROUND_COUNTER] = 0x00; // even round (bit0 clear)
  m.mem8[FLIP] = 0x00; // dec-nudge runs
  m.mem8[GAME_ACTIVE] = 0x00;
  m.mem8[LAUNCH_ARMED] = 0x01; // -> arm state 0x12
  return m;
}

/** Nonzero branch: latch set, round bit1 set (>>1 < 7) -> 5-slot group build, arm 0x0f. */
function craftGroup() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[GRAB] = 0x01;
  m.mem8[PLAY_MODE_LATCH] = 0x01; // nonzero branch
  m.mem8[FLIP] = 0x01; // dec-nudge skipped
  m.mem8[ROUND_COUNTER] = 0x02; // bit1 set; >>1 = 1 -> group size 5
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: arm + group branches — spawnEnemyWave == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [["arm-0x12", craftArm], ["group build", craftGroup]]) {
    const o = craft();
    oracle(o);
    const c = craft();
    spawnEnemyWave(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: arm + group branches identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the play-mode latch selects the branch", () => {
  const arm = craftArm();
  oracle(arm);
  assert.equal(arm.mem8[PLAY_STATE], 0x12, "zero branch armed PLAY_STATE_INDEX 0x12");

  const grp = craftGroup();
  oracle(grp);
  assert.equal(grp.mem8[PLAY_STATE], 0x0f, "nonzero branch armed PLAY_STATE_INDEX 0x0f");
  assert.equal(grp.mem8[ENEMY_TABLE], 0x01, "first group slot start flag seated");
  assert.equal(grp.mem8[ENEMY_TABLE + 0x05], 0x80, "first group slot +5 seated");

  assert.notEqual(arm.mem8[PLAY_STATE], grp.mem8[PLAY_STATE], "the latch must gate the branch");
  console.log("  WRITE-SET: zero -> 0x12, nonzero -> 0x0f + group seated");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong PLAY_STATE_INDEX is CAUGHT by the RAM diff", () => {
  const o = craftGroup();
  const c = craftGroup();
  oracle(o);
  spawnEnemyWave(c);
  c.mem8[PLAY_STATE] = 0x12; // BUG: the group branch must arm 0x0f, not 0x12
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong PLAY_STATE_INDEX — it is worthless");
  assert.equal(d.addr, PLAY_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong PLAY_STATE_INDEX caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
