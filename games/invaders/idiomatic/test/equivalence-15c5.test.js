// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for fleetReachedEdge (ROM 0x15c5) -- scan 0x17 bytes upward from HL for the first nonzero.
// Live-out (DERIVED FROM THE ORACLE): the CARRY flag -- set=found (a hit -> loc_166b sets carry) / clear=all
// 23 zero (the trailing ana a). Read by reverseFleetAtEdge via rnc; no RAM write. HL/B/A exit modified but DEAD (no
// caller reads them). The idiomatic form inlines the 0x166b set-carry, returns the found boolean, and omits
// the ROM ret (seam completes it). Run: node --test games/invaders/idiomatic/test/equivalence-15c5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_15c5 as oracleBody } from "../../translated/loc_15c5.js";
import { fleetReachedEdge } from "../fleetReachedEdge.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { seamPlaceable } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x15c5;
const PTR = 0x2524; // a real fleet-edge scan region reverseFleetAtEdge hands to this scan

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x15c5 dispatches -- fleetReachedEdge == oracle in RAM (-stack) and carry", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); fleetReachedEdge(c); // ptr defaults to the captured HL (the real scan pointer)
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.fC, o.regs.fC, "carry live-out (found) matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: first-nonzero sets carry / all-zero clears it, across positions", () => {
  const scenarios = [
    { desc: "hit at offset 0", fill: (m) => m.mem.write8(PTR, 0x01), found: true },
    { desc: "hit at offset 22 (last byte)", fill: (m) => m.mem.write8(PTR + 0x16, 0x80), found: true },
    { desc: "all 23 zero", fill: () => {}, found: false },
    { desc: "nonzero at offset 23 is past the window", fill: (m) => m.mem.write8(PTR + 0x17, 0xff), found: false },
  ];
  for (const s of scenarios) {
    const seed = (m) => {
      m.regs.sp = 0x2400; m.regs.hl = PTR; m.io.setInte(false);
      for (let i = 0; i < 0x18; i++) m.mem.write8(PTR + i, 0);
      s.fill(m);
    };
    const o = new Machine(ROM); seed(o);
    const c = new Machine(ROM); seed(c);
    oracle(o); const ret = fleetReachedEdge(c);
    assert.equal(ramDiff(o, c), null, s.desc);
    assert.equal(c.regs.fC, s.found, `carry: ${s.desc}`);
    assert.equal(ret, s.found, `boolean return: ${s.desc}`);
    assert.equal(c.regs.fC, o.regs.fC, `carry matches oracle: ${s.desc}`);
  }
});

test("TEETH: a twin scanning only 0x16 bytes misses a hit at offset 22", () => {
  const o = new Machine(ROM);
  o.regs.sp = 0x2400; o.regs.hl = PTR; o.io.setInte(false);
  for (let i = 0; i < 0x18; i++) o.mem.write8(PTR + i, 0);
  o.mem.write8(PTR + 0x16, 0x80);
  oracle(o);
  let brokenFound = false; // BUG: scans 0x16 not 0x17 -> misses the offset-22 hit
  for (let i = 0; i < 0x16; i++) if (o.mem.read8(PTR + i) !== 0) { brokenFound = true; break; }
  assert.notEqual(brokenFound, o.regs.fC, "the carry live-out check FAILED to catch the short scan");
});

test("SP-TOOTH: leaf placeable on both not-found and found entries", () => {
  for (const [desc, hit] of [["not-found", false], ["found", true]]) {
    const m = new Machine(ROM);
    m.regs.sp = 0x2400; m.regs.hl = PTR; m.io.setInte(false);
    for (let i = 0; i < 0x17; i++) m.mem.write8(PTR + i, 0);
    if (hit) m.mem.write8(PTR, 0x01);
    m.mem.write16(0x2400, 0x15be); // a real caller-return word for the seam
    const r = seamPlaceable(withOmittedRet, fleetReachedEdge, TARGET, m);
    assert.equal(r.placeable, true, `fleetReachedEdge must be seam-placeable (${desc}); got: ${r.error}`);
  }
});
