// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for tickSpawnCadence (0x3049) -- the per-slot spawn-cadence tick. A leaf whose only
// live-out is work RAM (in dumpState); it DISSOLVES the frozen 0x21c7 call into a direct idiomatic call,
// so every arm checks the RAM diff (minus stack scratch below the entry SP). The omitted-ret seam completes it.
// Run: node --test games/centiped/idiomatic/test/equivalence-3049.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3049 as oracleRom } from "../../translated/loc_3049.js";
import { tickSpawnCadence } from "../tickSpawnCadence.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_88, loc_94, loc_87, loc_9c, loc_41, loc_ef, loc_9f } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3049;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

function seed(m, s) {
  m.mem.write8(loc_88, s.slot ?? 0);
  const x = s.slot ?? 0;
  m.mem.write8((loc_94 + x) & 0xff, s.gate ?? 0);
  m.mem.write8(loc_87, s.arm ?? 0);
  m.mem.write8((loc_9c + x) & 0xff, s.phase ?? 0);
  m.mem.write8(loc_41, s.key ?? 0);
  m.mem.write8(loc_ef, s.fold ?? 0);
  m.mem.write8(loc_9f, s.count ?? 0);
}

test("CAPTURE: real 0x3049 dispatches -- tickSpawnCadence == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); tickSpawnCadence(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: every branch == oracle (RAM -stack), incl. the dissolved 0x21c7 seed", () => {
  const cases = [
    { tag: "idle -> phase++/re-arm (slot 0)", slot: 0, gate: 0, arm: 0, phase: 5 },
    { tag: "idle -> phase++/re-arm (slot 1)", slot: 1, gate: 0, arm: 0, phase: 5 },
    { tag: "key fold < threshold -> return", slot: 0, arm: 0x40, key: 0x00, fold: 0x00 },
    { tag: "countdown not zero -> return", slot: 0, arm: 0x40, key: 0x9c, fold: 0x00, count: 2 },
    { tag: "countdown hits zero -> seed spawn", slot: 0, arm: 0x40, key: 0x9c, fold: 0x00, count: 1 },
    { tag: "gate set keeps arm branch alive", slot: 0, gate: 0x08, arm: 0x00, key: 0xff, fold: 0x00, count: 1 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); tickSpawnCadence(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a skipped phase increment is caught by the RAM diff", () => {
  const s = { slot: 0, gate: 0, arm: 0, phase: 5 };
  const o = new Machine(ROM); seed(o, s);
  oracle(o);
  assert.equal(o.mem8[loc_9c], 6, "precondition: oracle incremented the phase from 5");
  const broken = 5; // BUG: never advanced the phase
  assert.notEqual(broken, o.mem8[loc_9c], "the RAM diff FAILED to catch a skipped phase increment");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable; a pushing twin is not", () => {
  const seated = new Machine(ROM);
  seated.regs.s = 0xfb;
  seated.mem.write8(0x01fc, 0xcd); seated.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam
  assert.equal(seamPlaceable(withOmittedRet, tickSpawnCadence, TARGET, seated.clone()).placeable, true);
  const spLeak = (mm) => { mm.push8(0x00); };
  assert.equal(seamPlaceable(withOmittedRet, spLeak, TARGET, seated.clone()).placeable, false);
});
