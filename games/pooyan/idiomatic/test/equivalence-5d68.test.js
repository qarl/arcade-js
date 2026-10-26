// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for testTargetPairOverlapAndClaimRecord — the DISSOLVED caller-skip of scanProximityTargetPairsAgainstSource.
 *
 * The frozen oracle ends its no-hit paths with a plain `ret` and its hit path with
 * `pop af; ret` (discarding its own return address so control resumes two frames up).
 * The idiomatic module drops that stack plumbing and returns a BOOLEAN instead:
 *   true  = the no-hit / plain-ret path (the caller keeps scanning),
 *   false = the hit / pop-af-ret path   (the caller aborts its scan).
 *
 * The contract compared each case is RAM (dumpState, minus stack scratch below the entry SP) PLUS the
 * boolean return. There is no register live-out (a caller reloads DE and reads only
 * the preserved pointers), so registers are not compared. Which oracle path ran is
 * derived independently from the oracle's SP movement: a plain `ret` pops once
 * (SP += 2); `pop af; ret` pops twice (SP += 4). The module's boolean must match.
 *
 * Jobs:
 *   1. EQUAL — over one input per path (state-empty, state-5, |dx| too big, |dy| too
 *      small, |dy| too big, in-range hit upright, in-range hit flipped, in-range hit
 *      with the ring-append gate open) the module's RAM (−stack) and boolean match
 *      the oracle, cross-checked against the oracle's SP-derived path.
 *   2. WRITE-SET — on a hit the record's fields (+0/+1/+2/+7) and its post-hit handler
 *      pointer (+0x12/+0x13) take their seeded values.
 *   3. TEETH — a wrong record byte is caught by the RAM diff; a flipped boolean is
 *      rejected by the path check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5d68.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5d68 as oracle } from "../../translated/loc_5d68.js";
import { testTargetPairOverlapAndClaimRecord } from "../testTargetPairOverlapAndClaimRecord.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  PROXIMITY_SOURCE_OBJECT,
  SPRITE_TARGET_SLOTS,
  PROJECTILE_TABLE,
  FLIP_SCREEN_FLAG,
  GAME_ACTIVE_FLAG,
  PROXIMITY_HIT_HANDLER,
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

const SOURCE = PROXIMITY_SOURCE_OBJECT; // IX: fixed source object (X @+0, Y @+2)
const TARGET = SPRITE_TARGET_SLOTS; // IY: one target slot (X @+0, Y @+2)
const RECORD = PROJECTILE_TABLE; // HL: one object record (state @+0)
const SP0 = 0x8fe0; // inside STACK_SCRATCH, with head/foot room for the hit path's pushes/pops
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

/** Seat the routine's three pointer registers + the memory cells it reads, on a fresh clone. */
function craft({ srcX = 0, srcY = 0, tgtX = 0, tgtY = 0, recState = 1, flip = 1, gameActive = 0 }) {
  const m = BASE.clone();
  m.regs.ix = SOURCE;
  m.regs.iy = TARGET;
  m.regs.hl = RECORD;
  m.regs.sp = SP0;
  // dummy return frames in dead stack (the oracle's ret / pop-af read these)
  m.mem.write8(SP0, 0x00);
  m.mem.write8(SP0 + 1, 0x00);
  m.mem.write8(SP0 + 2, 0x00);
  m.mem.write8(SP0 + 3, 0x00);
  m.mem.write8(FLIP_SCREEN_FLAG, flip);
  m.mem.write8(GAME_ACTIVE_FLAG, gameActive);
  m.mem.write8(SOURCE, srcX);
  m.mem.write8((SOURCE + 2) & 0xffff, srcY);
  m.mem.write8(TARGET, tgtX);
  m.mem.write8((TARGET + 2) & 0xffff, tgtY);
  m.mem.write8(RECORD, recState);
  return m;
}

