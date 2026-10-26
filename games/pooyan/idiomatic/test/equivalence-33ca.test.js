// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seatTurnAnimationFromColumnLimit (ROM 0x33ca, Pooyan) — the shared "turn-select" tail (also
 * advanceEnemyState0AndArmFlapReset's fall-through and its 0x3407 call target). Looks the low nibble of the spawn-phase
 * snapshot up in the rst-0x20 byte table (0x3418), latches the value as the turn-column limit, and
 * compares it against the record's target column (rec+0x06): above -> frame 0 + straight table
 * (0x3829); below -> frame 1 + turn table (0x3838); equal -> gate on the aim (rec+0x09) vs the
 * sub-position (rec+0x05), seating frame=aim + 0x3838 when the aim is below, else deferring to
 * armInteriorBandOrMarkActorActive. Every non-defer arm writes rec+0x08 and installs the animation (setActorAnimation).
 *
 * Cycle-free / memory-equivalence gate: a fresh clone per side, oracle on one and seatTurnAnimationFromColumnLimit on the
 * other, compared on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared, and there
 * is NO register live-out (the record-dispatch caller reloads A on return and reads no other register
 * back). The oracle's rst-0x20 lookup and its armInteriorBandOrMarkActorActive tail call/push/ret land inside STACK_SCRATCH.
 *
 * The 0x3418 table's phase-0 entry is read from ROM so the crafted targets steer each branch
 * deterministically. The leaf is not reached in a plain boot, so every case is CRAFTED (identical
 * pokes on both sides), the record pre-dirtied to 0xAA so every real write is observable.
 *
 * Jobs:
 *   1. EQUAL — the three limit-vs-target arms plus the equal/defer(armInteriorBandOrMarkActorActive) arm agree in RAM (−stack).
 *   2. WRITE-SET — the limit>target arm writes exactly the limit cell + rec+0x08 + the anim triple.
 *   3. TEETH — a wrong frame byte and a wrong limit cell are each CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the idiomatic call returns SP-neutral (seam-placeable); a leaked stack word is NOT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-33ca.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_33ca as oracle } from "../../translated/loc_33ca.js";
import { seatTurnAnimationFromColumnLimit } from "../seatTurnAnimationFromColumnLimit.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ANIM_TABLE_3418,
  TURN_COLUMN_LIMIT,
  SPAWN_PHASE_SNAPSHOT,
  ANIM_ARMED_LATCH,
  ANIM_TABLE_3829,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b60; //          work-RAM record base (IX); disjoint from every shared cell touched
const REC_LEN = 0x18;
const OFF_SUBPOS = 0x05;
const OFF_TARGET = 0x06;
const OFF_FRAME = 0x08;
const OFF_AIM = 0x09;
const OFF_ANIM = 0x0c; // little-endian anim pointer + frame index (0x0c/0x0d/0x0e)
const DIRT = 0xaa;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0); // the RAM diffs all enter at the craft seat
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
// phase-0 rst-0x20 limit, read straight from the ROM table so the crafted targets steer each arm.
const LIMIT0 = ROM_PRESENT ? BASE.mem.read8(ANIM_TABLE_3418) : 0;

/** A fresh clone: record pre-dirtied, control fields + shared cells seated, IX=REC, SP in dead stack. */
function craft(f) {
  const m = BASE.clone();
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, DIRT);
  m.mem.write8(REC + OFF_SUBPOS, f.subpos ?? DIRT);
  m.mem.write8(REC + OFF_TARGET, f.target ?? DIRT);
  m.mem.write8(REC + OFF_AIM, f.aim ?? DIRT);
  m.mem.write8(SPAWN_PHASE_SNAPSHOT, f.phase ?? 0x00);
  m.mem.write8(TURN_COLUMN_LIMIT, DIRT); // sentinel so the limit write is observable
  m.mem.write8(ANIM_ARMED_LATCH, f.armed ?? 0x00);
  m.regs.ix = REC;
  m.regs.sp = 0x8fe0; // deep in STACK_SCRATCH: the rst-0x20 lookup + armInteriorBandOrMarkActorActive tail stay inside
  return m;
}

