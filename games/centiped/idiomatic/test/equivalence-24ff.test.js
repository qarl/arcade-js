// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for reseedSegmentSpawnState (0x24ff) -- reseed the segment spawn cells and wave-start
// state, then fall through into the sprite-table rebuild. A +2 dispatcher: two dissolved leaf callees then
// a tail-transfer into the still-translated rebuild spine, whose RTS returns to this routine's caller.
// The captured/seeded POKEY poly counter sits at origin, so the clock-free reseed reads the same RNG byte.
// Run: node --test games/centiped/idiomatic/test/equivalence-24ff.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_24ff as oracleRom } from "../../translated/loc_24ff.js";
import { reseedSegmentSpawnState } from "../reseedSegmentSpawnState.js";
import { seedSegmentSpawnState } from "../seedSegmentSpawnState.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_88, loc_ab, loc_ef, loc_f0 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x24ff;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

// Hold the POKEY poly counter at origin so the wave-seed RANDOM read is the constant t[0] on BOTH sides.
// The oracle reads $100A through the seam (cycles charged) while the dissolved idiomatic reseed reads it
// clock-free, so a live poly diverges only $60 (masked RNG minus 4) -- exactly the engine variable the
// clock-free layer cannot reproduce, neutralized here as the header describes and as equivalence-28bf does.
const pinRng = (m) => { m.io.pokeyC0 = null; return m; };

test("CAPTURE: real 0x24ff dispatches -- reseedSegmentSpawnState == oracle in RAM (-stack, RNG pinned)", () => {
  for (const cap of CAPS) {
    const o = pinRng(cap.clone()), c = pinRng(cap.clone());
    oracle(o); reseedSegmentSpawnState(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Fresh Machine: default POKEY RNG (poly at origin) reads 0xff, so the wave-seed spin breaks on read 1 on
// both sides. Seed the difficulty params and the per-slot selector byte the spawn/wave seeders consume.
function seed(m, { x88, abVal, ef, f0 }) {
  m.mem.write8(loc_88, x88);
  m.mem.write8((loc_ab + x88) & 0xff, abVal);
  m.mem.write8(loc_ef, ef);
  m.mem.write8(loc_f0, f0);
}

test("CRAFTED: spawn+wave reseed then rebuild spine == oracle (RAM -stack)", () => {
  const cases = [
    { x88: 0x00, abVal: 0x06, ef: 0x11, f0: 0x22 },
    { x88: 0x01, abVal: 0x03, ef: 0xff, f0: 0x00 },
    { x88: 0x02, abVal: 0x00, ef: 0x00, f0: 0x5a },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seed(o, s);
    const c = new Machine(ROM); seed(c, s);
    oracle(o); reseedSegmentSpawnState(c);
    assert.equal(ramDiff(o, c), null, `RAM: x88=0x${s.x88.toString(16)} ab=0x${s.abVal.toString(16)}`);
  }
});

test("TEETH: a twin that skips the wave-seed reseed diverges from the oracle", () => {
  // Broken twin: reseeds the spawn state and rebuilds, but omits the wave-start seeder.
  function reseed_broken(m) {
    seedSegmentSpawnState(m);
    // BUG: dropped seedWaveState(m)
    m.step(0x2505, 3); return m.call(0x2505);
  }
  const s = { x88: 0x00, abVal: 0x06, ef: 0x11, f0: 0x22 };
  const o = new Machine(ROM); seed(o, s);
  const c = new Machine(ROM); seed(c, s);
  oracle(o); reseed_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped wave seeder");
});

test("SP-TOOTH: the +2 dispatcher is seam-placeable; an SP-adrift mutant is refused", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, reseedSegmentSpawnState, TARGET, m);
  assert.equal(r.placeable, true, `reseedSegmentSpawnState must be seam-placeable; got: ${r.error}`);

  // Null-mutant: leaves an unbalanced push (a missing/omitted dissolve) -> SP adrift -> refused.
  const m2 = new Machine(ROM);
  m2.regs.s = 0xfb;
  m2.mem.write8(0x01fc, 0xcd); m2.mem.write8(0x01fd, 0xab);
  const mutant = (mm) => { mm.push16(0x2505); }; // pushes, never dispatches/rets through it
  const rm = seamPlaceable(withOmittedRet, mutant, TARGET, m2);
  assert.equal(rm.placeable, false, "the SP-tooth FAILED to refuse an SP-adrift mutant");
  console.log("  SP-TOOTH: +2 dispatcher placeable, adrift mutant refused");
});
