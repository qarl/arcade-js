// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitColoredShapeVector (ROM 0xbd09-0xbd3d) -- folds the deltas via c098, lays the fixed
// header via c765 (X=0x61), appends the (mantissa, exponent) pair via bd3e, then writes a two-byte
// vector-list entry {clamped-nibble, 0x60} at ($74)+Y and tail-jumps to df59 with the {a,x} template
// reloaded from the $cec8/$cec9 table indexed by $55. THE REGISTER THREAD: bd3e returns its exit Y
// (= $a9 + 2); emitColoredShapeVector sets $a9 = 0 first, so the threaded Y is 2, consumed by the two ($74),y stores
// and PERSISTENTLY stashed into $a9 (= threaded-Y + 2). Dissolves all four m.calls into direct idiomatic
// calls. The oracle m.calls the frozen c098/c765/bd3e/df59; the idiomatic calls the idiomatic ones. All
// output is RAM (vector-list bytes + $a9 + the callees' writes), so each arm compares the RAM diff (minus
// the dead stack); A/X/Y at RTS are incidental (bd09 tail-delegates to df59). An omitted-ret rewrite.
// Run: node --test games/tempest/idiomatic/test/equivalence-bd09.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_bd09 } from "../../translated/loc_bd09.js";
import { emitColoredShapeVector } from "../emitColoredShapeVector.js";
import { projectPointThroughMathbox } from "../projectPointThroughMathbox.js";
import { layHeaderAndBuildRecord } from "../layHeaderAndBuildRecord.js";
import { appendNormalizedMantissaExponent } from "../appendNormalizedMantissaExponent.js";
import { emitVectorWordAtOffset } from "../emitVectorWordAtOffset.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  DRAW_STYLE, OBJ_DEPTH, DEPTH_LO, DEPTH_HI, DRAW_CURSOR_LO, DRAW_CURSOR_HI, SEG_SPREAD_A_LO, loc_a0, DRAW_CURSOR_OFFSET,
  OBJ_TEMPLATE_WORD_LO, OBJ_TEMPLATE_WORD_HI,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xbd09;
const oracle = atEntry(loc_bd09);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

// The cursor $74/$75 points into vector RAM (0x2000-0x2fff, part of the diffed dump) so every ($74),y
// store lands in the diff. $57>=0x10 drives bd3e's coprocessor branch; the c098 delta cells are seeded
// so its (deterministic) math box run is reproducible. $55 indexes the $cec8/$cec9 template table.
function seat(m, s = {}) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20);           // cursor -> 0x2000 (vector RAM)
  m.mem.write8(OBJ_DEPTH, s.b57 ?? 0x40); m.mem.write8(DEPTH_HI, s.b5f ?? 0x10); m.mem.write8(DEPTH_LO, s.b5b ?? 0x00);
  m.mem.write8(loc_a0, s.ba0 ?? 0x02);
  m.mem.write8(SEG_SPREAD_A_LO, s.b78 ?? 0x35);                              // color/intensity nibble source
  m.mem.write8(DRAW_STYLE, s.b55 ?? 0x00);                             // template index
  m.mem.write8(DRAW_CURSOR_OFFSET, s.ba9 ?? 0x00);                            // clobbered to 0 by bd09; seed is incidental
}

