// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for driveAimIndicatorHitTimerElseRescan (ROM 0x6bee, Pooyan) — the aim-indicator stepper.
 *
 * driveAimIndicatorHitTimerElseRescan reads AIM_INDICATOR_MODE: mode 0 runs the proximity redraw (clearAimIndicatorUnlessProximityHit); mode 1
 * lights the "above" bit and any higher mode the "below" bit of PLAYER_AIM_FLAGS (each
 * clearing the other), then drains AIM_INDICATOR_TIMER and clears the mode byte at zero.
 *
 * This is NOT a caller-skip (no `pop af; ret`); it is a plain leaf. Its mode-0 arm COMPOSES
 * the real idiomatic clearAimIndicatorUnlessProximityHit (the module imports it; the oracle runs the translated clearAimIndicatorUnlessProximityHit
 * through m.call), so the gate seats gates-inactive so that redraw takes its clean no-hit
 * path. The oracle's call/ret trampolines touch only STACK_SCRATCH (sp seated there), which
 * is excluded; the contract is RAM (dumpState, minus stack scratch below the entry SP). No register is a
 * live-out (the sole caller acquireTargetLockAndSetAimIndicator re-reads memory), so RAM is the whole contract.
 *
 * The routine runs only during live aim gameplay, so every state is CRAFTED:
 *   - "mode 0"        — redraw pass composed over clearAimIndicatorUnlessProximityHit's no-hit branch.
 *   - "mode 1 hold"   — above bit, timer decremented but nonzero (mode survives).
 *   - "mode 1 expire" — above bit, timer hits zero, mode byte cleared.
 *   - "mode 3 hold"   — below bit, timer decremented but nonzero.
 *   - "mode 3 expire" — below bit, timer hits zero, mode byte cleared.
 *
 * Jobs: 1. EQUAL each state; 2. WRITE-SET the expire path's exact footprint; 3. TEETH.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6bee.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6bee as oracle } from "../../translated/loc_6bee.js";
import { driveAimIndicatorHitTimerElseRescan } from "../driveAimIndicatorHitTimerElseRescan.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const MODE = 0x8d52; //  AIM_INDICATOR_MODE
const TIMER = 0x8d53; // AIM_INDICATOR_TIMER
const AIM = 0x8a87; //   PLAYER_AIM_FLAGS
const HIT = 0x8d54; //   PROXIMITY_HIT_FLAG (clearAimIndicatorUnlessProximityHit zeroes on no-hit)
const GATE0 = 0x8be8; // pass-0 projectile gate (inactive => no hit)
const GATE1 = 0x8c00;
const GATE2 = 0x8c18;
const SP_SEAT = 0x8fe0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SEAT);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat a fresh clone for a given mode/timer state. AIM/HIT pre-dirtied so writes show. */
function craft(state) {
  const m = BASE.clone();
  m.regs.sp = SP_SEAT;
  m.mem.write8(AIM, 0xff); // bits 2,3 set -> a clear/flip is observable
  m.mem.write8(HIT, 0x01); // -> clearAimIndicatorUnlessProximityHit's zero is observable on the mode-0 arm
  if (state === "mode 0") {
    m.mem.write8(MODE, 0x00);
    m.mem.write8(GATE0, 0x00);
    m.mem.write8(GATE1, 0x00);
    m.mem.write8(GATE2, 0x00);
  } else if (state === "mode 1 hold") {
    m.mem.write8(MODE, 0x01);
    m.mem.write8(TIMER, 0x02);
  } else if (state === "mode 1 expire") {
    m.mem.write8(MODE, 0x01);
    m.mem.write8(TIMER, 0x01);
  } else if (state === "mode 3 hold") {
    m.mem.write8(MODE, 0x03);
    m.mem.write8(TIMER, 0x02);
  } else if (state === "mode 3 expire") {
    m.mem.write8(MODE, 0x03);
    m.mem.write8(TIMER, 0x01);
  }
  return m;
}

const STATES = ["mode 0", "mode 1 hold", "mode 1 expire", "mode 3 hold", "mode 3 expire"];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: each mode/timer state — driveAimIndicatorHitTimerElseRescan == oracle in RAM (−stack)", () => {
  for (const state of STATES) {
    const o = craft(state);
    const c = craft(state);
    oracle(o);
    driveAimIndicatorHitTimerElseRescan(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${state}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${STATES.length} states identical (RAM −stack); mode-0 composes idiomatic clearAimIndicatorUnlessProximityHit`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the mode-1 expire path writes exactly AIM, TIMER, MODE", () => {
  const before = craft("mode 1 expire").dumpState();
  const after = craft("mode 1 expire");
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < before.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (before[off] !== a1[off] && !inDeadStack(addr)) changed.set(addr, a1[off]);
  }
  assert.equal(changed.size, 3, `expected exactly 3 written cells, got ${changed.size}`);
  assert.equal(changed.get(AIM), 0xf7, "AIM: above bit set, below cleared (0xff -> 0xf7)");
  assert.equal(changed.get(TIMER), 0x00, "TIMER drained to 0");
  assert.equal(changed.get(MODE), 0x00, "MODE cleared at timer expiry");
  console.log(`  WRITE-SET: ${hx(AIM)}=0xf7 ${hx(TIMER)}=0x00 ${hx(MODE)}=0x00 (3 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong AIM byte is CAUGHT by the RAM diff", () => {
  const o = craft("mode 1 hold");
  const c = craft("mode 1 hold");
  oracle(o);
  driveAimIndicatorHitTimerElseRescan(c);
  c.mem.write8(AIM, (c.mem.read8(AIM) ^ 0xff) & 0xff); // BUG: corrupt the indicator byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong AIM byte — it is worthless");
  assert.equal(d.addr, AIM, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(AIM)})`);
  console.log(`  TEETH/RAM: wrong AIM caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a twin that fails to clear MODE at timer expiry is CAUGHT", () => {
  const o = craft("mode 1 expire");
  const c = craft("mode 1 expire");
  oracle(o); // MODE cleared to 0
  driveAimIndicatorHitTimerElseRescan(c);
  c.mem.write8(MODE, 0x01); // BUG: mode not cleared when the timer hit zero

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a mode-not-cleared twin");
  assert.equal(d.addr, MODE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(MODE)})`);
  console.log(`  TEETH/mode: non-clearing twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
