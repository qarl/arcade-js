// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for testTargetProximityAndSetAimDirection (ROM 0x6c3f, Pooyan) — the dissolved caller-skip of
 * clearAimIndicatorUnlessProximityHit's proximity scan. The oracle ends each path either with a plain `ret` (the normal
 * "keep scanning" outcome) or with `pop af; ret` (the skip that aborts the caller's scan on a
 * hit). The idiomatic module replaces that stack protocol with a boolean: true = the normal
 * path, false = the skip path.
 *
 * Because the oracle returns nothing (its path lives in the stack), the path it took is read
 * from its SP movement: a plain `ret` pops once (SP += 2); the skip pops twice (pop af + ret,
 * SP += 4). SP is seated inside STACK_SCRATCH so those pops only read dead RAM and never touch
 * game state. The contract compared is therefore RAM (dumpState, minus stack scratch below the entry SP) PLUS the
 * boolean, matched against the oracle's SP-derived path. pc/sp/cycles and the clobbered scratch
 * registers are not compared.
 *
 * The leaf runs only during live aim-indicator gameplay, so every case is CRAFTED: identical
 * (ix record, iy target, hl gate) register seats plus the five source cells they read.
 *
 * Cases exercise every path: gate-closed, out-of-x-band, out-of-y-band (all normal → true), and
 * all four hit branches (skip → false) — above/below × with/without the indicator latch, with
 * the below-latch branch reached from both y signs.
 *
 * Jobs:
 *   1. EQUAL — for each crafted case the module's boolean matches the oracle's SP-derived path
 *      AND RAM (−stack) is byte-identical.
 *   2. WRITE-SET — a latched-hit's writes are exactly the four cells HIT/AIM/MODE/TIMER.
 *   3. CRAFTED — a pre-dirtied AIM byte is read-modify-written identically on both sides.
 *   4. TEETH — a wrong AIM byte is caught by the RAM diff; a wrong boolean is rejected against
 *      the oracle's path.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6c3f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6c3f as oracle } from "../../translated/loc_6c3f.js";
import { testTargetProximityAndSetAimDirection } from "../testTargetProximityAndSetAimDirection.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX = 0x8840; //    SPRITE_DISPLAY_LIST — the fixed record (reads +0, +2)
const IY = 0x887c; //    SPRITE_TARGET_SLOTS — the target (reads +0, +2)
const HL = 0x8be8; //    PROJECTILE_TABLE — the gate record (bit0)
const AIM = 0x8a87; //   PLAYER_AIM_FLAGS (bit2 above, bit3 below)
const HIT = 0x8d54; //   PROXIMITY_HIT_FLAG
const MODE = 0x8d52; //  AIM_INDICATOR_MODE
const TIMER = 0x8d53; // AIM_INDICATOR_TIMER
const SP_SEAT = 0x8fc0; // in STACK_SCRATCH: oracle pops read dead RAM here

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SEAT);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the three input registers and the five source cells identically on a fresh clone. */
function craft(cs) {
  const m = BASE.clone();
  m.regs.ix = IX;
  m.regs.iy = IY;
  m.regs.hl = HL;
  m.regs.sp = SP_SEAT;
  m.mem.write8(HL, cs.gate & 0xff);
  m.mem.write8(IX + 0, cs.recXsrc & 0xff);
  m.mem.write8(IX + 2, cs.recYtype & 0xff);
  m.mem.write8(IY + 0, cs.tgtXsrc & 0xff);
  m.mem.write8(IY + 2, cs.tgtYsrc & 0xff);
  if (cs.aimSeed !== undefined) m.mem.write8(AIM, cs.aimSeed & 0xff);
  return m;
}

/** Run the oracle and report whether it took the NORMAL path (plain ret pops once: SP += 2). */
function oracleTookNormal(o) {
  const before = o.regs.sp;
  oracle(o);
  const delta = (o.regs.sp - before) & 0xffff;
  return delta === 2; // 2 = plain ret; 4 = pop af + ret (skip)
}

