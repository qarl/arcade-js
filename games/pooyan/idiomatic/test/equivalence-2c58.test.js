// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for climbHunterToLaunchRowThenPromoteGroup (ROM 0x2c58) — the DISSOLVED caller-skip of the hunter
 * dispatch. The oracle already carries the boolean caller-skip protocol (its own source returns
 * `true` on the `ret c` climbing path and `false` on the `pop af; ret` reached-top path), so the
 * idiomatic module reproduces that boolean while dropping the stack plumbing.
 *
 * Contract compared per case: RAM (dumpState, minus stack scratch below the entry SP) PLUS the routine's ONLY
 * live-out — the JS boolean return. No register survives as a consumed output: on the climbing
 * path IX/A are left untouched-or-clobbered but unread (dispatchOneHunterRecordState only propagates the boolean, and
 * dispatchAllHunterRecordStates parks its loop counter in the alt register set across the call); on the skip path the
 * oracle's pop-af leaves A as stack garbage and the caller frame is aborted. IX is deliberately
 * NOT compared: the oracle advances it during the top-sweep, the idiomatic module walks a local
 * pointer — the divergence is out of contract because the skip aborts every caller that could read
 * IX. pc/cycles/full register file are not compared.
 *
 * The path is SELECTED by the seated record: the high position byte (+0x06, after the +0x09 carry)
 * below the top row 0x12 climbs (true); at/above it sweeps (false). The oracle runs its nested
 * m.call(0x4006/0x2c85/0x0f3f) against the registered translated routines; the idiomatic module
 * calls the equivalent idiomatic imports directly — so this composes the whole dissolved unit.
 *
 * Jobs:
 *   1. EQUAL/NORMAL   — climbing input: oracle == idiomatic in RAM(−stack); both return true.
 *   2. EQUAL/SKIP     — reached-top input with a seeded trigger record: oracle == idiomatic in
 *                       RAM(−stack); both return false; the seeded 0x8ae0 record IS transitioned
 *                       (positive control that the sweep actually ran).
 *   3. EQUAL/CARRY    — a low+step carry bumps the high byte yet stays below the top: still true.
 *   4. TEETH/RAM      — a wrong written position byte is caught by the RAM diff.
 *   5. TEETH/BOOL     — a twin returning the WRONG boolean is caught by the return check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2c58.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c58 as oracle } from "../../translated/loc_2c58.js";
import { climbHunterToLaunchRowThenPromoteGroup } from "../climbHunterToLaunchRowThenPromoteGroup.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff8);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

const REC = 0x8a80; // the hunter record climbHunterToLaunchRowThenPromoteGroup operates on (distinct from the 0x8ae0 sweep region)
const HOLD = 0x0e; //   record frame-hold offset (nonzero -> advanceObjectAnimationFrame just decrements)
const P_LO = 0x05;
const P_HI = 0x06;
const P_STEP = 0x09;
const TRIG = 0x02; //   record state offset; 0x11 triggers advanceRecordStateAndSeedMoveScript's transition

/** A fresh clone with climbHunterToLaunchRowThenPromoteGroup's record inputs seated identically on both sides. */
function craft({ lo = 0, step = 0, hi = 0, seedTrigger = false } = {}) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ff8; // in STACK_SCRATCH; the oracle's push/pop/ret stay inside it
  m.mem.write8(REC + HOLD, 0x05); // frame-hold nonzero: advanceObjectAnimationFrame decrements and returns
  m.mem.write8(REC + P_LO, lo);
  m.mem.write8(REC + P_STEP, step);
  m.mem.write8(REC + P_HI, hi);
  if (seedTrigger) m.mem.write8(ENEMY_ACTOR_TABLE + TRIG, 0x11); // record 0 -> transitioned by the sweep
  return m;
}

// -- 1. EQUAL/NORMAL ----------------------------------------------------------

