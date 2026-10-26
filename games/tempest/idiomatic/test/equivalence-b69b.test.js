// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitInterpolatedSlotVector (ROM 0xb69b-0xb6f7) -- builds a screen position for slot X and tail-jmps
// the vector emitter (df59). Loads $02df,x -> $57 and the ($02b9,x)-indexed pair $03ce/$03de -> $56/$58;
// when the phase byte $02cc,x is negative it interpolates each toward the next segment via scaleByPhaseFraction; then
// folds the deltas (c098), lays the header (c765, X=0x61), appends a (mantissa,exponent) pair (bd3e) and
// draws (df59). REGISTER-THREAD DISSOLVE: bd3e now RETURNS its exit Y (= $a9 + 2); the ROM leaves that Y
// in place and consumes it with `sty $a9`, so the module captures the return and PERSISTS it to $a9, then
// reloads df59's cursor offset from that $a9 -- threading bd3e's return, not the pre-call $a9 (=0). The
// threaded register is verified in RAM ($a9 + the downstream cursor $74 / vector-list stores); the TEETH
// arm proves that threading the WRONG register (the stale pre-bd3e $a9) diverges there.
// Live-out is memory only (b69b tail-jmps df59, whose product is the vector list + cursor), so each arm
// runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). The coprocessor is
// instantaneous and deterministic, so identical seeds yield identical reads on both arms.
// Run: node --test games/tempest/idiomatic/test/equivalence-b69b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b69b } from "../../translated/loc_b69b.js";
import { emitInterpolatedSlotVector } from "../emitInterpolatedSlotVector.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { scaleByPhaseFraction } from "../scaleByPhaseFraction.js";
import { projectPointThroughMathbox } from "../projectPointThroughMathbox.js";
import { layHeaderAndBuildRecord } from "../layHeaderAndBuildRecord.js";
import { appendNormalizedMantissaExponent } from "../appendNormalizedMantissaExponent.js";
import { emitVectorWordAtOffset } from "../emitVectorWordAtOffset.js";
import {
  FRAME_COUNTER, PROJ_PT_Y, OBJ_DEPTH, PROJ_PT_X, DRAW_CURSOR_OFFSET,
  ENEMY_SEGMENT, ENEMY_PHASE, ENEMY_DEPTH, SEG_BASE_X, SEG_BASE_Y, OBJ_TEMPLATE_WORD_LO, OBJ_TEMPLATE_WORD_HI,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb69b;
const oracle = atEntry(loc_b69b);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 8000) : [];

// Non-default seed: slot 0 with phase bit7 SET (0x85 -> fraction 5) so the interpolation branch runs,
// a coord and distinct seg/next segment endpoints, the cursor $74/$75 aimed into vector RAM (0x2800),
// and the c098/bd3e math-box operands. Both arms get identical seeds, so any RAM divergence is a real
// behavioural difference (not a seed artifact).
function seedInterp(m) {
  m.regs.x = 0;
  m.mem.write8(ENEMY_DEPTH, 0x40);              // slot coord -> $57
  m.mem.write8(ENEMY_SEGMENT, 0x03);              // segment index (Y)
  m.mem.write8(ENEMY_PHASE, 0x85);             // phase: bit7 set, low bits = fraction 5
  m.mem.write8((SEG_BASE_X + 3) & 0xffff, 0x40); // $03ce[seg]
  m.mem.write8((SEG_BASE_Y + 3) & 0xffff, 0x50); // $03de[seg]
  m.mem.write8((SEG_BASE_X + 4) & 0xffff, 0x60); // $03ce[next]
  m.mem.write8((SEG_BASE_Y + 4) & 0xffff, 0x30); // $03de[next]
  m.mem.write8(0x74, 0x00); m.mem.write8(0x75, 0x28); // cursor -> 0x2800 (vector RAM)
  m.mem.write8(0x5b, 0x00); m.mem.write8(0x5e, 0x30); m.mem.write8(0x5f, 0x10); m.mem.write8(0x60, 0x20);
  m.mem.write8(0x66, 0x03); m.mem.write8(0x67, 0x00); m.mem.write8(0x68, 0x05); m.mem.write8(0x69, 0x00);
  m.mem.write8(0xa0, 0x08);                 // bd3e exponent operand
  m.mem.write8(FRAME_COUNTER, 0x02);                // $03 -> cec8/cec9 table index
}
function seedNoInterp(m) { seedInterp(m); m.mem.write8(ENEMY_PHASE, 0x05); } // phase bit7 CLEAR -> no interpolation

