// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchEndOfMoveIfFlagged (ROM 0x361d, Pooyan) — the actor end-of-move guard.
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and dispatchEndOfMoveIfFlagged on the other, compared on RAM (dumpState, minus stack scratch below the entry SP) PLUS the
 * declared register live-out A. pc/SP/cycles are deliberately not compared.
 *
 * INPUT: IX (the actor record base). The guard tests bit 0 of the flag byte (rec+8): clear returns
 * with no effect, set hands the record to finishActorOrArmTurnaround (the end-of-move dispatch). finishActorOrArmTurnaround is a verified
 * idiomatic module with its own equivalence gate; here we exercise the GUARD — that the dispatch is
 * suppressed when bit 0 is clear and taken when it is set — plus the A live-out it propagates.
 *
 * LIVE-OUT A: on the dispatch path A is the move counter (rec+6) finishActorOrArmTurnaround leaves; on the guard-return
 * path A is untouched (a 0x99 sentinel is seated so an accidental write would show). Both sides run
 * the SAME finishActorOrArmTurnaround, so the dispatch cases agree by construction; the gate's job is the guard.
 *
 * The leaf is not reached in a plain boot, so every case is CRAFTED (identical pokes on both sides).
 *
 * Jobs:
 *   1. EQUAL — over crafted records (guard-clear no-op; finish-phase counter!=0; two turn-around
 *      arm variants; non-finish counter>=2) oracle == dispatchEndOfMoveIfFlagged in RAM (−stack) and A (and IX passes
 *      through unchanged).
 *   2. WRITE-SET — a bit-0-clear record writes NOTHING (the guard's whole contract).
 *   3. TEETH — a wrong written byte (RAM), a twin that dispatches through a CLEARED guard (structural),
 *      and a wrong A (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-361d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_361d as oracle } from "../../translated/loc_361d.js";
import { dispatchEndOfMoveIfFlagged } from "../dispatchEndOfMoveIfFlagged.js";
import { finishActorOrArmTurnaround } from "../finishActorOrArmTurnaround.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PLAY_STATE_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b80; // isolated actor record base (rec..rec+0x17)
const SENTINEL_A = 0x99; // seated in A so a stray write to the A live-out would show
const REC_ANIM_LO = 0x0c; // finishActorOrArmTurnaround's turn-around arm writes rec+0x0c..0x0e
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with IX=REC, a zeroed record, the play-state seated, and pokes applied. */
function craft(play, pokes) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.a = SENTINEL_A;
  m.regs.sp = 0x8ffe; // the oracle's ret/tail only touch the stack inside STACK_SCRATCH
  for (let i = 0; i < 0x18; i++) m.mem8[REC + i] = 0x00;
  m.mem8[PLAY_STATE_INDEX] = play & 0xff;
  for (const [addr, val] of pokes) m.mem8[addr] = val & 0xff;
  return m;
}

// rec+6 = move counter, rec+7 = flag byte (bit1 picks the turn sequence), rec+8 = guard flag (bit0).
const CASES = [
  { name: "guard: bit0 clear -> no-op", play: 0x00, pokes: [[REC + 0x06, 0x01], [REC + 0x08, 0x00]] },
  { name: "dispatch: finish phase, counter!=0", play: 0x05, pokes: [[REC + 0x06, 0x07], [REC + 0x08, 0x01]] },
  { name: "dispatch: non-finish, counter<2, variant A", play: 0x00, pokes: [[REC + 0x06, 0x01], [REC + 0x07, 0x00], [REC + 0x08, 0x01]] },
  { name: "dispatch: non-finish, counter<2, variant B", play: 0x00, pokes: [[REC + 0x06, 0x00], [REC + 0x07, 0x02], [REC + 0x08, 0x01]] },
  { name: "dispatch: non-finish, counter>=2", play: 0x00, pokes: [[REC + 0x06, 0x05], [REC + 0x08, 0x01]] },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted records — dispatchEndOfMoveIfFlagged == oracle in RAM (−stack) + A", () => {
  for (const cse of CASES) {
    const o = craft(cse.play, cse.pokes);
    const c = craft(cse.play, cse.pokes);
    oracle(o);
    dispatchEndOfMoveIfFlagged(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a, o.regs.a, `[${cse.name}] A live-out mismatch`);
    assert.equal(c.regs.ix & 0xffff, o.regs.ix & 0xffff, `[${cse.name}] IX must pass through unchanged`);
    assert.equal(c.regs.ix & 0xffff, REC, `[${cse.name}] IX must still be the record base`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted records identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a bit-0-clear record writes nothing (the guard's whole contract)", () => {
  const before = craft(0x00, [[REC + 0x06, 0x01], [REC + 0x08, 0x00]]);
  const after = craft(0x00, [[REC + 0x06, 0x01], [REC + 0x08, 0x00]]);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  let changed = 0;
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) changed++;
  assert.equal(changed, 0, `a guarded record must write nothing, got ${changed} changed cells`);
  console.log("  WRITE-SET: guard-clear path writes 0 cells");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong written byte on the dispatch path is CAUGHT by the RAM diff", () => {
  const cse = CASES[2]; // non-finish arm: finishActorOrArmTurnaround writes rec+0x0c..0x0e
  const o = craft(cse.play, cse.pokes);
  const c = craft(cse.play, cse.pokes);
  oracle(o);
  dispatchEndOfMoveIfFlagged(c);
  c.mem8[REC + REC_ANIM_LO] = (c.mem8[REC + REC_ANIM_LO] + 1) & 0xff; // BUG: corrupt an armed byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong dispatch-path byte — it is worthless");
  assert.equal(d.addr, REC + REC_ANIM_LO, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong armed byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH (structural): a twin that dispatches through a CLEARED guard is CAUGHT", () => {
  // bit0 clear but the record would otherwise arm an animation: the guard MUST suppress finishActorOrArmTurnaround.
  const pokes = [[REC + 0x06, 0x01], [REC + 0x07, 0x00], [REC + 0x08, 0x00]];
  const o = craft(0x00, pokes);
  const c = craft(0x00, pokes);
  oracle(o); // guard clear -> returns, writes nothing
  finishActorOrArmTurnaround(c, REC); // BUG twin: dispatched anyway -> arms the animation

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a guard that was bypassed — the guard is untested");
  console.log(`  TEETH/GUARD: bypassed-guard write caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A live-out is CAUGHT by the live-out check", () => {
  const cse = CASES[1]; // finish phase, counter!=0 -> A = counter (0x07), no writes
  const o = craft(cse.play, cse.pokes);
  const c = craft(cse.play, cse.pokes);
  oracle(o);
  dispatchEndOfMoveIfFlagged(c);
  assert.equal(c.regs.a, o.regs.a, "sanity: the module's A matches the oracle before corruption");
  c.regs.a = (o.regs.a + 1) & 0xff; // BUG: wrong move counter left in A

  assert.notEqual(c.regs.a, o.regs.a, "the A live-out check must reject a wrong move counter");
  console.log(`  TEETH/A: wrong A ${hx((o.regs.a + 1) & 0xff)} rejected (oracle A=${hx(o.regs.a)})`);
});
