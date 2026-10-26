// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for startEnemyFall (ROM 0x3f5c, Pooyan) — the object state handler that begins a
 * fall. It picks a plummet animation from the fall table (0x4072) by the record's low-two variant
 * bits (biased down by one), points the record at it, seeds the fall velocity, advances the state
 * byte, and falls through into the next state handler (advanceObjectStateOnFrameTimerExpiry: tick the animation, count the frame
 * timer, return while it is still running).
 *
 * The module dissolves every callee to a direct call: the word lookup (fetchWordFromTableIndex), the animation-set
 * (setActorAnimation at 0x381e), and the state-handler fall-through (advanceObjectStateOnFrameTimerExpiry); the oracle drives the
 * frozen originals. IX (the record base) is the one input, bridged in via the param default. startEnemyFall
 * yields nothing the caller reads, so no register is compared; equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP, SP parked in dead stack so the oracle's transient return-slot pushes drop out.
 *
 * The frame timer is seeded > 1 so advanceObjectStateOnFrameTimerExpiry returns after the tick (the deeper handler stays out of
 * scope). Jobs:
 *   1. EQUAL — three variant selectors: oracle == startEnemyFall (RAM −stack).
 *   2. WRITE-SET — seeds the fall velocity, advances the state byte, ticks the frame timer.
 *   3. TEETH — a wrong fall velocity is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3f5c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3f5c as oracle } from "../../translated/loc_3f5c.js";
import { startEnemyFall } from "../startEnemyFall.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ACTOR_TABLE; //   record base (IX) for this handler
const VARIANT = REC + 0x07; // low two bits pick the fall-anim variant
const STATE = REC + 0x02; //  state byte, advanced by one
const VELOCITY = REC + 0x09; // fall velocity, seeded to 0x40
const TIMER = REC + 0x11; //  frame timer, decremented by the fall-through handler
const SP0 = 0x8ff0; //        inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with IX on the record and a running frame timer; `v` selects the variant byte. */
function craft(v) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem8[VARIANT] = v & 0xff;
  m.mem8[STATE] = 0x07; // some prior state -> advanced to 0x08
  m.mem8[TIMER] = 0x05; // running -> advanceObjectStateOnFrameTimerExpiry ticks it and returns before the deeper handler
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: three variant selectors — startEnemyFall == oracle (RAM −stack)", () => {
  for (const v of [0x01, 0x02, 0x03]) {
    const o = craft(v);
    oracle(o);
    const c = craft(v);
    startEnemyFall(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[variant ${hx(v)}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: variants 1/2/3 identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: seeds the fall velocity, advances the state, ticks the frame timer", () => {
  const o = craft(0x01);
  oracle(o);
  assert.equal(o.mem8[VELOCITY], 0x40, "fall velocity seeded");
  assert.equal(o.mem8[STATE], 0x08, "state byte advanced (0x07 -> 0x08)");
  assert.equal(o.mem8[TIMER], 0x04, "frame timer ticked by the fall-through handler (0x05 -> 0x04)");
  console.log("  WRITE-SET: velocity 0x40, state advanced, timer ticked");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong fall velocity is CAUGHT by the RAM diff", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  startEnemyFall(c);
  c.mem8[VELOCITY] = 0x00; // BUG: the handler must have seeded the fall velocity to 0x40
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong fall velocity — it is worthless");
  assert.equal(d.addr, VELOCITY, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong fall velocity caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