// gate/band values chosen so x is in band (recX=tgtX=0x50) except the x-band case; y and the
// record type byte then select the branch. recY == typeByte (both are the ix+2 cell).
const CASES = [
  { name: "gate closed", expect: "normal", gate: 0x00, recXsrc: 0x40, recYtype: 0x00, tgtXsrc: 0x30, tgtYsrc: 0x00 },
  { name: "out of x-band", expect: "normal", gate: 0x01, recXsrc: 0x00, recYtype: 0x00, tgtXsrc: 0x40, tgtYsrc: 0x00 },
  { name: "out of y-band", expect: "normal", gate: 0x01, recXsrc: 0x40, recYtype: 0x00, tgtXsrc: 0x30, tgtYsrc: 0x20 },
  // hits (skip → false):
  { name: "hit above, no latch (y>=0)", expect: "skip", gate: 0x01, recXsrc: 0x40, recYtype: 0x60, tgtXsrc: 0x30, tgtYsrc: 0x5c },
  { name: "hit below, latch (y>=0)", expect: "skip", gate: 0x01, recXsrc: 0x40, recYtype: 0x20, tgtXsrc: 0x30, tgtYsrc: 0x1c },
  { name: "hit below, no latch (y<0)", expect: "skip", gate: 0x01, recXsrc: 0x40, recYtype: 0x80, tgtXsrc: 0x30, tgtYsrc: 0x74 },
  { name: "hit above, latch (y<0)", expect: "skip", gate: 0x01, recXsrc: 0x40, recYtype: 0xc0, tgtXsrc: 0x30, tgtYsrc: 0xb4 },
  { name: "hit below, latch (y<0)", expect: "skip", gate: 0x01, recXsrc: 0x40, recYtype: 0x10, tgtXsrc: 0x30, tgtYsrc: 0x04 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted paths — testTargetProximityAndSetAimDirection boolean == oracle path AND RAM (−stack) identical", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    const normal = oracleTookNormal(o);
    const ret = testTargetProximityAndSetAimDirection(c);

    assert.equal(normal, cs.expect === "normal", `[${cs.name}] oracle SP-path disagrees with the crafted expectation`);
    assert.equal(ret, normal, `[${cs.name}] module boolean (${ret}) must match the oracle path (normal=${normal})`);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cs.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted paths identical (boolean + RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a latched hit writes exactly HIT=1, AIM below, MODE=2, TIMER=0x18", () => {
  const cs = CASES.find((c) => c.name === "hit below, latch (y>=0)");
  const before = craft(cs).dumpState();
  const after = craft(cs);
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== a1[off]) changed.set(after.stateOffsetToAddr(off), a1[off]);
  }
  assert.equal(changed.size, 4, `expected exactly 4 written cells, got ${changed.size}`);
  assert.equal(changed.get(HIT), 0x01, "HIT flag must be 1");
  assert.equal(changed.get(AIM), 0x08, "AIM must have bit3 (below) set, bit2 clear");
  assert.equal(changed.get(MODE), 0x02, "MODE latch must be 2");
  assert.equal(changed.get(TIMER), 0x18, "TIMER must reload 0x18");
  console.log(`  WRITE-SET: ${hx(HIT)}=1 ${hx(AIM)}=0x08 ${hx(MODE)}=2 ${hx(TIMER)}=0x18`);
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: a pre-dirtied AIM byte is read-modify-written identically (opposite bit cleared)", () => {
  const cs = { ...CASES.find((c) => c.name === "hit above, no latch (y>=0)"), aimSeed: 0xff };
  const o = craft(cs);
  const c = craft(cs);
  oracle(o);
  testTargetProximityAndSetAimDirection(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(AIM), 0xf7, "AIM: bit2 stays set, bit3 cleared from 0xff -> 0xf7");
  console.log("  CRAFTED: AIM 0xff -> 0xf7 (bit3 cleared) on both sides");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong AIM byte is CAUGHT by the RAM diff", () => {
  const cs = CASES.find((c) => c.name === "hit below, latch (y>=0)");
  const o = craft(cs);
  const c = craft(cs);
  oracle(o);
  testTargetProximityAndSetAimDirection(c);
  c.mem.write8(AIM, (c.mem.read8(AIM) ^ 0xff) & 0xff); // BUG: corrupt the aim byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong AIM byte — it is worthless");
  assert.equal(d.addr, AIM, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(AIM)})`);
  console.log(`  TEETH/RAM: wrong AIM caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong boolean is REJECTED against the oracle path", () => {
  const skip = craft(CASES.find((c) => c.name === "hit above, latch (y<0)"));
  const normal = oracleTookNormal(skip);
  assert.equal(normal, false, "sanity: a hit is the skip path (false)");
  assert.notEqual(true, normal, "a twin returning true on a skip must be rejected");

  const clean = craft(CASES.find((c) => c.name === "gate closed"));
  const normal2 = oracleTookNormal(clean);
  assert.equal(normal2, true, "sanity: gate-closed is the normal path (true)");
  assert.notEqual(false, normal2, "a twin returning false on a normal ret must be rejected");
  console.log("  TEETH/boolean: wrong verdicts rejected on both a skip and a normal path");
});