test("CAPTURE: real 0xbd09 dispatches -- emitColoredShapeVector == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitColoredShapeVector(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: coprocessor branch -- full c098/c765/bd3e/df59 chain matches the oracle (RAM)", () => {
  const cases = [
    { tag: "b78=0x35 -> clamp keeps",  b78: 0x35, b55: 0x00 },
    { tag: "b78=0x07 -> clamp floors", b78: 0x07, b55: 0x02 }, // ($78^7)=0, asl=0, <0x0a -> 0x0a
    { tag: "b78=0xf1 alt template",    b78: 0xf1, b55: 0x04 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seat(o, s);
    const c = new Machine(ROM, OPTS); seat(c, s);
    oracle(o); emitColoredShapeVector(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("CRAFTED: the threaded exit-Y ($a9 -> 0, so Y=2) lands the entry at cursor+2/+3 and stashes $a9=4", () => {
  const s = { b78: 0x35, b55: 0x00 };
  const c = new Machine(ROM, OPTS); seat(c, s);
  emitColoredShapeVector(c);
  // bd09 forces $a9=0 -> bd3e returns Y=2 -> the two stores use Y=2,3 -> $a9 stashed = 2+2 = 4.
  assert.equal(c.mem.read8(DRAW_CURSOR_OFFSET), 0x04, "$a9 persistently stashed to threaded-Y + 2");
});

test("TEETH (register thread): threading the WRONG Y (stale entry Y=0, not bd3e's exit) diverges in $a9", () => {
  const s = { b78: 0x35, b55: 0x00 };
  const o = new Machine(ROM, OPTS); seat(o, s);
  const c = new Machine(ROM, OPTS); seat(c, s);
  oracle(o);
  // BUG: ignores bd3e's returned exit Y and threads a stale y=0 (the classic "read the pre-call register"
  // failure). The two entry stores then land at cursor+0/+1 (clobbering bd3e's own pair) and $a9 is
  // stashed as 0+2 = 2 instead of the oracle's 4 -- a divergence in the persistently-stashed cell.
  const broken = (m) => {
    const { mem8, mem16 } = m;
    projectPointThroughMathbox(m);
    layHeaderAndBuildRecord(m, 0x61);
    mem8[DRAW_CURSOR_OFFSET] = 0x00;
    appendNormalizedMantissaExponent(m); // return IGNORED -- the defect
    let a = mem8[SEG_SPREAD_A_LO] ^ 0x07;
    a = (a << 1) & 0xff;
    if (a < 0x0a) a = 0x0a;
    a = (a << 4) & 0xff;
    const ptr = mem16[DRAW_CURSOR_LO];
    let y = 0x00; // WRONG: should be bd3e's exit Y ($a9 + 2 = 2)
    mem8[(ptr + y) & 0xffff] = a;
    y = (y + 1) & 0xff;
    mem8[(ptr + y) & 0xffff] = 0x60;
    y = (y + 1) & 0xff;
    mem8[DRAW_CURSOR_OFFSET] = y;
    y = mem8[DRAW_STYLE];
    const x = mem8[(OBJ_TEMPLATE_WORD_HI + y) & 0xffff];
    a = mem8[(OBJ_TEMPLATE_WORD_LO + y) & 0xffff];
    y = mem8[DRAW_CURSOR_OFFSET];
    emitVectorWordAtOffset(m, a, x, y);
  };
  broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the wrong threaded register");
  // And specifically the stash cell must be wrong.
  assert.notEqual(o.mem.read8(DRAW_CURSOR_OFFSET), c.mem.read8(DRAW_CURSOR_OFFSET), "$a9 stash must differ (4 vs 2)");
});

test("TEETH: a twin that skips the 0x60 second entry byte diverges from the oracle", () => {
  const s = { b78: 0x35, b55: 0x00 };
  const o = new Machine(ROM, OPTS); seat(o, s);
  const c = new Machine(ROM, OPTS); seat(c, s);
  oracle(o);
  const broken = (m) => {
    const { mem8, mem16 } = m;
    projectPointThroughMathbox(m);
    layHeaderAndBuildRecord(m, 0x61);
    mem8[DRAW_CURSOR_OFFSET] = 0x00;
    const y0 = appendNormalizedMantissaExponent(m);
    let a = mem8[SEG_SPREAD_A_LO] ^ 0x07;
    a = (a << 1) & 0xff;
    if (a < 0x0a) a = 0x0a;
    a = (a << 4) & 0xff;
    const ptr = mem16[DRAW_CURSOR_LO];
    mem8[(ptr + y0) & 0xffff] = a; // BUG: never writes the 0x60 byte, never advances/stashes $a9
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing 0x60 byte");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seat(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, emitColoredShapeVector, TARGET, m);
  assert.equal(r.placeable, true, `emitColoredShapeVector must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret rewrite placeable");
});
