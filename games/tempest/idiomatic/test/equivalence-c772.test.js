// SPDX-License-Identifier: GPL-3.0-only
// also gates: 0xc774 emitObjectPositionRecord
// Memory-equivalence for emitObjectPositionVector/emitObjectPositionRecord (ROM 0xc772-0xc79f) -- a CALLER that dissolves its tail m.call
// into a direct idiomatic call (df5f, the cursor advance). emitObjectPositionVector seeds y=0 and falls into emitObjectPositionRecord;
// emitObjectPositionRecord is the second entry, reached with X (zeropage-pair index) and Y (write cursor) live. Effect is
// memory only (vector RAM via ($74), the $6a-$6d cache, and the ($74) cursor), so each side runs on a clone
// and the contract is RAM (dumpState, minus STACK_SCRATCH). X/Y are register inputs, seated on both sides.
// Run: node --test games/tempest/idiomatic/test/equivalence-c772.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c772 as oracle_c772, loc_c774 as oracle_c774 } from "../../translated/loc_c772.js";
import { emitObjectPositionVector, emitObjectPositionRecord } from "../emitObjectPositionVector.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, MODE_DISPATCH_SEL, GAME_MODE_PENDING, FRAME_COUNTER, GAME_MODE, PREV_Y_LO, PREV_Y_HI, PREV_X_LO, PREV_X_HI, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

// Capture real dispatches at a given entry, running the matching oracle inside the wrapper.
function captureDispatches(target, oracle, K, maxFrames) {
  const caps = [];
  const snap = new Map([[target, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before boot-gap throw */ }
  return caps;
}
const CAPS772 = ROM_PRESENT ? captureDispatches(0xc772, oracle_c772, 16, 2000) : [];
const CAPS774 = ROM_PRESENT ? captureDispatches(0xc774, oracle_c774, 16, 2000) : [];

test("CAPTURE: real 0xc772 / 0xc774 dispatches -- idiomatic == oracle in RAM (-stack)", () => {
  for (const cap of CAPS772) {
    const o = cap.clone(), c = cap.clone();
    oracle_c772(o); emitObjectPositionVector(c);
    assert.equal(ramDiff(o, c), null, "c772 entry");
  }
  for (const cap of CAPS774) {
    const o = cap.clone(), c = cap.clone();
    oracle_c774(o); emitObjectPositionRecord(c);
    assert.equal(ramDiff(o, c), null, "c774 entry");
  }
  console.log(`  CAPTURE: c772=${CAPS772.length} c774=${CAPS774.length} dispatch(es) checked`);
});

// Point the ($74) cursor at vector RAM (0x2000, RW + diffed) and seat the zeropage coordinate pairs at X.
function seed(m, x) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00);
  m.mem.write8(DRAW_CURSOR_HI, 0x20);
  m.mem.write8((GAME_MODE + x) & 0xff, 0x11); // Y lo
  m.mem.write8((MODE_DISPATCH_SEL + x) & 0xff, 0xe4);  // Y hi (bits above 0x1f set)
  m.mem.write8((GAME_MODE_PENDING + x) & 0xff, 0x22);  // X lo
  m.mem.write8((FRAME_COUNTER + x) & 0xff, 0xd7);  // X hi (bits above 0x1f set)
  m.regs.x = x;
  m.regs.y = 0x00;
}

test("CRAFTED: c772 emits header {0x40,0x80} + two 5-bit-clamped coordinate words and caches raw bytes", () => {
  const x = 0x10;
  const o = new Machine(ROM, OPTS); seed(o, x);
  const c = new Machine(ROM, OPTS); seed(c, x);
  oracle_c772(o); emitObjectPositionVector(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after c772");
  assert.equal(c.mem.read8(0x2000), 0x40, "header lo");
  assert.equal(c.mem.read8(0x2001), 0x80, "header hi");
  assert.equal(c.mem.read8(0x2002), 0x22, "X lo raw");
  assert.equal(c.mem.read8(0x2003), 0xd7 & 0x1f, "X hi clamped");
  assert.equal(c.mem.read8(0x2004), 0x11, "Y lo raw");
  assert.equal(c.mem.read8(0x2005), 0xe4 & 0x1f, "Y hi clamped");
  assert.equal(c.mem.read8(PREV_X_LO), 0x22, "$6c cache");
  assert.equal(c.mem.read8(PREV_X_HI), 0xd7, "$6d cache raw");
  assert.equal(c.mem.read8(PREV_Y_LO), 0x11, "$6a cache");
  assert.equal(c.mem.read8(PREV_Y_HI), 0xe4, "$6b cache raw");
  assert.equal(c.mem.read8(DRAW_CURSOR_LO), 0x06, "cursor advanced by six");
});

test("TEETH: a twin that skips the 5-bit clamp on the high bytes diverges from the oracle", () => {
  const x = 0x10;
  const o = new Machine(ROM, OPTS); seed(o, x);
  const c = new Machine(ROM, OPTS); seed(c, x);
  oracle_c774(o);
  const broken = (m) => {
    const base = m.mem.read8(DRAW_CURSOR_LO) | (m.mem.read8(DRAW_CURSOR_HI) << 8);
    let y = m.regs.y;
    m.mem.write8((base + y) & 0xffff, 0x40); y = (y + 1) & 0xff;
    m.mem.write8((base + y) & 0xffff, 0x80); y = (y + 1) & 0xff;
    const xLo = m.mem.read8((GAME_MODE_PENDING + x) & 0xff); m.mem.write8(PREV_X_LO, xLo);
    m.mem.write8((base + y) & 0xffff, xLo); y = (y + 1) & 0xff;
    const xHi = m.mem.read8((FRAME_COUNTER + x) & 0xff); m.mem.write8(PREV_X_HI, xHi);
    m.mem.write8((base + y) & 0xffff, xHi); // BUG: no & 0x1f
    const yLo = m.mem.read8((GAME_MODE + x) & 0xff); m.mem.write8(PREV_Y_LO, yLo); y = (y + 1) & 0xff;
    m.mem.write8((base + y) & 0xffff, yLo);
    const yHi = m.mem.read8((MODE_DISPATCH_SEL + x) & 0xff); m.mem.write8(PREV_Y_HI, yHi); y = (y + 1) & 0xff;
    m.mem.write8((base + y) & 0xffff, yHi); // BUG: no & 0x1f
    m.mem.write8(DRAW_CURSOR_LO, (m.mem.read8(DRAW_CURSOR_LO) + y + 1) & 0xff); // advance cursor like df5f, so only the mask differs
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the unclamped high bytes");
});
