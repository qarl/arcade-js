// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for acquireTargetLockAndSetAimIndicator (ROM 0x6cab, Pooyan) — the aim-indicator /
 * target-acquisition updater. acquireTargetLockAndSetAimIndicator is NOT a caller-skip (no `pop af; ret`); it is the
 * in-cluster CALLER of driveAimIndicatorHitTimerElseRescan, which it invokes directly. This gate COMPOSES the real
 * idiomatic driveAimIndicatorHitTimerElseRescan: the module imports it (which itself composes clearAimIndicatorUnlessProximityHit), while the
 * oracle runs the translated driveAimIndicatorHitTimerElseRescan through m.call. Both must land byte-identical.
 *
 * The oracle's call/ret/rst-0x10 trampolines touch only STACK_SCRATCH (sp seated there),
 * excluded from the diff; the contract is RAM (dumpState, minus stack scratch below the entry SP). No register
 * is a live-out — runActiveGameplayFrame runs the next per-frame handler with its own registers — so RAM
 * is the whole contract. pc/sp/cycles are not compared.
 *
 * Every state is CRAFTED (the routine runs only in live gameplay). The "reaches indicator"
 * states seat AIM_INDICATOR_MODE=0 so the composed driveAimIndicatorHitTimerElseRescan takes its clearAimIndicatorUnlessProximityHit no-hit
 * redraw (which zeroes PROXIMITY_HIT_FLAG, letting acquireTargetLockAndSetAimIndicator continue). States seated:
 *   - "bail game"     — GAME_ACTIVE_FLAG set: immediate return, no writes.
 *   - "bail grab"     — GRAB_ACTIVE_FLAG set: immediate return, no writes.
 *   - "teardown"      — WAVE_TEARDOWN_STATE set: PLAYER_AIM_FLAGS cleared, return.
 *   - "launch above"  — LAUNCH_STATE==1: the forced-"above" tail.
 *   - "scan below"    — no lock, an active in-band enemy below the player -> lock + below.
 *   - "scan above"    — no lock, an active in-band enemy above the player -> lock + above.
 *   - "scan none"     — no lock, no active enemy: nothing locked, no indicator write.
 *   - "lock recompute"— existing lock, target still in band -> cadence recompute.
 *   - "lock reset hot"— existing lock, its block reactivated -> 5-byte lock cleared.
 *   - "lock reset oob"— existing lock, target left the y-band -> 5-byte lock cleared.
 *
 * Jobs: 1. EQUAL each state; 2. WRITE-SET the teardown footprint; 3. TEETH.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6cab.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6cab as oracle } from "../../translated/loc_6cab.js";
import { acquireTargetLockAndSetAimIndicator } from "../acquireTargetLockAndSetAimIndicator.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const GAME = 0x8806; //     GAME_ACTIVE_FLAG (bail when nonzero)
const GRAB = 0x8d32; //     GRAB_ACTIVE_FLAG (bail when nonzero)
const TEARDOWN = 0x8f24; // WAVE_TEARDOWN_STATE
const AIM = 0x8a87; //      PLAYER_AIM_FLAGS
const HIT = 0x8d54; //      PROXIMITY_HIT_FLAG
const LAUNCH = 0x8f30; //   LAUNCH_STATE
const ROUND = 0x8907; //    ROUND_COUNTER
const ROTATE = 0x8f03; //   INPUT_ROTATE_LATCH
const ENEMY = 0x8ae0; //    ENEMY_ACTOR_TABLE (block 0)
const PLAYER_REF = 0x8842; // SPRITE_DISPLAY_LIST + 2
const YSLOTS = 0x8852; //   SPRITE_SCAN_YSLOTS (slot 0)
const LOCK = 0x8f40; //     TARGET_LOCK base (5 bytes)
const MODE = 0x8d52; //     AIM_INDICATOR_MODE (0 => driveAimIndicatorHitTimerElseRescan redraw)
const GATE0 = 0x8be8; //    projectile gates (inactive => clearAimIndicatorUnlessProximityHit no hit)
const GATE1 = 0x8c00;
const GATE2 = 0x8c18;
const PTR_Y = 0x8b40; //    scratch cell a lock's y-slot pointer aims at
const PTR_BLK = 0x8b42; //  scratch cell a lock's block pointer aims at
const SP_SEAT = 0x8fe0; //  inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SEAT);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the shared "reaches the indicator logic" preconditions on a fresh clone. */
function reachable() {
  const m = BASE.clone();
  m.regs.sp = SP_SEAT;
  m.mem.write8(GAME, 0x00);
  m.mem.write8(GRAB, 0x00);
  m.mem.write8(TEARDOWN, 0x00);
  m.mem.write8(AIM, 0xff); // so a clear/flip shows
  m.mem.write8(HIT, 0x01); // driveAimIndicatorHitTimerElseRescan->clearAimIndicatorUnlessProximityHit zeroes it
  m.mem.write8(MODE, 0x00); // driveAimIndicatorHitTimerElseRescan takes the clearAimIndicatorUnlessProximityHit redraw
  m.mem.write8(GATE0, 0x00);
  m.mem.write8(GATE1, 0x00);
  m.mem.write8(GATE2, 0x00);
  m.mem.write8(LAUNCH, 0x00);
  return m;
}

function seatNoLock(m) {
  for (let i = 0; i < 5; i++) m.mem.write8(LOCK + i, 0x00); // no existing lock
}

/** An existing lock whose pointers aim at the two scratch cells. */
function seatLock(m) {
  m.mem.write8(LOCK + 0, 0x55); // stale distance
  m.mem.write8(LOCK + 1, PTR_Y & 0xff);
  m.mem.write8(LOCK + 2, (PTR_Y >> 8) & 0xff);
  m.mem.write8(LOCK + 3, PTR_BLK & 0xff);
  m.mem.write8(LOCK + 4, (PTR_BLK >> 8) & 0xff);
}

