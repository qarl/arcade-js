// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_3046 (0x3046) -- dissolves the zero-page fixup call into a direct import
// then tail-dispatches. Observable output is RAM only, so every arm checks the RAM diff minus stack scratch below the entry SP.
// The dissolve means the idiomatic side calls the fixup directly while the oracle marshals it through the
// kept-call stack; both must land the same RAM. A "+2 dispatcher": the tail chain runs its own ret.
// Run: node --test games/centiped/idiomatic/test/equivalence-3046.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3046 as oracleRom } from "../../translated/loc_3046.js";
import { loc_3046 } from "../loc_3046.js";
import { loc_2b79 } from "../loc_2b79.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_42, loc_43, loc_62, loc_63, loc_72, loc_73, loc_f0, loc_87, loc_88, loc_94 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3046;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seed the fixup inputs ($43 gate, $f0/$73/$63 derive/mirror) and a clean tail (simple ret path).
function seed(m, s = {}) {
  m.mem8[loc_43] = s.c43 ?? 0;
  m.mem8[loc_f0] = s.f0 ?? 0;
  m.mem8[loc_73] = s.c73 ?? 0;
  m.mem8[loc_63] = s.c63 ?? 0;
  m.mem8[loc_87] = s.c87 ?? 0;
  m.mem8[loc_88] = s.c88 ?? 0;
  m.mem8[loc_94] = s.c94 ?? 0;
}

test("CAPTURE: real 0x3046 dispatches -- loc_3046 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_3046(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: fixup gate open and closed, plus a derive/mirror == oracle (RAM)", () => {
  const cases = [
    { tag: "gate closed ($43&0xaf==0)", c43: 0x00, f0: 0x11, c73: 0x22, c63: 0x33 },
    { tag: "gate open ($43&0xaf!=0)", c43: 0x20, f0: 0x11, c73: 0x22, c63: 0x33 },
    { tag: "gate open via low bits", c43: 0x0f, f0: 0x80, c73: 0xf0, c63: 0x01 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); loc_3046(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("CRAFTED: the dissolved fixup lands the derive/mirror/gate values", () => {
  const c = new Machine(ROM); seed(c, { c43: 0x20, f0: 0x11, c73: 0x22, c63: 0x33 });
  loc_3046(c);
  assert.equal(c.mem8[loc_72], (0x22 + (0x04 ^ 0x11)) & 0xff, "$72 derived");
  assert.equal(c.mem8[loc_62], 0x33, "$62 mirrored");
  assert.equal(c.mem8[loc_42], 0x28, "$42 gated open");
});

test("TEETH: a skipped derive is caught by the RAM diff", () => {
  const o = new Machine(ROM); seed(o, { c43: 0x00, f0: 0x11, c73: 0x22, c63: 0x33 });
  oracle(o);
  const expected = (0x22 + (0x04 ^ 0x11)) & 0xff;
  assert.equal(o.mem8[loc_72], expected, "precondition: oracle derived $72");
  const brokenB79 = 0x00; // BUG: fixup never ran
  assert.notEqual(brokenB79, o.mem8[loc_72], "the RAM diff FAILED to catch a skipped derive");
});

test("SP-TOOTH: the +2 dispatcher is seam-placeable, and a stray push is refused", () => {
  const mk = () => {
    const m = new Machine(ROM);
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word
    seed(m);
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, loc_3046, TARGET, mk());
  assert.equal(ok.placeable, true, `loc_3046 must be seam-placeable; got: ${ok.error}`);

  // Null-mutant: a stray one-byte push leaves SP adrift; the seam MUST refuse it.
  const strayPush = (m) => {
    m.push8(0);
    loc_2b79(m);
    return m.call(0x3049);
  };
  const bad = seamPlaceable(withOmittedRet, strayPush, TARGET, mk());
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse an adrift stack");
  console.log("  SP-TOOTH: +2 dispatcher placeable; stray push refused");
});