test("EQUAL/NORMAL: high byte below top -> climbing, oracle == idiomatic (RAM −stack), both true", () => {
  const o = craft({ lo: 0, step: 0, hi: 0x05 });
  const c = craft({ lo: 0, step: 0, hi: 0x05 });
  const ro = oracle(o);
  const rc = climbHunterToLaunchRowThenPromoteGroup(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(ro, true, "oracle takes the climbing (ret c) path -> true");
  assert.equal(rc, ro, "idiomatic boolean must match the oracle");
  console.log("  EQUAL/NORMAL: climbing path identical, both returned true");
});

// -- 2. EQUAL/SKIP ------------------------------------------------------------

test("EQUAL/SKIP: high byte at top -> sweep, oracle == idiomatic (RAM −stack), both false", () => {
  const o = craft({ lo: 0, step: 0, hi: 0x12, seedTrigger: true });
  const c = craft({ lo: 0, step: 0, hi: 0x12, seedTrigger: true });
  const ro = oracle(o);
  const rc = climbHunterToLaunchRowThenPromoteGroup(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(ro, false, "oracle takes the reached-top (pop af; ret) path -> false");
  assert.equal(rc, ro, "idiomatic boolean must match the oracle");
  // positive control: the seeded trigger record WAS transitioned (0x11 -> 0x12) by the sweep,
  // proving climbHunterToLaunchRowThenPromoteGroup actually ran the record walk rather than short-circuiting.
  assert.equal(c.mem.read8(ENEMY_ACTOR_TABLE + TRIG), 0x12, "sweep must advance the seeded record to 0x12");
  console.log("  EQUAL/SKIP: sweep path identical, both returned false, seeded record transitioned");
});

// -- 3. EQUAL/CARRY -----------------------------------------------------------

test("EQUAL/CARRY: low+step carries into the high byte but stays below top -> still true", () => {
  const o = craft({ lo: 0xff, step: 0x02, hi: 0x05 }); // low 0xff+0x02 -> carry, high 0x05->0x06
  const c = craft({ lo: 0xff, step: 0x02, hi: 0x05 });
  const ro = oracle(o);
  const rc = climbHunterToLaunchRowThenPromoteGroup(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(ro, true, "high byte 0x06 still below top -> true");
  assert.equal(rc, ro, "idiomatic boolean must match the oracle");
  assert.equal(c.mem.read8(REC + P_HI), 0x06, "carry must bump the high byte to 0x06");
  assert.equal(c.mem.read8(REC + P_LO), 0x01, "low byte wraps to 0x01");
  console.log("  EQUAL/CARRY: 16-bit carry handled, high=0x06 low=0x01, both true");
});

// -- 4. TEETH/RAM -------------------------------------------------------------

test("TEETH/RAM: a wrong written position byte is CAUGHT by the RAM diff", () => {
  const o = craft({ lo: 0, step: 0, hi: 0x05 });
  const c = craft({ lo: 0, step: 0, hi: 0x05 });
  oracle(o);
  climbHunterToLaunchRowThenPromoteGroup(c);
  c.mem.write8(REC + P_LO, 0xee); // BUG: the stored low byte must be 0x00, not 0xee

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong position byte — it is worthless");
  assert.equal(d.addr, REC + P_LO, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong low byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 5. TEETH/BOOL ------------------------------------------------------------

test("TEETH/BOOL: a twin returning the WRONG boolean is CAUGHT by the return check", () => {
  const o = craft({ lo: 0, step: 0, hi: 0x12, seedTrigger: true });
  const c = craft({ lo: 0, step: 0, hi: 0x12, seedTrigger: true });
  const ro = oracle(o);
  const rc = climbHunterToLaunchRowThenPromoteGroup(c);
  assert.equal(rc, ro, "sanity: the module's boolean matches the oracle (false on the skip path)");
  // A twin that flipped the return would be rejected by the very check the EQUAL jobs use.
  assert.notEqual(!rc, ro, "the boolean check must reject a flipped return");
  console.log(`  TEETH/BOOL: correct=${rc}; a flipped ${!rc} is rejected against oracle ${ro}`);
});
