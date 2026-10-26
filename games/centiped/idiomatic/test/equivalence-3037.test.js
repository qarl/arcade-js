// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_3037 (0x3037) -- stashes Y at $8b, seeds A = 0 as a register bridge into the
// frozen advance (kept call), then tail-dispatches. Observable output is RAM only, so every arm checks the
// RAM diff minus stack scratch below the entry SP. The A = 0 bridge is load-bearing on the advance's non-skip path (it feeds the
// BCD add), so a crafted arm re-seats it and a mutation arm proves the RAM diff catches its absence.
// Run: node --test games/centiped/idiomatic/test/equivalence-3037.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3037 as oracleRom } from "../../translated/loc_3037.js";
import { loc_3037 } from "../loc_3037.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_8b, loc_86, loc_87, loc_88, loc_94, loc_a7, loc_ad, loc_af } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3037;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// $86 sign steers the advance: negative -> skip; non-negative -> BCD add (target $ad/$af large keeps it on
// the shallow return path, no deeper JSR). A clean tail ($87/$88/$94 = 0) gives a simple ret.
function seed(m, s = {}) {
  m.mem8[loc_86] = s.c86 ?? 0;
  m.mem8[loc_87] = s.c87 ?? 0;
  m.mem8[loc_88] = s.c88 ?? 0;
  m.mem8[loc_94] = s.c94 ?? 0;
  m.mem8[loc_ad] = s.cad ?? 0;
  m.mem8[loc_af] = s.caf ?? 0;
  m.regs.a = s.a ?? 0;
  m.regs.x = s.x ?? 0;
  m.regs.y = s.y ?? 0;
}

test("CAPTURE: real 0x3037 dispatches -- loc_3037 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_3037(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: skip path and BCD-add path (dirty entry A) == oracle (RAM)", () => {
  const cases = [
    { tag: "advance skipped ($86 negative)", c86: 0x80, a: 0x77, x: 0x05, y: 0x03 },
    { tag: "advance runs, A bridged to 0", c86: 0x00, a: 0x77, x: 0x05, y: 0x03, cad: 0x50, caf: 0x50 },
    { tag: "advance runs, Y = 0", c86: 0x00, a: 0x00, x: 0x0b, y: 0x00, cad: 0x50, caf: 0x50 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); loc_3037(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("CRAFTED: the step addend lands at $8b", () => {
  const c = new Machine(ROM); seed(c, { c86: 0x80, y: 0x2a });
  loc_3037(c);
  assert.equal(c.mem8[loc_8b], 0x2a, "$8b holds Y");
});

test("MUTATION: dropping the A = 0 re-seat diverges the advance (RAM diff catches it)", () => {
  const s = { c86: 0x00, a: 0x77, x: 0x05, y: 0x03, cad: 0x50, caf: 0x50 };
  const o = new Machine(ROM); seed(o, s); // oracle forces A = 0
  const noReseat = (m, y = m.regs.y) => { // BUG: never re-seats A -> a dirty A feeds the BCD add
    m.mem8[loc_8b] = y;
    m.push16(0x303d);
    m.call(0x2db6);
    return m.call(0x303e);
  };
  const c = new Machine(ROM); seed(c, s);
  oracle(o); noReseat(c);
  assert.equal(o.mem8[loc_a7], 0x00, "precondition: oracle's forced A = 0 left $a7 clear");
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a missing A bridge");
});

test("SP-TOOTH: the +2 dispatcher is seam-placeable, and a dropped push16 is refused", () => {
  const mk = () => {
    const m = new Machine(ROM);
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word
    seed(m, { c86: 0x80 }); // skip path keeps the advance leaf-simple
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, loc_3037, TARGET, mk());
  assert.equal(ok.placeable, true, `loc_3037 must be seam-placeable; got: ${ok.error}`);

  // Null-mutant: drop the kept call's push16 -> the frozen advance's ret pops the caller word and SP goes
  // adrift; the seam MUST refuse it.
  const noPush = (m, y = m.regs.y) => {
    m.mem8[loc_8b] = y;
    m.regs.a = 0x00;
    m.call(0x2db6);
    return m.call(0x303e);
  };
  const bad = seamPlaceable(withOmittedRet, noPush, TARGET, mk());
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse a dropped push16");
  console.log("  SP-TOOTH: +2 dispatcher placeable; dropped push16 refused");
});
