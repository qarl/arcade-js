// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for scanEnemyRecordsForCollision — the CALLER that dissolves the per-record collision skip.
 *
 * scanEnemyRecordsForCollision sweeps the collision check (testEnemyRecordHitAndRegister) across the six enemy-actor records (stride 0x18).
 * In the frozen oracle a hit's `pop af; ret` aborts the sweep and unwinds one frame up; the
 * idiomatic caller instead early-returns when the real idiomatic testEnemyRecordHitAndRegister returns false. This gate
 * COMPOSES the real idiomatic skip (the module under test imports it) and checks that oracle and
 * module land byte-identical in RAM (dumpState, minus stack scratch below the entry SP). scanEnemyRecordsForCollision has no register
 * live-out (its registers are loop artifacts), so only RAM is compared; SP sits in STACK_SCRATCH so
 * the oracle's skip frames drop out of the diff.
 *
 * Every record is seated inactive by default (guard-fail, no writes). A hit is seated per the
 * validated geometry: armed (+0x0b bit0), active (+0 bit0), flagged (+0x16 bit0), mode 5 (+2), with
 * a within-range object pair at 0x8c90 — the hit stamps +0x12=0x10 and +0x16=0x02. Taken-abort at
 * the first / a middle / the last record is exercised, plus a full no-hit sweep.
 *
 * Jobs:
 *   1. EQUAL — for each seated state, oracle == module in RAM (−stack); the hit record is stamped
 *      and every later record is untouched (abort).
 *   2. TEETH — a failure to abort (a later record wrongly stamped) is caught; a wrong byte in the
 *      hit record is caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5b86.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5b86 as oracle } from "../../translated/loc_5b86.js";
import { scanEnemyRecordsForCollision } from "../scanEnemyRecordsForCollision.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const STRIDE = 0x18;
const COUNT = 6;
const OBJPAIR = 0x8c90; // the two-entry object pair testEnemyRecordHitAndRegister tests against
const FLIP = 0x881f;
const ROUND = 0x8907;
const SP0 = 0x8fe0; // inside STACK_SCRATCH; the oracle pushes/pops its skip frames here

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const rec = (k) => (ENEMY_ACTOR_TABLE + k * STRIDE) & 0xffff;
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat record k so testEnemyRecordHitAndRegister registers a hit against the 0x8c90 pair (validated geometry). */
function seatHit(m, k) {
  const ix = rec(k);
  m.mem.write8(ix + 0x00, 0x01); // active
  m.mem.write8(ix + 0x02, 0x05); // mode 5
  m.mem.write8(ix + 0x03, 0x40); // dy: scaled = (0x02<<3)|(0x40>>5) = 0x12
  m.mem.write8(ix + 0x04, 0x02);
  m.mem.write8(ix + 0x05, 0x00); // dx: scaled = 0
  m.mem.write8(ix + 0x06, 0x00);
  m.mem.write8(ix + 0x07, 0x00); // hit-sprite bit1 clear
  m.mem.write8(ix + 0x0b, 0x01); // armed
  m.mem.write8(ix + 0x14, 0xaa); // slot id: no match in the 0x8b70 table -> simple hit exit
  m.mem.write8(ix + 0x16, 0x01); // flagged (hit stamps this to 0x02)
}

/** Fresh clone: SP in dead stack, shared bits benign, all six records inactive. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  for (let i = 0; i < 8; i++) m.mem.write8(SP0 + i, 0x00); // dummy dead-stack return frames
  m.mem.write8(FLIP, 0x00); // dx bias e = 0x08
  m.mem.write8(ROUND, 0x00); // dy bias e2 = 0x12; guard-1 armed path
  m.mem.write8(OBJPAIR + 0x00, 0x01); // pair entry present, not busy
  m.mem.write8(OBJPAIR + 0x04, 0x00);
  m.mem.write8(OBJPAIR + 0x06, 0x00);
  for (let k = 0; k < COUNT; k++) m.mem.write8(rec(k), 0x00); // inactive
  return m;
}

const STATES = [
  { name: "no hit (all six inactive -> full sweep)", hits: [], hitAt: -1 },
  { name: "hit at record 0 (immediate abort)", hits: [0], hitAt: 0 },
  { name: "hit at record 3 (abort mid-sweep)", hits: [3], hitAt: 3 },
  { name: "hit at record 5 (abort on the last record)", hits: [5], hitAt: 5 },
];

function build({ hits }) {
  const m = craft();
  for (const k of hits) seatHit(m, k);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: composed module RAM (−stack) matches the oracle for taken + not-taken sweeps", () => {
  for (const { name, hits, hitAt } of STATES) {
    const o = build({ hits });
    const c = build({ hits });
    oracle(o);
    scanEnemyRecordsForCollision(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} module=${d.b}`);
    if (hitAt >= 0) {
      assert.equal(o.mem.read8(rec(hitAt) + 0x16), 0x02, `${name}: hit record ${hx(rec(hitAt))} must be stamped`);
      assert.equal(o.mem.read8(rec(hitAt) + 0x12), 0x10, `${name}: hit record ${hx(rec(hitAt))} +0x12 must be stamped`);
    }
  }
  console.log(`  EQUAL: ${STATES.length} sweeps identical (RAM −stack), hit stamp asserted`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a failure to abort (a later record wrongly swept) is caught", () => {
  // hit at 3, and a would-hit right after at 4: a non-aborting sweep would stamp record 4 too.
  const o = build({ hits: [3, 4] });
  const c = build({ hits: [3, 4] });
  oracle(o);
  scanEnemyRecordsForCollision(c);
  assert.equal(c.mem.read8(rec(4) + 0x12), 0x00, "sanity: the aborting sweep left record 4 untouched");
  c.mem.write8(rec(4) + 0x12, 0x10); // BUG: a non-aborting sweep would stamp record 4 too
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a failure to abort — it is worthless");
  assert.equal(d.addr, (rec(4) + 0x12) & 0xffff, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(rec(4) + 0x12)})`);
  console.log(`  TEETH/ABORT: a non-aborting sweep (record 4 stamped) is caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong byte in the hit record is caught by the RAM diff", () => {
  const o = build({ hits: [0] });
  const c = build({ hits: [0] });
  oracle(o);
  scanEnemyRecordsForCollision(c);
  c.mem.write8(rec(0) + 0x12, 0x00); // BUG: this field is 0x10 on a hit
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong hit-record byte");
  assert.equal(d.addr, (rec(0) + 0x12) & 0xffff, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong hit-record byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
