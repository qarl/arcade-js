// SPDX-License-Identifier: GPL-3.0-only
// Memory equivalence for returnNoop (ROM 0x2ec5) -- a lone RTS, the shared no-op return landing. It has
// no live-out at all: the arms assert the RAM diff (-stack) is null against the oracle, the TEETH arm is
// a positive control (a twin that writes one byte MUST diverge), and the SP-tooth proves the empty body
// is seam-placeable (the withOmittedRet seam completes the omitted ret).
// Run: node --test games/centiped/idiomatic/test/equivalence-2ec5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ec5 as oracleRom } from "../../translated/loc_2ec5.js";
import { returnNoop } from "../returnNoop.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_87 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2ec5;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

function make(seed) {
  const m = new Machine(ROM);
  m.push16(0x1233); // a real caller-return word (the oracle's ret pops it; compared as the entry frame)
  seed(m);
  return m;
}

test("CAPTURE: real 0x2ec5 dispatches -- returnNoop == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); returnNoop(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: a seeded machine is left untouched by both oracle and returnNoop", () => {
  const seed = (m) => {
    // Sprinkle some non-zero RAM so a stray write would show up.
    for (let a = 0x30; a <= 0xbf; a++) m.mem.write8(a, (a * 7) & 0xff);
  };
  const o = make(seed); const c = make(seed);
  oracle(o); returnNoop(c);
  assert.equal(ramDiff(o, c), null, "a no-op must leave RAM exactly as seeded");
});

test("TEETH: a twin that writes one byte diverges in RAM (positive control)", () => {
  function returnNoop_writesByte(m) { m.mem8[loc_87] = 0x5a; } // BUG: a no-op must write nothing
  const seed = (m) => { m.mem.write8(loc_87, 0x00); };
  const o = make(seed); const c = make(seed);
  oracle(o); returnNoop_writesByte(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a stray write from a no-op twin");
  assert.equal(d.addr, loc_87 & 0xffff);
});

test("SP-TOOTH: the omitted-ret no-op (moved 0) is seam-placeable", () => {
  const m = make(() => {});
  const r = seamPlaceable(withOmittedRet, returnNoop, TARGET, m);
  assert.equal(r.placeable, true, `returnNoop must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret no-op (moved 0) placeable");
});
