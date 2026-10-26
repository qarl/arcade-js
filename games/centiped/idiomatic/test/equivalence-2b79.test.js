// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_2b79 (ROM 0x2b79-0x2b91) -- a three-cell zero-page fixup: DERIVE
// loc_72 = (loc_73 + (0x04 ^ loc_f0)) & 0xff, MIRROR loc_62 = loc_63, and GATE loc_42 = 0x28 only when
// (loc_43 & 0xaf) != 0. Live-out is memory only (A/flags at RTS are incidental), so each side runs on a
// clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). A leaf: the module omits the ROM ret and
// the seam completes it, so the arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/centiped/idiomatic/test/equivalence-2b79.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b79 as oracleRom } from "../../translated/loc_2b79.js";
import { loc_2b79 } from "../loc_2b79.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_42, loc_43, loc_62, loc_63, loc_72, loc_73, loc_f0 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2b79;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(32, 1500) : [];

test("CAPTURE: real 0x2b79 dispatches -- loc_2b79 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_2b79(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: derive loc_72, mirror loc_63->loc_62, and gate loc_42 on (loc_43 & 0xaf)", () => {
  const cases = [
    // f0, cell73, cell63, cell43, expected: {c72, c62, gate}
    { f0: 0x00, c73: 0x10, c63: 0x50, c43: 0x77, c72: 0x14, gate: true },  // (0x10 + (4^0x00))       ; 0x77 & 0xaf = 0x27 -> set
    { f0: 0xff, c73: 0x01, c63: 0xff, c43: 0x00, c72: 0xfc, gate: false }, // (0x01 + (4^0xff=0xfb))    ; 0x00 & 0xaf = 0    -> skip
    { f0: 0x7d, c73: 0x88, c63: 0x00, c43: 0x22, c72: 0x01, gate: true },  // (0x88 + (4^0x7d=0x79))=0x101->0x01; 0x22 & 0xaf = 0x22 -> set
    { f0: 0x00, c73: 0xf0, c63: 0xaa, c43: 0x50, c72: 0xf4, gate: false }, // 0x50 & 0xaf = 0x00 -> skip (proves the mask, not "nonzero 43")
    { f0: 0x00, c73: 0xf0, c63: 0xaa, c43: 0x10, c72: 0xf4, gate: false }, // 0x10 & 0xaf = 0x00 -> skip
  ];
  const SENTINEL42 = 0x99;
  for (const { f0, c73, c63, c43, c72, gate } of cases) {
    const seed = (m) => {
      m.regs.s = 0x30;
      m.mem.write8(loc_f0, f0); m.mem.write8(loc_73, c73); m.mem.write8(loc_63, c63);
      m.mem.write8(loc_43, c43); m.mem.write8(loc_42, SENTINEL42); m.mem.write8(loc_62, 0x77); m.mem.write8(loc_72, 0x55);
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); loc_2b79(c);
    const tag = `f0=0x${f0.toString(16)} 43=0x${c43.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.mem.read8(loc_72), c72, `derive loc_72 ${tag}`);
    assert.equal(c.mem.read8(loc_62), c63, `mirror loc_62 ${tag}`);
    assert.equal(c.mem.read8(loc_42), gate ? 0x28 : SENTINEL42, `gate loc_42 ${tag}`);
  }
});

test("TEETH: a twin that skips the gated loc_42 store is caught by the RAM diff", () => {
  const seed = (m) => {
    m.regs.s = 0x30;
    m.mem.write8(loc_f0, 0x00); m.mem.write8(loc_73, 0x10); m.mem.write8(loc_63, 0x50);
    m.mem.write8(loc_43, 0x77); m.mem.write8(loc_42, 0x99); // 0x77 & 0xaf = 0x27 -> the store SHOULD fire
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o);
  const brokenLoc2b79 = (m) => {
    const mem = m.mem8;
    mem[loc_72] = (mem[loc_73] + (0x04 ^ mem[loc_f0])) & 0xff;
    mem[loc_62] = mem[loc_63];
    // BUG: never performs the gated loc_42 := 0x28 store
  };
  brokenLoc2b79(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the skipped loc_42 store");
  assert.equal(d.addr, loc_42 & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); // a real caller-return word (ret-1) for the seam to consume
  m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, loc_2b79, TARGET, m);
  assert.equal(r.placeable, true, `loc_2b79 must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
