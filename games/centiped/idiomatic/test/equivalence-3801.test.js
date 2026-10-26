// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for rewritePointerTableRowFromStart (ROM 0x3801, second entry of writePointerTableRow):
// `sty $8b` then the shared emit loop over the current loc_93/loc_94 descriptor. RAM-only: Y/C/A/X left by
// the loop are dead at every loc_3825 jsr site (0x2130, 0x3e97, 0x3f79, 0x3fbb); via 0x2130, Y and C can
// escape 2119's rts at 218c (A/X are reloaded at 2133/213e), and die in 2034's jsr 32fe (sec; 384f->3836 tay).
// Run: node --test games/centiped/idiomatic/test/equivalence-3801.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3801 as oracleRom } from "../../translated/loc_37d5.js";
import { rewritePointerTableRowFromStart } from "../writePointerTableRow.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_8c, loc_91, loc_93, loc_ef, loc_f3 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3801;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Real 0x3801 dispatches arrive via loc_3825's BEQ (the default table runs the oracle, so m.call fires).
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 2500) : [];

const DESC = 0x0280, OUT = 0x0300;
// A real captured dispatch with the descriptor, cursor and loop inputs poked.
function seed({ bytes, y = 0, sign = 0x00, mask = 0x00, f3 = 0x00 }) {
  const m = CAPS[0].clone();
  m.mem.write16(loc_93, DESC);
  m.mem.write16(loc_91, OUT);
  m.mem.write8(loc_ef, mask);
  m.mem.write8(loc_f3, f3);
  m.mem.write8(loc_8c, sign);
  m.regs.y = y;
  for (let i = 0; i < bytes.length; i++) m.mem.write8(DESC + i, bytes[i]);
  return m;
}

function same(o, c, tag) {
  oracle(o); rewritePointerTableRowFromStart(c);
  assert.equal(ramDiff(o, c), null, tag);
}

test("CAPTURE: real 0x3801 dispatches -- rewritePointerTableRowFromStart == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "no 0x3801 dispatches captured");
  for (const cap of CAPS) {
    assert.equal(cap.regs.y, 0, "loc_3825 always enters with Y=0");
    same(cap.clone(), cap.clone(), "capture");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Real dispatches always carry Y=0 and loc_8c=0; poke the blank flag and a nonzero start index identically.
test("CRAFTED: real entries with blank flag set / nonzero start index == oracle (RAM -stack)", () => {
  const variants = [
    { tag: "loc_8c bit7 set", mut: (m) => m.mem.write8(loc_8c, 0x80) },
    { tag: "Y=1", mut: (m) => { m.regs.y = 1; } },
    { tag: "Y=4", mut: (m) => { m.regs.y = 4; } },
  ];
  for (const v of variants) for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    v.mut(o); v.mut(c);
    same(o, c, v.tag);
  }
});

// Manufactured rows pin every emit-loop branch: space, sign-blank, 0x30 fold, plain, single terminator.
test("CRAFTED: manufactured rows cover each emit-loop branch == oracle", () => {
  const cases = [
    { tag: "plain + space", bytes: [0x41, 0x20, 0xc3] },
    { tag: "0x30 fold", bytes: [0x35, 0x3f, 0xb1] },
    { tag: "sign blanks all", bytes: [0x41, 0x42, 0xc3], sign: 0x80 },
    { tag: "single terminator", bytes: [0x81] },
    { tag: "start mid-row Y=2", bytes: [0x41, 0x42, 0x43, 0xc4], y: 2 },
    { tag: "mask + page cross", bytes: [0x41, 0x22, 0xc3], mask: 0x03, f3: 0x01 },
  ];
  for (const cs of cases) same(seed(cs), seed(cs), cs.tag);
});

test("TEETH: a twin that ignores the Y start index is caught at a real cell", () => {
  const broken = (m) => rewritePointerTableRowFromStart(m, (m.regs.y + 1) & 0xff); // BUG: off-by-one start
  const o = CAPS[0].clone(), c = CAPS[0].clone();
  oracle(o); broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch an off-by-one start index");
  console.log(`  TEETH: caught at ${JSON.stringify(d)}`);
  const so = seed({ bytes: [0x41, 0x42, 0xc3] }), sc = seed({ bytes: [0x41, 0x42, 0xc3] });
  oracle(so); broken(sc);
  assert.notEqual(sc.mem.read8(loc_91), so.mem.read8(loc_91), "loc_91 cursor must diverge");
  assert.notEqual(ramDiff(so, sc), null);
});

test("SP-TOOTH: the omitted-ret entry is seam-placeable; a pushing twin is not", () => {
  const r = seamPlaceable(withOmittedRet, rewritePointerTableRowFromStart, TARGET, CAPS[0].clone());
  assert.equal(r.placeable, true, `rewritePointerTableRowFromStart must be seam-placeable; got: ${r.error}`);
  const mutant = (m) => { m.push16(0xffff); return rewritePointerTableRowFromStart(m); };
  const r2 = seamPlaceable(withOmittedRet, mutant, TARGET, CAPS[0].clone());
  assert.equal(r2.placeable, false, "the SP-tooth FAILED to refuse an SP-adrift mutant");
});