function craft(state) {
  if (state === "bail game") {
    const m = reachable();
    m.mem.write8(GAME, 0x01);
    return m;
  }
  if (state === "bail grab") {
    const m = reachable();
    m.mem.write8(GRAB, 0x01);
    return m;
  }
  if (state === "teardown") {
    const m = reachable();
    m.mem.write8(TEARDOWN, 0x01);
    return m;
  }
  if (state === "launch above") {
    const m = reachable();
    m.mem.write8(LAUNCH, 0x01);
    return m;
  }
  if (state === "scan below") {
    const m = reachable();
    seatNoLock(m);
    for (let n = 0; n < 6; n++) m.mem.write8(ENEMY + n * 0x18, 0x00);
    m.mem.write8(ENEMY, 0x01); //  only block 0 active
    m.mem.write8(PLAYER_REF, 0x50);
    m.mem.write8(YSLOTS, 0x60); // in band, below the player
    return m;
  }
  if (state === "scan above") {
    const m = reachable();
    seatNoLock(m);
    for (let n = 0; n < 6; n++) m.mem.write8(ENEMY + n * 0x18, 0x00);
    m.mem.write8(ENEMY, 0x01); //  only block 0 active
    m.mem.write8(PLAYER_REF, 0x60);
    m.mem.write8(YSLOTS, 0x50); // in band, above the player
    return m;
  }
  if (state === "scan none") {
    const m = reachable();
    seatNoLock(m);
    for (let n = 0; n < 6; n++) m.mem.write8(ENEMY + n * 0x18, 0x00); // no active block
    m.mem.write8(PLAYER_REF, 0x50);
    return m;
  }
  if (state === "lock recompute") {
    const m = reachable();
    seatLock(m);
    m.mem.write8(PTR_BLK, 0x00); //  block not active -> no reset
    m.mem.write8(PTR_Y, 0x70); //    target in band -> recompute
    m.mem.write8(PLAYER_REF, 0x60);
    m.mem.write8(ROUND, 0x00); //    bit0 clear
    m.mem.write8(ROTATE, 0x07); //   +1 -> cadence frame
    return m;
  }
  if (state === "lock reset hot") {
    const m = reachable();
    seatLock(m);
    m.mem.write8(PTR_BLK, 0x01); //  block reactivated -> reset
    m.mem.write8(PTR_Y, 0x70);
    return m;
  }
  if (state === "lock reset oob") {
    const m = reachable();
    seatLock(m);
    m.mem.write8(PTR_BLK, 0x00);
    m.mem.write8(PTR_Y, 0x20); //    out of the y-band -> reset
    return m;
  }
  throw new Error("unknown state " + state);
}

const STATES = [
  "bail game", "bail grab", "teardown", "launch above",
  "scan below", "scan above", "scan none",
  "lock recompute", "lock reset hot", "lock reset oob",
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: each caller state — acquireTargetLockAndSetAimIndicator == oracle in RAM (−stack)", () => {
  for (const state of STATES) {
    const o = craft(state);
    const c = craft(state);
    oracle(o);
    acquireTargetLockAndSetAimIndicator(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${state}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${STATES.length} caller states identical (RAM −stack); driveAimIndicatorHitTimerElseRescan composed on every reaching state`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the teardown path writes exactly PLAYER_AIM_FLAGS := 0", () => {
  const before = craft("teardown").dumpState();
  const after = craft("teardown");
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < before.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (before[off] !== a1[off] && !inDeadStack(addr)) changed.set(addr, a1[off]);
  }
  assert.equal(changed.size, 1, `expected exactly 1 written cell, got ${changed.size}`);
  assert.equal(changed.get(AIM), 0x00, "AIM zeroed on wave teardown");
  console.log(`  WRITE-SET: ${hx(AIM)}=0x00 (1 cell)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong indicator byte is CAUGHT by the RAM diff", () => {
  const o = craft("scan below");
  const c = craft("scan below");
  oracle(o);
  acquireTargetLockAndSetAimIndicator(c);
  c.mem.write8(AIM, (c.mem.read8(AIM) ^ 0xff) & 0xff); // BUG: corrupt the aim indicator

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong AIM byte — it is worthless");
  assert.equal(d.addr, AIM, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(AIM)})`);
  console.log(`  TEETH/aim: wrong AIM caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong recorded lock pointer is CAUGHT by the RAM diff", () => {
  const o = craft("scan below");
  const c = craft("scan below");
  oracle(o);
  acquireTargetLockAndSetAimIndicator(c);
  c.mem.write8(LOCK + 3, (c.mem.read8(LOCK + 3) ^ 0xff) & 0xff); // BUG: corrupt the block pointer

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong lock pointer");
  assert.equal(d.addr, LOCK + 3, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(LOCK + 3)})`);
  console.log(`  TEETH/lock: wrong lock pointer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a twin that skips the composed driveAimIndicatorHitTimerElseRescan (HIT not zeroed) is CAUGHT", () => {
  const o = craft("scan none");
  const c = craft("scan none");
  oracle(o); // driveAimIndicatorHitTimerElseRescan->clearAimIndicatorUnlessProximityHit zeroes HIT
  acquireTargetLockAndSetAimIndicator(c);
  c.mem.write8(HIT, 0x01); // BUG: pretend the composed driveAimIndicatorHitTimerElseRescan never ran

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a caller that skipped its composed callee");
  assert.equal(d.addr, HIT, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(HIT)})`);
  console.log(`  TEETH/compose: skipped-callee twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
