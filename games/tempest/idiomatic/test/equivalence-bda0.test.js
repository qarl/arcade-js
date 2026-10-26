// SPDX-License-Identifier: GPL-3.0-only
// also gates: 0xbdcb emitTubeRimSegmentVectors
// Memory-equivalence for drawTubeRimSegmentFromCorner / emitTubeRimSegmentVectors (ROM 0xbda0-0xbfb4). drawTubeRimSegmentFromCorner captures a segment's two
// endpoints then falls into emitTubeRimSegmentVectors, the shared builder (also entered directly at 0xbdcb from other
// sites). bdcb early-outs unless active, transforms both endpoints via projectPointThroughMathbox/layHeaderAndBuildRecord/emitTaggedVectorWord/
// emitVectorWordTag70, forms two clamped signed deltas, expands a fivefold spread, and emits N four-byte records
// into the ($74) cursor before tail-advancing it via advanceDisplayCursor. The idiomatic side dissolves every
// jsr into a direct call. Live-out is memory only (tail-caller into df5f), so each arm compares RAM
// (dumpState minus STACK_SCRATCH). Run: node --test games/tempest/idiomatic/test/equivalence-bda0.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_bda0 as oracleBda0, loc_bdcb as oracleBdcb } from "../../translated/loc_bda0.js";
import { drawTubeRimSegmentFromCorner, emitTubeRimSegmentVectors } from "../drawTubeRimSegmentFromCorner.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, DEPTH_LO, DRAW_CURSOR_LO, DRAW_CURSOR_HI, DRAW_RECORD_COUNT } from "../names.js";

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

function captureDispatches(addr, oracle, K, maxFrames) {
  const caps = [];
  const snap = new Map([[addr, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS_BDA0 = ROM_PRESENT ? captureDispatches(0xbda0, oracleBda0, 16, 3000) : [];
const CAPS_BDCB = ROM_PRESENT ? captureDispatches(0xbdcb, oracleBdcb, 16, 3000) : [];

test("CAPTURE: real 0xbda0 dispatches -- drawTubeRimSegmentFromCorner == oracle in RAM (-stack)", () => {
  for (const cap of CAPS_BDA0) {
    const o = cap.clone(), c = cap.clone();
    oracleBda0(o); drawTubeRimSegmentFromCorner(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE(bda0): ${CAPS_BDA0.length} dispatch(es) checked`);
});

test("CAPTURE: real 0xbdcb mid-entry dispatches -- emitTubeRimSegmentVectors == oracle in RAM (-stack)", () => {
  for (const cap of CAPS_BDCB) {
    const o = cap.clone(), c = cap.clone();
    oracleBdcb(o); emitTubeRimSegmentVectors(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE(bdcb): ${CAPS_BDCB.length} dispatch(es) checked`);
});

// Force the active path ($5b negative), cursor into vector RAM, small run so the emit loop terminates
// quickly. The full-entry setup pulls both endpoints from the $03ce/$03de corner tables (ROM).
function seedActive(m, a, y) {
  m.regs.a = a; m.regs.y = y;
  m.mem.write8(DEPTH_LO, 0x80);                              // negative -> skip the early-out
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // ($74) -> 0x2000
}

test("CRAFTED: full entry, active path -- drawTubeRimSegmentFromCorner == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedActive(o, 0x00, 0x00);
  const c = new Machine(ROM, OPTS); seedActive(c, 0x00, 0x00);
  oracleBda0(o); drawTubeRimSegmentFromCorner(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after full build");
});

test("CRAFTED: mid-entry active path -- emitTubeRimSegmentVectors == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedActive(o, 0x00, 0x02);
  const c = new Machine(ROM, OPTS); seedActive(c, 0x00, 0x02);
  oracleBdcb(o); emitTubeRimSegmentVectors(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after mid-entry build");
});

test("CRAFTED: early-out ($5b>=0 and $57<$5f) -- no change; RAM equal", () => {
  const seed = (m) => { m.regs.y = 0x00; m.mem.write8(DEPTH_LO, 0x00); m.mem.write8(0x57, 0x01); m.mem.write8(0x5f, 0x40); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracleBdcb(o); emitTubeRimSegmentVectors(c);
  assert.equal(ramDiff(o, c), null, "RAM equal (early-out path)");
});

test("TEETH: a twin that skips the record-emit loop diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedActive(o, 0x00, 0x02); oracleBdcb(o);
  const c = new Machine(ROM, OPTS); seedActive(c, 0x00, 0x02); emitTubeRimSegmentVectors(c);
  // Corrupt one emitted record byte the oracle wrote so the RAM images must differ.
  const base = c.mem.read8(DRAW_CURSOR_LO) | (c.mem.read8(DRAW_CURSOR_HI) << 8);
  c.mem.write8(base & 0xffff, (c.mem.read8(base & 0xffff) ^ 0xff) & 0xff);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a corrupted emitted record");
});

test("TEETH: a no-op twin (never builds) diverges from the oracle on the active path", () => {
  const o = new Machine(ROM, OPTS); seedActive(o, 0x00, 0x02); oracleBdcb(o);
  const c = new Machine(ROM, OPTS); seedActive(c, 0x00, 0x02);
  const broken = (_m) => { /* BUG: builds nothing */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a no-op builder");
});

test("SP-TOOTH: the omitted-ret tail-caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  m.mem.write8(DEPTH_LO, 0x00); m.mem.write8(0x57, 0x01); m.mem.write8(0x5f, 0x40); // early-out: no side calls
  const r = seamPlaceable(withOmittedRet, emitTubeRimSegmentVectors, 0xbdcb, m);
  assert.equal(r.placeable, true, `emitTubeRimSegmentVectors must be seam-placeable; got: ${r.error}`);
});
