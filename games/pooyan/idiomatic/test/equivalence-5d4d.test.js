// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for scanProximityTargetPairsAgainstSource — the CALLER that dissolves the testTargetPairOverlapAndClaimRecord skip.
 *
 * scanProximityTargetPairsAgainstSource scans three target/record pairs against a fixed source object. In the
 * frozen oracle the skip's `pop af; ret` aborts the scan two frames up; the idiomatic
 * caller instead early-returns when the real idiomatic testTargetPairOverlapAndClaimRecord returns false. This
 * gate COMPOSES the real idiomatic skip (the module under test imports it) and checks
 * that oracle and module land byte-identical in RAM (dumpState, minus stack scratch below the entry SP).
 * scanProximityTargetPairsAgainstSource has no register live-out (its caller ignores its registers), so only RAM
 * is compared.
 *
 * Two situations are seated, per the cluster brief: the skip TAKEN (a hit aborts the
 * scan) and NOT taken (all three pairs checked). The taken cases place a would-hit
 * pair AFTER the hit so a failure to abort would seed an extra record — observable in
 * RAM. All three abort positions (first / middle / last pair) are exercised.
 *
 * Jobs:
 *   1. EQUAL — for each seated state, oracle == module in RAM (−stack); plus the
 *      oracle contract is asserted (hit record seeded, later records untouched).
 *   2. TEETH — a failure to abort (a later record wrongly seeded) is caught; a wrong
 *      byte in the hit record is caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5d4d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5d4d as oracle } from "../../translated/loc_5d4d.js";
import { scanProximityTargetPairsAgainstSource } from "../scanProximityTargetPairsAgainstSource.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  PROXIMITY_SOURCE_OBJECT,
  SPRITE_TARGET_SLOTS,
  PROJECTILE_TABLE,
  FLIP_SCREEN_FLAG,
  GAME_ACTIVE_FLAG,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

const SOURCE = PROXIMITY_SOURCE_OBJECT;
const TARGET_STRIDE = 0x04;
const RECORD_STRIDE = 0x18;
const SP0 = 0x8fe0; // inside STACK_SCRATCH; the oracle pushes/pops its skip frames here
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

const targetSlot = (i) => (SPRITE_TARGET_SLOTS + i * TARGET_STRIDE) & 0xffff;
const recordSlot = (i) => (PROJECTILE_TABLE + i * RECORD_STRIDE) & 0xffff;

// A pair that HITS (upright: boxX=0x7c, boxY=0x40, |dx|=0, |dy|=0x0a) vs one that misses (|dx| large).
const HIT_PAIR = { x: 0x7c, y: 0x42 };
const MISS_PAIR = { x: 0x70, y: 0x42 };
const SRC_X = 0x80;
const SRC_Y = 0x40;

/** Seat the source, the three target slots and their record state bytes, on a fresh clone. */
function craft({ targets, records, flip = 1, gameActive = 0 }) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(SP0, 0x00); // dummy return frames in dead stack
  m.mem.write8(SP0 + 1, 0x00);
  m.mem.write8(SP0 + 2, 0x00);
  m.mem.write8(SP0 + 3, 0x00);
  m.mem.write8(FLIP_SCREEN_FLAG, flip);
  m.mem.write8(GAME_ACTIVE_FLAG, gameActive);
  m.mem.write8(SOURCE, SRC_X);
  m.mem.write8((SOURCE + 2) & 0xffff, SRC_Y);
  for (let i = 0; i < 3; i++) {
    m.mem.write8(targetSlot(i), targets[i].x);
    m.mem.write8((targetSlot(i) + 2) & 0xffff, targets[i].y);
    m.mem.write8(recordSlot(i), records[i]);
  }
  return m;
}

// records all active (state 1); target geometry decides hit/miss per pair.
const STATES = [
  {
    name: "not taken (all three pairs miss)",
    state: { targets: [MISS_PAIR, MISS_PAIR, MISS_PAIR], records: [1, 1, 1] },
    hitAt: -1,
  },
  {
    name: "taken at pair 0 (immediate abort; pairs 1,2 would hit)",
    state: { targets: [HIT_PAIR, HIT_PAIR, HIT_PAIR], records: [1, 1, 1] },
    hitAt: 0,
  },
  {
    name: "taken at pair 1 (abort mid-scan; pair 2 would hit)",
    state: { targets: [MISS_PAIR, HIT_PAIR, HIT_PAIR], records: [1, 1, 1] },
    hitAt: 1,
  },
  {
    name: "taken at pair 2 (abort on the last pair)",
    state: { targets: [MISS_PAIR, MISS_PAIR, HIT_PAIR], records: [1, 1, 1] },
    hitAt: 2,
  },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: composed module RAM (−stack) matches the oracle for taken + not-taken scans", () => {
  for (const { name, state, hitAt } of STATES) {
    const o = craft(state);
    const c = craft(state);
    oracle(o);
    scanProximityTargetPairsAgainstSource(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} module=${d.b}`);

    // oracle-side contract: the hit record is seeded to 0; every later record is untouched (abort).
    if (hitAt >= 0) {
      assert.equal(o.mem.read8(recordSlot(hitAt)), 0x00, `${name}: hit record ${hx(recordSlot(hitAt))} must be seeded`);
      for (let j = hitAt + 1; j < 3; j++) {
        assert.equal(o.mem.read8(recordSlot(j)), 0x01, `${name}: record ${hx(recordSlot(j))} must be untouched after the abort`);
      }
    } else {
      for (let j = 0; j < 3; j++) {
        assert.equal(o.mem.read8(recordSlot(j)), 0x01, `${name}: record ${hx(recordSlot(j))} must stay active on a full no-hit scan`);
      }
    }
  }
  console.log(`  EQUAL: ${STATES.length} states identical (RAM −stack), abort semantics asserted`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a failure to abort (a later record wrongly seeded) is caught", () => {
  const { state } = STATES[2]; // taken at pair 1; pair 2 would hit if the scan did not abort
  const o = craft(state);
  const c = craft(state);
  oracle(o);
  scanProximityTargetPairsAgainstSource(c);
  assert.equal(c.mem.read8(recordSlot(2)), 0x01, "sanity: the aborting scan left the later record untouched");
  c.mem.write8(recordSlot(2), 0x00); // BUG: a non-aborting scan would seed pair 2's record too
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a failure to abort — it is worthless");
  assert.equal(d.addr, recordSlot(2), `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(recordSlot(2))})`);
  console.log(`  TEETH/ABORT: an unseated abort (record ${hx(recordSlot(2))} seeded) is caught`);
});

test("TEETH: a wrong byte in the hit record is caught by the RAM diff", () => {
  const { state } = STATES[1]; // taken at pair 0
  const o = craft(state);
  const c = craft(state);
  oracle(o);
  scanProximityTargetPairsAgainstSource(c);
  c.mem.write8((recordSlot(0) + 2) & 0xffff, 0x00); // BUG: this field must be 0x0c on a hit
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong hit-record byte");
  assert.equal(d.addr, (recordSlot(0) + 2) & 0xffff, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong hit-record byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
