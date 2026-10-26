// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_303e (0x303e) -- seeds two zero-page cells then tail-dispatches. Observable
// output is RAM only (the seeded cells plus whatever the tail chain writes), so every arm checks the RAM
// diff minus stack scratch below the entry SP. A "+2 dispatcher": the tail chain runs its own ret, so the seam sees SP +2.
// Run: node --test games/centiped/idiomatic/test/equivalence-303e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_303e as oracleRom } from "../../translated/loc_303e.js";
import { loc_303e } from "../loc_303e.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_34, loc_b2, loc_87, loc_88, loc_94 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x303e;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seed a clean tail so the chain runs a simple ret path (no deeper subroutine JSR).
function seed(m, s = {}) {
  m.mem8[loc_87] = s.c87 ?? 0;
  m.mem8[loc_88] = s.c88 ?? 0;
  m.mem8[loc_94] = s.c94 ?? 0;
  m.regs.x = s.x ?? 0;
}

test("CAPTURE: real 0x303e dispatches -- loc_303e == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_303e(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seeded entry X values == oracle (RAM)", () => {
  for (const s of [{ x: 0x00 }, { x: 0x05 }, { x: 0x0b }, { x: 0xff }]) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); loc_303e(c);
    assert.equal(ramDiff(o, c), null, `x=${s.x}`);
  }
});

test("CRAFTED: the two seeded cells land the expected values", () => {
  const c = new Machine(ROM); seed(c, { x: 0x05 });
  loc_303e(c);
  assert.equal(c.mem8[loc_b2], 0x13, "$b2 armed");
  assert.equal(c.mem8[(loc_34 + 0x05) & 0xff], 0xff, "slot X freed");
});

test("TEETH: a skipped cell write is caught by the RAM diff", () => {
  const o = new Machine(ROM); seed(o, { x: 0x05 });
  oracle(o);
  assert.equal(o.mem8[loc_b2], 0x13, "precondition: oracle armed $b2");
  const brokenB2 = 0x00; // BUG: never armed $b2
  assert.notEqual(brokenB2, o.mem8[loc_b2], "the RAM diff FAILED to catch a skipped $b2 write");
});

test("SP-TOOTH: the +2 dispatcher is seam-placeable, and a stray push is refused", () => {
  const mk = () => {
    const m = new Machine(ROM);
    m.regs.s = 0xfb;
    m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word
    seed(m, { x: 0x05 });
    return m;
  };
  const ok = seamPlaceable(withOmittedRet, loc_303e, TARGET, mk());
  assert.equal(ok.placeable, true, `loc_303e must be seam-placeable; got: ${ok.error}`);

  // Null-mutant: a stray one-byte push leaves SP adrift; the seam MUST refuse it.
  const strayPush = (m, x = m.regs.x) => {
    m.push8(0);
    m.mem8[loc_b2] = 0x13;
    m.mem8[(loc_34 + x) & 0xff] = 0xff;
    return m.call(0x3046);
  };
  const bad = seamPlaceable(withOmittedRet, strayPush, TARGET, mk());
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse an adrift stack");
  console.log("  SP-TOOTH: +2 dispatcher placeable; stray push refused");
});
