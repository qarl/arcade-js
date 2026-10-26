// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for objectMatchesDrawPhase (ROM 0x1a06) -- raster draw-phase predicate. Reads mem[DE]
// and the draw-phase flag mem[DRAW_PHASE_FLAG]; no RAM write. TWO live-outs (both derived from the oracle):
// the CARRY flag (xra clears carry on a mismatch -> rnz; stc sets it on a match), which callers read to
// skip an object not in this half-frame; and HL, left by the oracle's lxi h at the flag address -- a
// frozen caller advances HL and reads through it, so the module must seat HL too. A leaf: the module omits the ROM ret and the seam
// completes it, so the arms compare RAM (-stack) + the carry and HL live-outs, NOT pc/SP.
// Run: node --test games/invaders/idiomatic/test/equivalence-1a06.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a06 as oracleBody } from "../../translated/loc_1a06.js";
import { objectMatchesDrawPhase } from "../objectMatchesDrawPhase.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { DRAW_PHASE_FLAG } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1a06;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1a06 dispatches -- objectMatchesDrawPhase == oracle in RAM (-stack) and carry", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); objectMatchesDrawPhase(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.fC, o.regs.fC, "carry live-out matches the oracle");
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: carry := (mem[DE] & 0x80) === mem[DRAW_PHASE_FLAG] across the match/mismatch cases", () => {
  const DE = 0x2100;
  const cases = [
    { obj: 0x00, flag: 0x00, match: true },
    { obj: 0x80, flag: 0x80, match: true },
    { obj: 0x7f, flag: 0x00, match: true },  // bit7 clear on both -> 0x00 == 0x00
    { obj: 0xff, flag: 0x80, match: true },  // bit7 set on both -> 0x80 == 0x80
    { obj: 0x80, flag: 0x00, match: false },
    { obj: 0x00, flag: 0x80, match: false },
    { obj: 0x00, flag: 0x01, match: false }, // full-byte compare: 0x00 != 0x01 even with bit7 clear
  ];
  for (const { obj, flag, match } of cases) {
    const seed = (m) => { m.regs.de = DE; m.mem.write8(DE, obj); m.mem.write8(DRAW_PHASE_FLAG, flag); m.io.setInte(false); };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); objectMatchesDrawPhase(c);
    const tag = `obj=0x${obj.toString(16)} flag=0x${flag.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.fC, match, `carry computed: ${tag}`);
    assert.equal(c.regs.fC, o.regs.fC, `carry matches oracle: ${tag}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
  }
});

test("TEETH: a broken twin (inverted compare) mis-sets the carry live-out", () => {
  const DE = 0x2100, obj = 0x80, flag = 0x80;  // a match case
  const seed = (m) => { m.regs.de = DE; m.mem.write8(DE, obj); m.mem.write8(DRAW_PHASE_FLAG, flag); m.io.setInte(false); };
  const o = new Machine(ROM); seed(o);
  oracle(o);
  const brokenCarry = (obj & 0x80) !== flag; // BUG: inverted predicate
  assert.notEqual(brokenCarry, o.regs.fC, "the carry live-out check FAILED to catch an inverted compare");
});

test("TEETH: a twin that drops the HL live-out leaves HL unseated", () => {
  const seed = (m) => { m.regs.de = 0x2100; m.regs.hl = 0x1234; m.mem.write8(0x2100, 0x80); m.mem.write8(DRAW_PHASE_FLAG, 0x80); m.io.setInte(false); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o);
  function loc_1a06_noHL(m, de = m.regs.de) { return (m.regs.fC = (m.mem8[de] & 0x80) === m.mem8[DRAW_PHASE_FLAG]); } // BUG: never seats HL
  loc_1a06_noHL(c);
  assert.equal(o.regs.hl, DRAW_PHASE_FLAG, "oracle leaves HL at the flag address");
  assert.notEqual(c.regs.hl, o.regs.hl, "the HL live-out check FAILED to catch the dropped HL seat");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x2400;
  m.mem.write16(0x2400, 0xabcd);   // a real caller-return word for the seam to consume
  m.regs.de = 0x2100;
  m.io.setInte(false);
  const r = seamPlaceable(withOmittedRet, objectMatchesDrawPhase, TARGET, m);
  assert.equal(r.placeable, true, `objectMatchesDrawPhase must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
