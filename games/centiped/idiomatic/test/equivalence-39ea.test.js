// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for stepAxisBySelectorBits (ROM 0x39ea) -- decode A's top two bits into a bounded Y-axis
// step and double A. Writes NO memory, so RAM is a vacuous contract; the live-out is REGISTERS (A = the
// doubled code, Y = the stepped axis). Flags are dead (the caller TYAs before reading N/Z), so we compare
// only A and Y -- not firstRegDiff, which would false-fail on P/S.
// Run: node --test games/centiped/idiomatic/test/equivalence-39ea.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_39ea as oracleRom } from "../../translated/loc_39ea.js";
import { stepAxisBySelectorBits } from "../stepAxisBySelectorBits.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x39ea;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// The live-out registers this routine produces (data only -- P/S excluded).
const OUT = ["a", "y"];
const regOutDiff = (o, c) => {
  for (const k of OUT) if (o.regs[k] !== c.regs[k]) return { reg: k, o: o.regs[k], c: c.regs[k] };
  return null;
};

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x39ea dispatches -- stepAxisBySelectorBits == oracle in RAM + live-out A/Y", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); stepAxisBySelectorBits(c);
    assert.equal(ramDiff(o, c), null);      // neither side touches RAM
    assert.equal(regOutDiff(o, c), null);   // the real contract: A (doubled) + Y (stepped)
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: every selector x window boundary maps A/Y like the oracle", () => {
  // Selector lives in A bits 7,6. Cover each selector across the Y window boundaries it clamps to.
  const cases = [];
  for (const a of [0x00, 0x3f]) {          // bit7==0: DOWN, clamp into 0xfa..0xff
    for (const y of [0xfa, 0xfb, 0xff, 0x00, 0xf9, 0x80]) cases.push({ a, y });
  }
  for (const a of [0x80, 0xbf]) {          // bit7==1,bit6==0: UP, clamp into 0x01..0x06
    for (const y of [0x06, 0x05, 0x00, 0x07, 0xff, 0x40]) cases.push({ a, y });
  }
  for (const a of [0xc0, 0xff]) {          // bit7==1,bit6==1: zero Y
    for (const y of [0x00, 0x33, 0xff]) cases.push({ a, y });
  }
  for (const { a, y } of cases) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    o.regs.a = a; o.regs.y = y; c.regs.a = a; c.regs.y = y;
    oracle(o); stepAxisBySelectorBits(c);
    const label = `a=0x${a.toString(16)} y=0x${y.toString(16)}`;
    assert.equal(regOutDiff(o, c), null, label);
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.regs.a, (a << 2) & 0xff, `A doubled ${label}`); // A_out == (A_in << 2)
  }
});

test("TEETH: a broken twin (wrong DOWN clamp) is caught by the register contract", () => {
  // Broken: decrements unconditionally on the DOWN path (no 0xfa floor, no snap-to-0xff).
  function loc_39ea_broken(m, a = m.regs.a, y = m.regs.y) {
    let newY;
    if ((a & 0x80) === 0) newY = (y - 1) & 0xff;                 // BUG: no clamp into 0xfa..0xff
    else if ((a & 0x40) === 0) newY = y === 0x06 ? 0x06 : y < 0x06 ? (y + 1) & 0xff : 0x01;
    else newY = 0x00;
    m.regs.y = newY;
    return (m.regs.a = (a << 2) & 0xff);
  }
  const o = new Machine(ROM); const c = new Machine(ROM);
  o.regs.a = 0x00; o.regs.y = 0x50; c.regs.a = 0x00; c.regs.y = 0x50; // below the window -> oracle snaps to 0xff
  oracle(o); loc_39ea_broken(c);
  const d = regOutDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong DOWN clamp");
  assert.equal(d.reg, "y");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write16(0x01fe, 0x38ca); // a real caller-return word for the seam to consume
  m.regs.a = 0x40; m.regs.y = 0x03;
  const r = seamPlaceable(withOmittedRet, stepAxisBySelectorBits, TARGET, m);
  assert.equal(r.placeable, true, `stepAxisBySelectorBits must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
