// SPDX-License-Identifier: GPL-3.0-only
// also gates: 0x9e5f stepClimberSegmentAndHeading
// Memory-equivalence for stepClimberSegmentGuarded (ROM 0x9e5c-0x9eaa) -- the FULL entry of a mid-entry split: it runs the
// gated $9eab bit6-keeper guard, then falls into the shared body stepClimberSegmentAndHeading (0x9e5f, also reached guardless by
// flipEnemyLaneTowardTarget/loc_9f99). The body forces bit7 on $0283,x and, per its low-3-bit segment, steps the $02b9,x
// depth and stores either a 9ed7 ring direction (segment != 4) or 0x87/0x81 (segment 4 seam) to $02cc,x.
// This is NOT a register-thread routine: lookupRingHeading already returns its exit A, so nothing is threaded through
// a stale register. Live-outs: RAM (the primary contract) plus register A (= the byte stored to $02cc,x).
// Y is 9ed7 scratch (dropped by the idiomatic 9ed7, per equivalence-9ed7.test.js) and is NOT compared; X is
// untouched. The oracle's m.call(0x9eab)/m.call(0x9ed7) resolve to the translated callees via the registry.
// Run: node --test games/tempest/idiomatic/test/equivalence-9e5c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9e5c, loc_9e5f } from "../../translated/loc_9e5c.js";
import { stepClimberSegmentGuarded } from "../stepClimberSegmentGuarded.js";
import { stepClimberSegmentAndHeading } from "../stepClimberSegmentAndHeading.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { TUBE_GEOM_FLAG, ENEMY_SLOT_FLAGS, ENEMY_SEGMENT, ENEMY_PHASE, SEG_DIRECTION } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9e5c;
const oracle = atEntry(loc_9e5c);
const oracle5f = atEntry(loc_9e5f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Seed the 16-entry ring table $03ee..$03fd so the 9ed7 half-turn (+8) bites in the segment != 4 path.
const seedRing = (m) => { for (let i = 0; i < 16; i++) m.mem.write8((SEG_DIRECTION + i) & 0xffff, i); return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9e5c dispatches -- stepClimberSegmentGuarded == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); stepClimberSegmentGuarded(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "register A (the $02cc,x byte) diverged");
    assert.equal(c.regs.x, o.regs.x, "register X (untouched) diverged");
    // Y is lookupRingHeading scratch, dropped by the idiomatic 9ed7 -- not a live-out, not compared.
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: segment != 4, bit6 set -- depth++ then 9ed7 half-turn direction to $02cc,x", () => {
  const X = 3;
  const seed = (m) => {
    seedRing(m);
    m.mem.write8(TUBE_GEOM_FLAG, 0x00);                     // gate off -> $9eab guard is a no-op (isolate the body)
    m.mem.write8((ENEMY_SLOT_FLAGS + X) & 0xffff, 0x42);      // bit6 set, segment 2
    m.mem.write8((ENEMY_SEGMENT + X) & 0xffff, 0x05);      // depth 5
  };
  const o = new Machine(ROM, OPTS); o.regs.x = X; seed(o);
  const c = new Machine(ROM, OPTS); c.regs.x = X; seed(c);
  oracle(o); stepClimberSegmentGuarded(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the ordinary-segment path");
  assert.equal(c.mem.read8((ENEMY_SLOT_FLAGS + X) & 0xffff), 0xc2, "$0283,x got bit7 forced on");
  assert.equal(c.mem.read8((ENEMY_SEGMENT + X) & 0xffff), 0x06, "depth stepped up (5 -> 6)");
  // depth is now 6, bit6 set -> 9ed7: y=(6-1)&0xf=5, ($03ee[5]+8)&0xf = (5+8)&0xf = 0x0d, | 0x80 = 0x8d
  assert.equal(c.mem.read8((ENEMY_PHASE + X) & 0xffff), 0x8d, "$02cc,x = 9ed7 half-turn direction");
  assert.equal(c.regs.a, o.regs.a, "A == oracle A");
});

test("CRAFTED: segment 4 (seam), bit6 set -- depth-- and 0x87 to $02cc,x; bit6 clear -- 0x81", () => {
  const X = 2;
  for (const [flag, wantDepth, wantCC] of [[0x44, 0x04, 0x87], [0x04, 0x05, 0x81]]) {
    const seed = (m) => {
      m.mem.write8(TUBE_GEOM_FLAG, 0x00);
      m.mem.write8((ENEMY_SLOT_FLAGS + X) & 0xffff, flag);    // segment 4; bit6 = flag & 0x40
      m.mem.write8((ENEMY_SEGMENT + X) & 0xffff, 0x05);
    };
    const o = new Machine(ROM, OPTS); o.regs.x = X; seed(o);
    const c = new Machine(ROM, OPTS); c.regs.x = X; seed(c);
    oracle(o); stepClimberSegmentGuarded(c);
    assert.equal(ramDiff(o, c), null, `RAM equal (seam, flag=0x${flag.toString(16)})`);
    assert.equal(c.mem.read8((ENEMY_SEGMENT + X) & 0xffff), wantDepth, `depth (flag=0x${flag.toString(16)})`);
    assert.equal(c.mem.read8((ENEMY_PHASE + X) & 0xffff), wantCC, `$02cc,x (flag=0x${flag.toString(16)})`);
    assert.equal(c.regs.a, o.regs.a, `A == oracle A (flag=0x${flag.toString(16)})`);
  }
});

