// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for holdEnemyAnimGatedByDrawnFlag (ROM 0x76a6, Pooyan) — animation-tick state 2, which composes
 * the idiomatic advanceObjectAnimationFrame. It never caller-skips: it always takes the plain `ret` (SP += 2) and
 * returns true (the walk always continues).
 *
 * A gate: while the object-drawn flag is set the entry is HELD — `ret nz`, nothing steps. Once the
 * flag is clear it steps the entry's animation and returns. Either way it returns true.
 *
 * The oracle drives the TRANSLATED advanceObjectAnimationFrame through the routines map; the module imports the
 * IDIOMATIC sibling directly. The two must land byte-identical in RAM (dumpState) minus stack scratch below the entry SP.
 * No register is a live-out — the caller reads back only the (always-true) control-flow boolean — so
 * registers are NOT compared. Cases are CRAFTED: a plain boot does not seat this state.
 *
 * Jobs:
 *   1. EQUAL — gate closed (held) and gate open (steps): oracle == module in RAM (−stack); both
 *      return true; the oracle SP delta is +2 (plain ret) on both.
 *   2. WRITE-SET — a closed gate touches nothing; an open gate steps the animation (holds the frame).
 *   3. TEETH — a twin that steps while the gate is closed is caught by the RAM diff; a twin that
 *      returns false is rejected by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-76a6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_76a6 as oracle } from "../../translated/loc_7638.js";
import { holdEnemyAnimGatedByDrawnFlag } from "../holdEnemyAnimGatedByDrawnFlag.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; //   the entry being ticked (ix)
const DRAWN = 0x8d58; // OBJECT_DRAWN_FLAG (proposed cell)
const HOLD = REC + 0x0e; // animation frame-hold counter
const SP0 = 0x8ff8; //   inside STACK_SCRATCH; room for the tick's nested call dip
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function seat(m) {
  m.regs.ix = REC;
  m.regs.sp = SP0;
  m.mem.write8(HOLD, 0x05); // anim hold nonzero -> advanceObjectAnimationFrame just decrements (no ROM-script walk)
  return m;
}

/** drawn flag set -> the entry is held (`ret nz`), nothing steps. */
function craftClosed() {
  const m = seat(BASE.clone());
  m.mem.write8(DRAWN, 0x01);
  return m;
}

/** drawn flag clear -> the animation steps. */
function craftOpen() {
  const m = seat(BASE.clone());
  m.mem.write8(DRAWN, 0x00);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, craft] of [["closed", craftClosed], ["open", craftOpen]]) {
  test(`EQUAL: gate ${label} — module == oracle in RAM (−stack), returns true, plain ret (SP+=2)`, () => {
    const o = craft();
    const c = craft();
    const ret = holdEnemyAnimGatedByDrawnFlag(c);
    oracle(o);
    assert.equal(ret, true, "state 2 must always return true (keep walking)");
    assert.equal(o.regs.sp, (SP0 + 2) & 0xffff, "oracle must take the plain ret (SP += 2)");
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${label})`);
    console.log(`  EQUAL ${label}: true, SP+=2, RAM identical`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a closed gate touches nothing; an open gate steps the animation", () => {
  const closed = craftClosed();
  oracle(closed);
  assert.equal(closed.mem.read8(HOLD), 0x05, "closed gate must NOT step the animation");

  const open = craftOpen();
  oracle(open);
  assert.equal(open.mem.read8(HOLD), 0x04, "open gate steps the animation (frame hold decremented)");
  console.log("  WRITE-SET: closed holds, open steps");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a twin that steps while the gate is closed is caught by the RAM diff", () => {
  const o = craftClosed();
  const c = craftClosed();
  oracle(o);
  holdEnemyAnimGatedByDrawnFlag(c);
  c.mem.write8(HOLD, 0x04); // BUG: a closed gate must leave the hold at 0x05

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate FAILED to catch a step under a closed gate — worthless");
  assert.equal(d.addr, HOLD, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: an illegal step under a closed gate caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that returns false is rejected by the boolean check", () => {
  function brokenAbort(m) {
    holdEnemyAnimGatedByDrawnFlag(m);
    return false; // BUG: state 2 must never abort the walk
  }
  const c = craftOpen();
  assert.throws(
    () => assert.equal(brokenAbort(c), true),
    "the boolean contract must reject state 2 reported as an abort",
  );
  console.log("  TEETH/boolean: a returns-false twin is caught");
});
