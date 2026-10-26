// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickEnemyAnimAndReseedPoolAtCycleEnd (ROM 0x7644, Pooyan) — animation-tick state 0, a DISSOLVED
 * caller-skip that composes the idiomatic advanceObjectAnimationFrame.
 *
 * An inactive entry ((rec+0)==0) takes `ret z` (SP += 2) and returns true (the walk continues). A
 * live entry steps its animation, advances the (rec+5) sub-position by subtracting (rec+9) — rolling
 * the (rec+6) frame counter down on borrow — and while that counter is still >= 6 takes `ret nc`
 * (SP += 2) returning true. Once it drops below 6 it reloads the shared phase countdown, forces the
 * state byte of 14 records back to active, then FALLS INTO `pop af; ret` (SP += 4) and returns false.
 *
 * The oracle drives the TRANSLATED advanceObjectAnimationFrame through the routines map; the module imports the
 * IDIOMATIC sibling directly. The two must land byte-identical in RAM (dumpState) minus stack scratch below the entry SP.
 * No register is a live-out — the caller preserves its own loop state across the tick and reads back
 * only the control-flow boolean — so registers are NOT compared. The boolean return is, and the
 * oracle's SP delta confirms which path ran. Cases are CRAFTED: a plain boot does not seat this state.
 *
 * Jobs:
 *   1. EQUAL — inactive, still-animating (borrow + no-borrow), and reset (borrow + no-borrow):
 *      oracle == module in RAM (−stack); boolean matches; oracle SP delta matches the path.
 *   2. WRITE-SET — a reset reloads the shared phase countdown to 0x20 and forces 14 records' state
 *      byte to active; a still-animating tick advances (rec+5) and holds the animation.
 *   3. TEETH — a twin that reports the reset as 'continue' (true) is rejected; a wrong reset byte is
 *      caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7644.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7644 as oracle } from "../../translated/loc_7638.js";
import { tickEnemyAnimAndReseedPoolAtCycleEnd } from "../tickEnemyAnimAndReseedPoolAtCycleEnd.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; //   ENEMY_ACTOR_TABLE slot 0 (the entry being ticked / ix)
const COUNTDOWN = 0x892e; // SHARED_PHASE_COUNTDOWN
const STRIDE = 0x18; //  record stride
const RESET_COUNT = 14; // records the reset forces active, from REC forward
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
  m.mem.write8(REC + 0x0e, 0x05); // anim hold nonzero -> advanceObjectAnimationFrame just decrements (no ROM-script walk)
  return m;
}

/** (rec+0)==0 -> inactive -> the plain `ret z`. */
function craftInactive() {
  const m = seat(BASE.clone());
  m.mem.write8(REC + 0x00, 0x00);
  return m;
}

/** Live entry; (rec+6) stays >= 6 after the tick -> still animating (`ret nc`). borrow toggles the dec. */
function craftAnimating(borrow) {
  const m = seat(BASE.clone());
  m.mem.write8(REC + 0x00, 0x01); // active
  m.mem.write8(REC + 0x05, borrow ? 0x02 : 0x10);
  m.mem.write8(REC + 0x09, borrow ? 0x05 : 0x04); // borrow => (rec+5) < (rec+9)
  m.mem.write8(REC + 0x06, 0x0a); // >= 6 after any dec -> keep animating
  return m;
}

/** Live entry; (rec+6) ends below 6 -> the reset + caller-skip. borrow toggles the dec. */
function craftReset(borrow) {
  const m = seat(BASE.clone());
  m.mem.write8(REC + 0x00, 0x01); // active
  m.mem.write8(REC + 0x05, borrow ? 0x02 : 0x10);
  m.mem.write8(REC + 0x09, borrow ? 0x05 : 0x04);
  m.mem.write8(REC + 0x06, borrow ? 0x06 : 0x05); // borrow: 6 -> dec -> 5 (<6); no-borrow: already 5
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: inactive — module == oracle in RAM (−stack), returns true, plain ret (SP+=2)", () => {
  const o = craftInactive();
  const c = craftInactive();
  const ret = tickEnemyAnimAndReseedPoolAtCycleEnd(c);
  oracle(o);
  assert.equal(ret, true, "inactive entry must return true (keep walking)");
  assert.equal(o.regs.sp, (SP0 + 2) & 0xffff, "oracle inactive must take the plain ret z (SP += 2)");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL inactive: true, SP+=2, RAM identical");
});

