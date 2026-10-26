// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advancePlayStateToPhase6OnDwellExpiry (Pooyan) — main-loop sub-state 5 handler.
 *
 * Ticks SUBSTATE_FIELD1_COUNTER: while non-zero, decrement and return. On expiry it clears a 9-byte
 * block from LATCHED_ENEMY_X, enqueues the silence sound command, and sets PLAY_STATE_INDEX := 6.
 * Then, unless SCORE_DRIP_ACCUM + TAMPER_STRIKES_HUD_GUARD is zero, it hands off to the object-slot
 * spawn sweep.
 *
 * The sum is a tamper/score guard that is zero in valid play, so the spawn-sweep tail is a defensive
 * path: entered from here the sweep's slot counter is cleared by the memset, so it runs away off
 * mapped RAM and throws in this harness — identically on both sides. So the two live branches (count,
 * expire) are compared byte-for-byte, and the tail is proven by CONTROL: sum != 0 transfers into the
 * sweep (throws) on both sides; sum == 0 returns on both. Compared on RAM (dumpState) minus
 * stack scratch below the entry SP; SP is parked in STACK_SCRATCH so oracle push/ret churn drops out.
 *
 * Jobs: 1. EQUAL (count / expire); 2. WRITE-SET; 3. TEETH; 4. TAIL control-transfer parity.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-114f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_114f as oracle } from "../../translated/loc_114f.js";
import { advancePlayStateToPhase6OnDwellExpiry } from "../advancePlayStateToPhase6OnDwellExpiry.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SUBSTATE_FIELD1_COUNTER,
  LATCHED_ENEMY_X,
  PLAY_STATE_INDEX,
  SCORE_DRIP_ACCUM,
  TAMPER_STRIKES_HUD_GUARD,
  SOUND_RING_WRITE_PTR,
  HIGH_SCORE_TABLE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; // inside STACK_SCRATCH
const RING_SLOT = 0x43; // first sound-ring slot low byte
const NEXT_PHASE = 0x06;
const CLEAR_LEN = 0x09;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const threw = (fn, m) => {
  try {
    fn(m);
    return false;
  } catch {
    return true;
  }
};

/** Seat the branch selectors; the write targets are pre-dirtied so clears/stores are observable. */
function seat({ timer = 0x05, drip = 0x00, tamper = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(SCORE_DRIP_ACCUM, drip);
  m.mem.write8(TAMPER_STRIKES_HUD_GUARD, tamper);
  m.mem.write8(SOUND_RING_WRITE_PTR, RING_SLOT);
  m.mem.write8(HIGH_SCORE_TABLE + RING_SLOT, 0xff); // pre-dirty the ring slot
  m.mem.write8(PLAY_STATE_INDEX, 0x00); // pre-dirty so the phase write is visible
  for (let i = 0; i < CLEAR_LEN; i++) m.mem.write8(LATCHED_ENEMY_X + i, 0xff); // pre-dirty the block
  m.mem.write8(SUBSTATE_FIELD1_COUNTER, timer); // last: the timer cell sits inside the block
  return m;
}

const CASES = [
  { name: "counting -> decrement + ret", cfg: { timer: 0x05 } },
  { name: "expire, sum zero -> ret", cfg: { timer: 0x00, drip: 0x00, tamper: 0x00 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advancePlayStateToPhase6OnDwellExpiry == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    advancePlayStateToPhase6OnDwellExpiry(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} live branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: count decrements; expiry clears block, enqueues silence, sets phase", () => {
  const cnt = seat({ timer: 0x05 });
  oracle(cnt);
  assert.equal(cnt.mem.read8(SUBSTATE_FIELD1_COUNTER), 0x04, "timer 0x05 -> 0x04");
  assert.equal(cnt.mem.read8(PLAY_STATE_INDEX), 0x00, "phase untouched while counting");

  const exp = seat({ timer: 0x00, drip: 0x00, tamper: 0x00 });
  oracle(exp);
  for (let i = 0; i < CLEAR_LEN; i++) {
    assert.equal(exp.mem.read8(LATCHED_ENEMY_X + i), 0x00, `block byte ${i} cleared`);
  }
  assert.equal(exp.mem.read8(HIGH_SCORE_TABLE + RING_SLOT), 0x00, "silence command enqueued");
  assert.equal(exp.mem.read8(PLAY_STATE_INDEX), NEXT_PHASE, "phase advanced to 6");
  console.log("  WRITE-SET: timer--; block:=0 / silence / phase:=6");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted phase byte is CAUGHT; the branches are load-bearing", () => {
  const o = seat({ timer: 0x00 });
  const c = seat({ timer: 0x00 });
  oracle(o);
  advancePlayStateToPhase6OnDwellExpiry(c);
  c.mem.write8(PLAY_STATE_INDEX, (o.mem.read8(PLAY_STATE_INDEX) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted phase byte");
  assert.equal(d.addr, PLAY_STATE_INDEX, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  const cnt = seat({ timer: 0x05 });
  const exp = seat({ timer: 0x00 });
  oracle(cnt);
  oracle(exp);
  assert.notEqual(ramDiffMinusStack(cnt, exp), null, "count and expire branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; branches load-bearing`);
});

// -- 4. TAIL control-transfer parity -----------------------------------------

test("TAIL: sum != 0 transfers into the spawn sweep on both sides; sum == 0 returns on both", () => {
  // sum != 0: the guard is false -> both hand off to the sweep (which runs away off mapped RAM here).
  assert.equal(threw(oracle, seat({ timer: 0x00, drip: 0x01 })), true, "oracle takes the tail on sum != 0");
  assert.equal(threw(advancePlayStateToPhase6OnDwellExpiry, seat({ timer: 0x00, drip: 0x01 })), true, "module takes the tail on sum != 0");

  // sum == 0: the guard holds -> both return without entering the sweep.
  assert.equal(threw(oracle, seat({ timer: 0x00, drip: 0x00 })), false, "oracle returns on sum == 0");
  assert.equal(threw(advancePlayStateToPhase6OnDwellExpiry, seat({ timer: 0x00, drip: 0x00 })), false, "module returns on sum == 0");
  console.log("  TAIL: handoff parity — sum != 0 enters the sweep, sum == 0 returns");
});
