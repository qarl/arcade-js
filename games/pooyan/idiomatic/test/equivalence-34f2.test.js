// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceObjectColumnByStepAndDispatch (ROM 0x34f2, Pooyan) — "advance sub-position, branch on the
 * masked column".
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and advanceObjectColumnByStepAndDispatch on the other, compared on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/
 * cycles are deliberately not compared, and there is NO register live-out: the dispatch caller
 * (moveFormationAndSpawnObject) reloads A from the record the instant advanceObjectColumnByStepAndDispatch returns and reads no other register back,
 * so the whole contract is memory.
 *
 * INPUTS: IX (the object record) plus the record fields it reads — step (0x0a), sub-position (0x05),
 * column byte (0x06), arm byte (0x08), aim (0x09) — and two shared cells: the turn-column limit
 * (0x8d4b) and the play sub-state index (0x880a). Several exit paths tail into despawnActorAndRenderStageCountdown / armInteriorBandOrMarkActorActive,
 * whose memory work is part of the contract; the machine dispatches those (idiomatic ROUTINES) on the
 * oracle side exactly as the module imports them, so the tail work matches cell-for-cell.
 *
 * The leaf is not reached in a plain boot, so every case is CRAFTED (identical pokes on both sides).
 * Cases 1-8 use step 0 (no borrow, no net move) to steer the column/limit branch cleanly; case 9
 * exercises the borrow-into-column + sub-position add.
 *
 * Jobs:
 *   1. EQUAL — crafted states covering all branch arms, oracle == advanceObjectColumnByStepAndDispatch in RAM (−stack).
 *   2. WRITE-SET — the disarm arm writes exactly the one arm byte (0x08).
 *   3. TEETH — a wrong disarm byte and a wrong advanced sub-position are each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-34f2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_34f2 as oracle } from "../../translated/loc_34f2.js";
import { advanceObjectColumnByStepAndDispatch } from "../advanceObjectColumnByStepAndDispatch.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; //          an enemy-actor record base (real arena slot)
const TURN_COLUMN_LIMIT = 0x8d4b;
const PLAY_STATE_INDEX = 0x880a;
const OFF_POS = 0x05;
const OFF_COL = 0x06;
const OFF_ARM = 0x08;
const OFF_AIM = 0x09;
const OFF_STEP = 0x0a;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with IX=REC, the record fields and the two shared cells seated from `f`. */
function craft(f) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; the oracle's call/ret only touch it there
  m.mem8[REC + OFF_POS] = f.pos ?? 0x00;
  m.mem8[REC + OFF_COL] = f.col ?? 0x00;
  m.mem8[REC + OFF_ARM] = f.arm ?? 0x00;
  m.mem8[REC + OFF_AIM] = f.aim ?? 0x00;
  m.mem8[REC + OFF_STEP] = f.step ?? 0x00;
  m.mem8[TURN_COLUMN_LIMIT] = f.limit ?? 0x00;
  m.mem8[PLAY_STATE_INDEX] = f.play ?? 0x00;
  return m;
}

// step 0 => no borrow, no move, so col is exactly the poked (0x06)&0x1f and newPos == pos.
const CASES = [
  { name: "col<limit, col==0 -> tail despawnActorAndRenderStageCountdown", f: { col: 0x00, limit: 0x05, play: 0x04 } },
  { name: "col<limit, col!=0, play!=4 -> ret", f: { col: 0x02, limit: 0x05, play: 0x01 } },
  { name: "col<limit, col!=0, play==4 -> disarm", f: { col: 0x03, limit: 0x05, play: 0x04, arm: 0xaa } },
  { name: "col==limit, col==0 -> tail despawnActorAndRenderStageCountdown", f: { col: 0x00, limit: 0x00, play: 0x04 } },
  { name: "col==limit, col!=0, play==4, aim>=newPos -> tail armInteriorBandOrMarkActorActive", f: { col: 0x04, limit: 0x04, play: 0x04, aim: 0x80, pos: 0x10 } },
  { name: "col==limit, col!=0, play==4, aim<newPos -> ret", f: { col: 0x04, limit: 0x04, play: 0x04, aim: 0x05, pos: 0x80 } },
  { name: "col==limit, col!=0, play!=4 -> ret", f: { col: 0x04, limit: 0x04, play: 0x02 } },
  { name: "col>limit -> ret", f: { col: 0x10, limit: 0x05, play: 0x04 } },
  { name: "borrow + add (step 2)", f: { step: 0x02, pos: 0x10, col: 0x08, limit: 0x07, play: 0x01 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted branch arms — advanceObjectColumnByStepAndDispatch == oracle in RAM (−stack)", () => {
  for (const cse of CASES) {
    const o = craft(cse.f);
    oracle(o);
    const c = craft(cse.f);
    advanceObjectColumnByStepAndDispatch(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted branch arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the disarm arm writes exactly the arm byte (0x08)", () => {
  const f = { col: 0x03, limit: 0x05, play: 0x04, arm: 0xaa }; // col<limit, col!=0, play==4
  const before = craft(f);
  const after = craft(f);
  const b = before.dumpState();
  oracle(after);
  const a = after.dumpState();

  const changed = [];
  for (let off = 0; off < b.length; off++) {
    const ad = after.stateOffsetToAddr(off);
    if (b[off] !== a[off] && !inDeadStack(ad)) changed.push(ad);
  }
  assert.equal(changed.length, 1, `expected exactly 1 write, got ${changed.length} (${changed.map(hx).join(",")})`);
  assert.equal(changed[0], REC + OFF_ARM, `the one write must be the arm byte, got ${hx(changed[0])}`);
  assert.equal(after.mem8[REC + OFF_ARM], 0x00, "the arm byte must be cleared to 0");
  console.log(`  WRITE-SET: ${hx(REC + OFF_ARM)} := 0 (1 cell)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong disarm byte is CAUGHT by the RAM diff", () => {
  const f = { col: 0x03, limit: 0x05, play: 0x04, arm: 0xaa };
  const o = craft(f);
  const c = craft(f);
  oracle(o);
  advanceObjectColumnByStepAndDispatch(c);
  c.mem8[REC + OFF_ARM] = 0x01; // BUG: the arm byte must be 0

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong disarm byte — it is worthless");
  assert.equal(d.addr, REC + OFF_ARM, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(REC + OFF_ARM)})`);
  console.log(`  TEETH/RAM: wrong disarm byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced sub-position is CAUGHT by the RAM diff", () => {
  const f = { step: 0x02, pos: 0x10, col: 0x08, limit: 0x07, play: 0x01 }; // borrow + add path
  const o = craft(f);
  const c = craft(f);
  oracle(o);
  advanceObjectColumnByStepAndDispatch(c);
  c.mem8[REC + OFF_POS] = 0x00; // BUG: the advanced sub-position must be 0x12

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong advanced sub-position — it is worthless");
  assert.equal(d.addr, REC + OFF_POS, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(REC + OFF_POS)})`);
  assert.equal(o.mem8[REC + OFF_POS], 0x12, "oracle advanced the sub-position 0x10 -> 0x12");
  console.log(`  TEETH/RAM: wrong sub-position caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
