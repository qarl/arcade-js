// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_166b (ROM 0x166b) -- the fleetReachedEdge scan's "found" sentinel (stc; ret). Live-out:
// the CARRY flag (set), read by reverseFleetAtEdge via rnc; no RAM write. The idiomatic form omits the ROM ret (the
// seam completes it) and returns true. Live-out DERIVED FROM THE ORACLE: its only effect is stc.
// Run: node --test games/invaders/idiomatic/test/equivalence-166b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_166b as oracleBody } from "../../translated/loc_166b.js";
import { loc_166b } from "../loc_166b.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x166b;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x166b dispatches -- loc_166b == oracle in RAM (-stack) and carry", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); loc_166b(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.fC, o.regs.fC, "carry live-out matches the oracle");
    assert.equal(c.regs.fC, true, "carry set (found)");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: sets carry and returns true from a clear-carry entry", () => {
  const seed = (m) => { m.regs.sp = 0x2400; m.regs.fC = false; m.io.setInte(false); };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  const ret = loc_166b(c);
  oracle(o);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.regs.fC, true, "carry set");
  assert.equal(ret, true, "returns true (found)");
  assert.equal(c.regs.fC, o.regs.fC, "carry matches oracle");
});

test("TEETH: a twin that leaves carry clear diverges from the oracle's set carry", () => {
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.regs.fC = false; o.io.setInte(false);
  oracle(o);
  const brokenCarry = false; // BUG: leaves carry clear instead of setting it
  assert.notEqual(brokenCarry, o.regs.fC, "the carry live-out check FAILED to catch a not-set carry");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.sp = 0x2400;
  m.mem.write16(0x2400, 0x15cc); // a real caller-return word (fleetReachedEdge's continuation) for the seam
  m.io.setInte(false);
  const r = seamPlaceable(withOmittedRet, loc_166b, TARGET, m);
  assert.equal(r.placeable, true, `loc_166b must be seam-placeable; got: ${r.error}`);
});
