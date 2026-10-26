// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorXAndDispatchMove (ROM 0x3757, Pooyan) — advance an actor's X, then dispatch.
 *
 * A fresh clone per side, the oracle on one and advanceActorXAndDispatchMove on the other, compared on RAM (dumpState,
 * minus stack scratch below the entry SP) PLUS the declared register live-out A. pc/SP/cycles are not compared.
 *
 * INPUT: IX (the actor record). advanceActorXAndDispatchMove adds the signed step (rec+0x0a) to X (rec+0x05); when X is
 * below the negated step the lap counter (rec+0x06) is decremented first. It then tails into the
 * end-of-move dispatch (stage countdown >= 3) or the phase-state dispatch (countdown < 3, new X in B).
 * The end-of-move dispatch is a verified idiomatic module; the phase-state dispatch is a sibling
 * decompiled this same batch (its module resolves at reconcile).
 *
 * LIVE-OUT A: the counter/result the delegatee leaves (a 0x99 sentinel is seated so a stray write
 * would show). Both sides run the SAME delegatees, so those agree by construction; this gate exercises
 * advanceActorXAndDispatchMove's own X/counter arithmetic and branch selection.
 *
 * The routine is not reached in a plain boot, so every case is CRAFTED (identical pokes on both sides).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3757.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3757 as oracle } from "../../translated/loc_3757.js";
import { advanceActorXAndDispatchMove } from "../advanceActorXAndDispatchMove.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PLAY_STATE_INDEX, STAGE_COUNTDOWN } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b80; // isolated actor record base (rec..rec+0x17)
const SENTINEL_A = 0x99;
const REC_X = 0x05;
const REC_LAP = 0x06;
const REC_STEP = 0x0a;
const GLOBAL_PHASE_TIMER = 0x8d7d; // read by the phase-state dispatch; seated so it early-returns
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fee);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: IX=REC, zeroed record, A sentinel, SP inside STACK_SCRATCH, then pokes applied. */
function craft(pokes) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.a = SENTINEL_A;
  m.regs.sp = 0x8fee; // oracle's tail/ret only touch the stack inside STACK_SCRATCH
  for (let i = 0; i < 0x18; i++) m.mem8[REC + i] = 0x00;
  for (const [addr, val] of pokes) m.mem8[addr] = val & 0xff;
  return m;
}

// step/X/lap seat the arithmetic; PLAY_STATE_INDEX/STAGE_COUNTDOWN steer the delegate + branch.
const CASES = [
  {
    name: "no-dec (X>=-step); countdown>=3 -> end-of-move arm variant A",
    pokes: [[REC + REC_STEP, 0xfe], [REC + REC_X, 0x10], [REC + REC_LAP, 0x01],
            [REC + 0x07, 0x00], [STAGE_COUNTDOWN, 0x05], [PLAY_STATE_INDEX, 0x00]],
  },
  {
    name: "dec (X<-step); countdown>=3 -> end-of-move no-op (counter>=2)",
    pokes: [[REC + REC_STEP, 0x05], [REC + REC_X, 0x10], [REC + REC_LAP, 0x03],
            [STAGE_COUNTDOWN, 0x05], [PLAY_STATE_INDEX, 0x00]],
  },
  {
    name: "dec; finish phase, counter!=0 -> end-of-move no-op",
    pokes: [[REC + REC_STEP, 0x02], [REC + REC_X, 0x10], [REC + REC_LAP, 0x07],
            [STAGE_COUNTDOWN, 0x05], [PLAY_STATE_INDEX, 0x05]],
  },
  {
    name: "no-dec; countdown<3 -> phase-state dispatch (early-return path)",
    pokes: [[REC + REC_STEP, 0xfe], [REC + REC_X, 0x10], [REC + REC_LAP, 0x10],
            [STAGE_COUNTDOWN, 0x02], [GLOBAL_PHASE_TIMER, 0x0e]],
  },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted records — advanceActorXAndDispatchMove == oracle in RAM (−stack) + A", () => {
  for (const cse of CASES) {
    const o = craft(cse.pokes);
    const c = craft(cse.pokes);
    oracle(o);
    advanceActorXAndDispatchMove(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a, o.regs.a, `[${cse.name}] A live-out mismatch`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted records identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: advanceActorXAndDispatchMove itself writes exactly X and (on the dec branch) the lap counter", () => {
  // Case 1 (dec, end-of-move no-op): the delegate writes nothing, so only rec+5 and rec+6 change.
  const before = craft(CASES[1].pokes);
  const after = craft(CASES[1].pokes);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  assert.deepEqual(changed.sort((a, b) => a - b), [REC + REC_X, REC + REC_LAP],
    `expected only X(${hx(REC + REC_X)}) + lap(${hx(REC + REC_LAP)}) to change, got ${changed.map(hx)}`);
  assert.equal(after.mem8[REC + REC_X], 0x15, "X advanced 0x10 + 0x05 = 0x15");
  assert.equal(after.mem8[REC + REC_LAP], 0x02, "lap counter decremented 0x03 -> 0x02");
  console.log("  WRITE-SET: X + lap counter only");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong X byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[0].pokes);
  const c = craft(CASES[0].pokes);
  oracle(o);
  advanceActorXAndDispatchMove(c);
  c.mem8[REC + REC_X] = (c.mem8[REC + REC_X] + 1) & 0xff; // BUG: wrong advanced X
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong X byte — it is worthless");
  assert.equal(d.addr, REC + REC_X, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM(X): caught at ${hx(d.addr)}`);
});

test("TEETH: a skipped lap-counter decrement is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[1].pokes); // X < -step: the dec MUST happen
  const c = craft(CASES[1].pokes);
  oracle(o);
  advanceActorXAndDispatchMove(c);
  c.mem8[REC + REC_LAP] = (c.mem8[REC + REC_LAP] + 1) & 0xff; // BUG twin: as if the dec never ran
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing lap decrement");
  assert.equal(d.addr, REC + REC_LAP, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM(lap): caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong A live-out is CAUGHT by the live-out check", () => {
  const o = craft(CASES[2].pokes); // finish phase, counter!=0 -> A = counter
  const c = craft(CASES[2].pokes);
  oracle(o);
  advanceActorXAndDispatchMove(c);
  assert.equal(c.regs.a, o.regs.a, "sanity: module A matches the oracle before corruption");
  c.regs.a = (o.regs.a + 1) & 0xff; // BUG: wrong counter left in A
  assert.notEqual(c.regs.a, o.regs.a, "the A live-out check must reject a wrong counter");
  console.log(`  TEETH/A: wrong A ${hx((o.regs.a + 1) & 0xff)} rejected (oracle A=${hx(o.regs.a)})`);
});