// flip=1 (upright) => boxX = srcX-4, boxY = srcY. flip=0 => boxX = srcX+5, boxY = srcY+0x10.
// hit needs state != {0,5}, |tgtX-boxX| < 4, and |(tgtY+8)-boxY| in [9,0x0f).
const CASES = [
  { name: "state 0 -> no-hit", input: { recState: 0 }, expect: true },
  { name: "state 5 -> no-hit", input: { recState: 5 }, expect: true },
  { name: "|dx|>=4 -> no-hit", input: { recState: 1, srcX: 0x80, srcY: 0x40, tgtX: 0x70, tgtY: 0x42 }, expect: true },
  { name: "|dy|<9 -> no-hit", input: { recState: 1, srcX: 0x80, srcY: 0x40, tgtX: 0x7c, tgtY: 0x40 }, expect: true },
  { name: "|dy|>=0x0f -> no-hit", input: { recState: 1, srcX: 0x80, srcY: 0x40, tgtX: 0x7c, tgtY: 0x48 }, expect: true },
  { name: "in-range HIT (upright)", input: { recState: 1, srcX: 0x80, srcY: 0x40, tgtX: 0x7c, tgtY: 0x42 }, expect: false },
  { name: "in-range HIT (flipped)", input: { recState: 1, srcX: 0x77, srcY: 0x30, tgtX: 0x7c, tgtY: 0x42, flip: 0 }, expect: false },
  { name: "in-range HIT (ring open)", input: { recState: 1, srcX: 0x80, srcY: 0x40, tgtX: 0x7c, tgtY: 0x42, gameActive: 1 }, expect: false },
];

const HIT_INPUT = { recState: 1, srcX: 0x80, srcY: 0x40, tgtX: 0x7c, tgtY: 0x42 };

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: module RAM (−stack) + boolean match the oracle across all paths", () => {
  for (const { name, input, expect } of CASES) {
    const o = craft(input);
    const sp0 = o.regs.sp;
    oracle(o);
    const spDelta = (o.regs.sp - sp0) & 0xffff;
    const oracleNormal = spDelta === 2; // +2 plain ret (no-hit); +4 pop-af;ret (hit)
    assert.equal(oracleNormal, expect, `${name}: oracle SP delta ${spDelta} disagrees with the case's expected path`);

    const c = craft(input);
    const ret = testTargetPairOverlapAndClaimRecord(c);
    assert.equal(ret, expect, `${name}: module returned ${ret}, expected ${expect}`);
    assert.equal(ret, oracleNormal, `${name}: module boolean must match the oracle's SP-derived path`);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} paths identical (RAM −stack + boolean, SP-cross-checked)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a hit seeds the record fields + the post-hit handler pointer", () => {
  const before = craft(HIT_INPUT);
  const after = craft(HIT_INPUT);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.set(addr, a1[off]);
    }
  }
  const expected = {
    [RECORD]: 0x00,
    [(RECORD + 1) & 0xffff]: 0x01,
    [(RECORD + 2) & 0xffff]: 0x0c,
    [(RECORD + 7) & 0xffff]: 0x01,
    [(RECORD + 0x12) & 0xffff]: PROXIMITY_HIT_HANDLER & 0xff,
    [(RECORD + 0x13) & 0xffff]: (PROXIMITY_HIT_HANDLER >> 8) & 0xff,
  };
  for (const [addr, val] of Object.entries(expected)) {
    const a = Number(addr);
    assert.ok(changed.has(a), `expected a write at ${hx(a)}`);
    assert.equal(changed.get(a), val, `record cell ${hx(a)} must be ${hx(val)}, got ${hx(changed.get(a))}`);
  }
  // the sound-command stub also touches the command-ring page; that is its own contract.
  console.log(`  WRITE-SET: record ${hx(RECORD)} fields +0/+1/+2/+7 and handler ptr +0x12/+0x13 seeded`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong record byte is caught by the RAM diff", () => {
  const o = craft(HIT_INPUT);
  const c = craft(HIT_INPUT);
  oracle(o);
  testTargetPairOverlapAndClaimRecord(c);
  c.mem.write8((RECORD + 2) & 0xffff, 0x00); // BUG: this field must be 0x0c on a hit
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record byte — it is worthless");
  assert.equal(d.addr, (RECORD + 2) & 0xffff, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx((RECORD + 2) & 0xffff)})`);
  console.log(`  TEETH/RAM: wrong record byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a flipped boolean is rejected by the path check", () => {
  for (const input of [{ recState: 0 }, HIT_INPUT]) {
    const o = craft(input);
    const sp0 = o.regs.sp;
    oracle(o);
    const oracleNormal = ((o.regs.sp - sp0) & 0xffff) === 2;
    const c = craft(input);
    assert.equal(testTargetPairOverlapAndClaimRecord(c), oracleNormal, "sanity: the module agrees with the oracle path");
    assert.throws(
      () => assert.equal(!oracleNormal, oracleNormal),
      "the boolean path check must reject a flipped return",
    );
  }
  console.log("  TEETH/BOOL: a flipped no-hit/hit return is rejected by the path check");
});