const CASES = [
  { name: "limit>target -> frame0 + 0x3829", f: { target: LIMIT0 - 1 } },
  { name: "limit<target -> frame1 + 0x3838", f: { target: LIMIT0 + 1 } },
  { name: "limit==target, aim<subpos -> frame=aim + 0x3838", f: { target: LIMIT0, aim: 0x03, subpos: 0x10 } },
  { name: "limit==target, aim>=subpos -> defer armInteriorBandOrMarkActorActive", f: { target: LIMIT0, aim: 0x20, subpos: 0x10, armed: 0x01 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted limit-vs-target arms — seatTurnAnimationFromColumnLimit == oracle in RAM (−stack)", () => {
  for (const cse of CASES) {
    const o = craft(cse.f);
    oracle(o);
    const c = craft(cse.f);
    seatTurnAnimationFromColumnLimit(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted branch arms identical (RAM −stack); LIMIT0=${hx(LIMIT0)}`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the limit>target arm writes exactly the limit cell + rec+0x08 + the anim triple", () => {
  const f = { target: LIMIT0 - 1 }; // frame 0 + straight table 0x3829, no armInteriorBandOrMarkActorActive tail
  const before = craft(f);
  const after = craft(f);
  const b = before.dumpState();
  seatTurnAnimationFromColumnLimit(after);
  const a = after.dumpState();

  const changed = [];
  for (let off = 0; off < b.length; off++) {
    const ad = after.stateOffsetToAddr(off);
    if (b[off] !== a[off] && !inDeadStack(ad)) changed.push(ad);
  }
  const expected = [TURN_COLUMN_LIMIT, REC + OFF_FRAME, REC + OFF_ANIM, REC + OFF_ANIM + 1, REC + OFF_ANIM + 2]
    .sort((x, y) => x - y);
  assert.deepEqual(changed.sort((x, y) => x - y), expected, `unexpected footprint: ${changed.map(hx)}`);
  assert.equal(after.mem8[TURN_COLUMN_LIMIT], LIMIT0, "limit latched to the table value");
  assert.equal(after.mem8[REC + OFF_FRAME], 0x00, "frame index = 0 (limit > target)");
  assert.equal(after.mem8[REC + OFF_ANIM], ANIM_TABLE_3829 & 0xff, "anim pointer low = 0x3829");
  assert.equal(after.mem8[REC + OFF_ANIM + 1], (ANIM_TABLE_3829 >> 8) & 0xff, "anim pointer high = 0x3829");
  assert.equal(after.mem8[REC + OFF_ANIM + 2], 0x00, "anim frame index reset to 0");
  console.log(`  WRITE-SET: limit>target -> limit=${hx(LIMIT0)}, frame=0, anim->${hx(ANIM_TABLE_3829)} (5 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong frame byte is CAUGHT by the RAM diff", () => {
  const f = { target: LIMIT0 - 1 };
  const o = craft(f);
  const c = craft(f);
  oracle(o);
  seatTurnAnimationFromColumnLimit(c);
  c.mem8[REC + OFF_FRAME] = 0x01; // BUG: the limit>target arm sets frame 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong frame byte — it is worthless");
  assert.equal(d.addr, REC + OFF_FRAME, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong frame byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong turn-column-limit cell is CAUGHT by the RAM diff", () => {
  const f = { target: LIMIT0 - 1 };
  const o = craft(f);
  const c = craft(f);
  oracle(o);
  seatTurnAnimationFromColumnLimit(c);
  c.mem8[TURN_COLUMN_LIMIT] = (LIMIT0 ^ 0x01) & 0xff; // BUG: limit must be the table value
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong limit cell — it is worthless");
  assert.equal(d.addr, TURN_COLUMN_LIMIT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong limit cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: seatTurnAnimationFromColumnLimit returns SP-neutral (seam-placeable); a leaked stack word is NOT (self-proving)", () => {
  const CALLER_RET = 0xfffc;
  const entry = () => {
    const m = craft({ target: LIMIT0 - 1 });
    m.regs.sp = 0x8ff0; // a caller-return word the seam consumes
    m.mem.write16(0x8ff0, CALLER_RET);
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, seatTurnAnimationFromColumnLimit, 0x33ca, entry());
  assert.equal(ok.placeable, true, `the dispatch tail must be seam-placeable; got: ${ok.error}`);

  const leaky = (mm, rec) => { mm.push16(0x0000); return seatTurnAnimationFromColumnLimit(mm, rec); };
  const bad = seamPlaceable(withOmittedRet, leaky, 0x33ca, entry());
  assert.equal(bad.placeable, false, "SP-tooth null-mutant: a leaked stack word MUST NOT be placeable");
  console.log("  SP-TOOTH: seatTurnAnimationFromColumnLimit seam-placeable (moved 0); leaked-push mutant caught (not placeable)");
});