test("MID-ENTRY: stepClimberSegmentAndHeading (guardless) == oracle stepClimberSegmentAndHeading in RAM (-stack) and A", () => {
  const X = 5;
  const seed = (m) => {
    seedRing(m);
    m.mem.write8(TUBE_GEOM_FLAG, 0x01);                     // gate ON -- but the mid-entry SKIPS the $9eab guard
    m.mem.write8((ENEMY_SLOT_FLAGS + X) & 0xffff, 0x41);      // bit6 set, segment 1
    m.mem.write8((ENEMY_SEGMENT + X) & 0xffff, 0x00);      // depth 0
  };
  const o = new Machine(ROM, OPTS); o.regs.x = X; seed(o);
  const c = new Machine(ROM, OPTS); c.regs.x = X; seed(c);
  oracle5f(o); stepClimberSegmentAndHeading(c);
  assert.equal(ramDiff(o, c), null, "mid-entry RAM equal");
  assert.equal(c.regs.a, o.regs.a, "mid-entry A == oracle A");
  // The guard would have fired ($0111!=0, bit6 already set, depth 0) but the mid-entry must NOT run it:
  assert.equal(c.mem.read8((ENEMY_SLOT_FLAGS + X) & 0xffff), 0xc1, "mid-entry left $0283,x bit6 set (guard NOT run)");
});

test("TEETH: a twin that takes the wrong branch (treats segment 4 as ordinary) diverges", () => {
  const X = 3;
  const seed = (m) => {
    seedRing(m);
    m.mem.write8(TUBE_GEOM_FLAG, 0x00);
    m.mem.write8((ENEMY_SLOT_FLAGS + X) & 0xffff, 0x44);      // segment 4, bit6 set -> oracle: depth--, 0x87
    m.mem.write8((ENEMY_SEGMENT + X) & 0xffff, 0x05);
  };
  const o = new Machine(ROM, OPTS); o.regs.x = X; seed(o);
  const c = new Machine(ROM, OPTS); c.regs.x = X; seed(c);
  oracle(o);
  const brokenBranch = (m) => {                       // BUG: run the ordinary-segment path for segment 4
    const mem = m.mem8;
    const flag = mem[(ENEMY_SLOT_FLAGS + X) & 0xffff] | 0x80;
    mem[(ENEMY_SLOT_FLAGS + X) & 0xffff] = flag;
    if (flag & 0x40) mem[(ENEMY_SEGMENT + X) & 0xffff] = (mem[(ENEMY_SEGMENT + X) & 0xffff] + 1) & 0x0f; // wrong: ++
    mem[(ENEMY_PHASE + X) & 0xffff] = 0x99;              // wrong store, not 0x87
  };
  brokenBranch(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong-branch twin");
});

test("TEETH: skipping the $9eab head guard diverges -- stepClimberSegmentAndHeading (guardless) != oracle stepClimberSegmentGuarded", () => {
  const X = 3;
  const seed = (m) => {
    seedRing(m);
    m.mem.write8(TUBE_GEOM_FLAG, 0x01);                     // gate ON
    m.mem.write8((ENEMY_SLOT_FLAGS + X) & 0xffff, 0x00);      // bit6 CLEAR, segment 0
    m.mem.write8((ENEMY_SEGMENT + X) & 0xffff, 0x00);      // depth 0 -> $9eab SETS bit6
  };
  const o = new Machine(ROM, OPTS); o.regs.x = X; seed(o);
  const c = new Machine(ROM, OPTS); c.regs.x = X; seed(c);
  oracle(o);                                          // full entry: guard sets bit6 first
  stepClimberSegmentAndHeading(c);                                        // mid-entry: no guard -> bit6 stays clear
  assert.notEqual(ramDiff(o, c), null, "skipping the guard FAILED to diverge (guard is load-bearing)");
});

test("SP-TOOTH: the omitted-ret module (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedRing(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, stepClimberSegmentGuarded, TARGET, m);
  assert.equal(r.placeable, true, `stepClimberSegmentGuarded must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret module (moved 0) placeable");
});