test("CAPTURE: real 0xb69b dispatches -- emitInterpolatedSlotVector == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitInterpolatedSlotVector(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED (interpolation): phase bit7 set -- emitInterpolatedSlotVector == oracle, $56/$58 interpolate and Y threads to $a9", () => {
  const o = new Machine(ROM, OPTS); seedInterp(o);
  const c = new Machine(ROM, OPTS); seedInterp(c);
  oracle(o); emitInterpolatedSlotVector(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run (interpolation path)");
  assert.notEqual(c.mem.read8(PROJ_PT_Y), 0x40, "interpolation moved $56 off its direct seg value");
  assert.equal(c.mem.read8(PROJ_PT_Y), o.mem.read8(PROJ_PT_Y), "$56 matches oracle");
  assert.equal(c.mem.read8(PROJ_PT_X), o.mem.read8(PROJ_PT_X), "$58 matches oracle");
  assert.equal(c.mem.read8(DRAW_CURSOR_OFFSET), 0x02, "bd3e exit Y (= seeded $a9 0 + 2) persisted to $a9");
});

test("CRAFTED (no interpolation): phase bit7 clear -- direct seg values, RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedNoInterp(o);
  const c = new Machine(ROM, OPTS); seedNoInterp(c);
  oracle(o); emitInterpolatedSlotVector(c);
  assert.equal(ramDiff(o, c), null, "RAM equal (no-interpolation path)");
  assert.equal(c.mem.read8(PROJ_PT_Y), 0x40, "$56 is the direct seg value (no interpolation)");
  assert.equal(c.mem.read8(PROJ_PT_X), 0x50, "$58 is the direct seg value (no interpolation)");
});

test("TEETH (register thread): a twin that discards bd3e's return (stale $a9) diverges in $a9 + cursor", () => {
  const o = new Machine(ROM, OPTS); seedInterp(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedInterp(c);
  // Faithful head, but the register thread is BROKEN: bd3e's returned Y is discarded so $a9 keeps its
  // pre-call 0, and df59's cursor offset reloads that stale 0 instead of the extended callee's exit Y.
  const wrongThread = (m, x = m.regs.x) => {
    const { mem8 } = m;
    mem8[OBJ_DEPTH] = mem8[u16(ENEMY_DEPTH + x)];
    const seg = mem8[u16(ENEMY_SEGMENT + x)];
    mem8[PROJ_PT_Y] = mem8[u16(SEG_BASE_X + seg)];
    mem8[PROJ_PT_X] = mem8[u16(SEG_BASE_Y + seg)];
    const phase = mem8[u16(ENEMY_PHASE + x)];
    if (phase & 0x80) {
      const next = (seg + 1) & 0x0f;
      let d0 = (mem8[u16(SEG_BASE_X + next)] - mem8[PROJ_PT_Y]) & 0xff;
      d0 = scaleByPhaseFraction(m, d0, x); mem8[PROJ_PT_Y] = (d0 + mem8[PROJ_PT_Y]) & 0xff;
      let d1 = (mem8[u16(SEG_BASE_Y + next)] - mem8[PROJ_PT_X]) & 0xff;
      d1 = scaleByPhaseFraction(m, d1, x); mem8[PROJ_PT_X] = (d1 + mem8[PROJ_PT_X]) & 0xff;
    }
    projectPointThroughMathbox(m);
    layHeaderAndBuildRecord(m, 0x61);
    mem8[DRAW_CURSOR_OFFSET] = 0x00;
    appendNormalizedMantissaExponent(m); // BUG: return discarded, $a9 left at the stale 0
    const idx = (((mem8[FRAME_COUNTER] & 0x03) << 1) + 0x4e) & 0xff;
    const a = mem8[u16(OBJ_TEMPLATE_WORD_LO + idx)];
    const hx = mem8[u16(OBJ_TEMPLATE_WORD_HI + idx)];
    const y = mem8[DRAW_CURSOR_OFFSET]; // = 0 (stale), NOT the threaded exit Y (= 2)
    return emitVectorWordAtOffset(m, a, hx, y);
  };
  wrongThread(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong (stale) register thread");
  assert.notEqual(c.mem.read8(DRAW_CURSOR_OFFSET), o.mem.read8(DRAW_CURSOR_OFFSET), "$a9 (the persistently-stashed cell) must diverge");
});

test("TEETH (mutation): a twin that skips interpolation when phase bit7 is set diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedInterp(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedInterp(c);
  const noInterpTwin = (m, x = m.regs.x) => {
    const { mem8 } = m;
    mem8[OBJ_DEPTH] = mem8[u16(ENEMY_DEPTH + x)];
    const seg = mem8[u16(ENEMY_SEGMENT + x)];
    mem8[PROJ_PT_Y] = mem8[u16(SEG_BASE_X + seg)];
    mem8[PROJ_PT_X] = mem8[u16(SEG_BASE_Y + seg)];
    // BUG: never interpolates, even though phase bit7 is set.
    projectPointThroughMathbox(m);
    layHeaderAndBuildRecord(m, 0x61);
    mem8[DRAW_CURSOR_OFFSET] = 0x00;
    const yExit = appendNormalizedMantissaExponent(m);
    mem8[DRAW_CURSOR_OFFSET] = yExit;
    const idx = (((mem8[FRAME_COUNTER] & 0x03) << 1) + 0x4e) & 0xff;
    const a = mem8[u16(OBJ_TEMPLATE_WORD_LO + idx)];
    const hx = mem8[u16(OBJ_TEMPLATE_WORD_HI + idx)];
    const y = mem8[DRAW_CURSOR_OFFSET];
    return emitVectorWordAtOffset(m, a, hx, y);
  };
  noInterpTwin(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped interpolation");
});

test("SP-TOOTH: the omitted-ret dissolve (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedInterp(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, emitInterpolatedSlotVector, TARGET, m);
  assert.equal(r.placeable, true, `emitInterpolatedSlotVector must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret dissolve (moved 0) placeable");
});