for (const borrow of [true, false]) {
  test(`EQUAL: animating (borrow=${borrow}) — module == oracle in RAM (−stack), true, ret (SP+=2)`, () => {
    const o = craftAnimating(borrow);
    const c = craftAnimating(borrow);
    const ret = tickEnemyAnimAndReseedPoolAtCycleEnd(c);
    oracle(o);
    assert.equal(ret, true, "a still-animating tick must return true");
    assert.equal(o.regs.sp, (SP0 + 2) & 0xffff, "oracle animating must take `ret nc` (SP += 2)");
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL animating borrow=${borrow}: true, SP+=2, RAM identical`);
  });
}

for (const borrow of [true, false]) {
  test(`EQUAL: reset (borrow=${borrow}) — module == oracle in RAM (−stack), false, skip (SP+=4)`, () => {
    const o = craftReset(borrow);
    const c = craftReset(borrow);
    const ret = tickEnemyAnimAndReseedPoolAtCycleEnd(c);
    oracle(o);
    assert.equal(ret, false, "a frame-elapsed reset must return false (abort the walk)");
    assert.equal(o.regs.sp, (SP0 + 4) & 0xffff, "oracle reset must fall into pop-af/ret (SP += 4)");
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (borrow ${borrow})`);
    console.log(`  EQUAL reset borrow=${borrow}: false, SP+=4, RAM identical`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a reset reloads the shared phase countdown and forces 14 records' state byte active", () => {
  const after = craftReset(true);
  oracle(after);
  assert.equal(after.mem.read8(COUNTDOWN), 0x20, "reset reloads the shared phase countdown to 0x20");
  for (let n = 0; n < RESET_COUNT; n++) {
    assert.equal(after.mem.read8(REC + n * STRIDE + 0x02), 0x01, `record ${n} state byte forced active`);
  }
  assert.equal(after.mem.read8(REC + 0x05), (0x02 - 0x05) & 0xff, "(rec+5) advanced by the wrapped sub");
  assert.equal(after.mem.read8(REC + 0x06), 0x05, "(rec+6) rolled down on borrow");
  console.log("  WRITE-SET: countdown reloaded + 14 state bytes forced active");
});

test("WRITE-SET: a still-animating tick advances (rec+5) and holds the animation", () => {
  const after = craftAnimating(false);
  oracle(after);
  assert.equal(after.mem.read8(REC + 0x05), 0x10 - 0x04, "(rec+5) advanced by (rec+9)");
  assert.equal(after.mem.read8(REC + 0x06), 0x0a, "(rec+6) unchanged (no borrow)");
  assert.equal(after.mem.read8(REC + 0x0e), 0x04, "animation hold decremented by the composed tick");
  console.log("  WRITE-SET: animating advanced (rec+5), held the animation");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a twin that reports the reset as 'continue' (true) is rejected by the boolean check", () => {
  function brokenContinue(m) {
    tickEnemyAnimAndReseedPoolAtCycleEnd(m);
    return true; // BUG: a reset must abort the walk -> false
  }
  const c = craftReset(true);
  assert.throws(
    () => assert.equal(brokenContinue(c), false),
    "the boolean contract must reject a reset reported as 'continue'",
  );
  console.log("  TEETH/boolean: a reset-returns-true twin is caught");
});

test("TEETH: a wrong reset byte is caught by the RAM diff", () => {
  const o = craftReset(true);
  const c = craftReset(true);
  oracle(o);
  tickEnemyAnimAndReseedPoolAtCycleEnd(c);
  c.mem.write8(COUNTDOWN, 0x99); // BUG: the reset must load 0x20

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate FAILED to catch a wrong reset byte — worthless");
  assert.equal(d.addr, COUNTDOWN, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong reset byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
