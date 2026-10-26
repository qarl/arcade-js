// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildSlotScreenPoint (ROM 0xb634) -- for slot x, copy $57->$2f, fetch a base coord pair from
// $03ce/$03de (indexed by $02b9,x), signed-saturating-add the $b68b/$b687 deltas (indexed by $02cc,x&0x0f)
// into $2e/$30, and load a style pair $bcdc/$bcec (indexed by $0112) into $59/$5a. x is the only input;
// live-out is RAM only. Pure leaf, no dispatch; the seam completes it by omitting its ROM ret. No POKEY
// reads -> deterministic. Run: node --test games/tempest/idiomatic/test/equivalence-b634.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b634 } from "../../translated/loc_b634.js";
import { buildSlotScreenPoint } from "../buildSlotScreenPoint.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  loc_2e, loc_2f, loc_30, PROJ_PT_Y, OBJ_DEPTH, PROJ_PT_X, CLAMP_TALLY, RUN_SIZE,
  TUBE_SHAPE_INDEX, ENEMY_SEGMENT, ENEMY_PHASE, SEG_BASE_X, SEG_BASE_Y, VERTEX_Y_OFS_BY_PHASE, VERTEX_X_OFS_BY_PHASE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb634;
const oracle = atEntry(loc_b634);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb634 dispatches -- buildSlotScreenPoint == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); buildSlotScreenPoint(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) {
  m.regs.x = s.x;
  m.mem8[OBJ_DEPTH] = s.b57;
  m.mem8[(ENEMY_SEGMENT + s.x) & 0xffff] = s.coordIdx;
  m.mem8[(SEG_BASE_X + s.coordIdx) & 0xffff] = s.baseX;
  m.mem8[(SEG_BASE_Y + s.coordIdx) & 0xffff] = s.baseY;
  m.mem8[(ENEMY_PHASE + s.x) & 0xffff] = s.deltaIdx;
  m.mem8[TUBE_SHAPE_INDEX] = s.styleIdx;
}

test("CRAFTED: coord fetch, saturating add and style load == oracle across seeds (RAM -stack)", () => {
  const cases = [
    { x: 0x00, b57: 0x11, coordIdx: 0x03, baseX: 0x40, baseY: 0x50, deltaIdx: 0x02, styleIdx: 0x00 },
    { x: 0x01, b57: 0x22, coordIdx: 0x00, baseX: 0x00, baseY: 0xff, deltaIdx: 0x05, styleIdx: 0x01 },
    { x: 0x02, b57: 0x33, coordIdx: 0x07, baseX: 0x7f, baseY: 0x80, deltaIdx: 0x0f, styleIdx: 0x02 },
    { x: 0x03, b57: 0x44, coordIdx: 0x0a, baseX: 0xff, baseY: 0x01, deltaIdx: 0x1a, styleIdx: 0x03 },
    { x: 0x05, b57: 0x55, coordIdx: 0x02, baseX: 0x80, baseY: 0x7e, deltaIdx: 0x08, styleIdx: 0x0a },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); buildSlotScreenPoint(c);
    assert.equal(ramDiff(o, c), null, `RAM x=${s.x} coordIdx=${s.coordIdx}`);
    assert.equal(c.mem8[loc_2f], s.b57, `x=${s.x}: $2f copied from $57`);
  }
});

test("TEETH: a twin that adds without signed saturation diverges on an overflowing coordinate", () => {
  // Find a deltaIdx whose ROM delta ($b68b) is positive (1..0x7f); with base 0xff (a^0x80 = 0x7f) the
  // biased add overflows, so the oracle clamps to 0xff while a plain wrapping add would not.
  const probe = new Machine(ROM, OPTS);
  let deltaIdx = -1;
  for (let i = 0; i < 16; i++) {
    const d = probe.mem8[(VERTEX_X_OFS_BY_PHASE + i) & 0xffff];
    if (d >= 1 && d <= 0x7f) { deltaIdx = i; break; }
  }
  assert.notEqual(deltaIdx, -1, "no positive delta in $b68b[0..15] to force overflow");
  const s = { x: 0x00, b57: 0x11, coordIdx: 0x03, baseX: 0xff, baseY: 0xff, deltaIdx, styleIdx: 0x00 };
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o);
  const broken = (m) => { // BUG: plain wrapping add for the first coord, no signed saturation
    const cIdx = m.mem8[(ENEMY_SEGMENT + m.regs.x) & 0xffff];
    const dIdx = m.mem8[(ENEMY_PHASE + m.regs.x) & 0xffff] & 0x0f;
    m.mem8[loc_2f] = m.mem8[OBJ_DEPTH];
    const bx = m.mem8[(SEG_BASE_X + cIdx) & 0xffff];
    m.mem8[PROJ_PT_Y] = bx;
    const sum = ((bx ^ 0x80) + m.mem8[(VERTEX_X_OFS_BY_PHASE + dIdx) & 0xffff]) & 0xff;
    m.mem8[loc_2e] = sum ^ 0x80;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing saturation clamp");
});
