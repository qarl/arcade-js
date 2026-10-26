// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedSegmentSpawnState (ROM 0x21c7) -- derive the OBJECT_Y_STEER selector (2, dropped to
// 1 when the loc_ab entry is 0 and the CONFIG_DIP_BYTE threshold clears the loc_a9 gate), mirror it into loc_51
// (two's-complemented -- the dissolved loc_382d negate -- when POKEY RANDOM $100A bit2 is set), then seed
// the constant spawn cells loc_71/loc_61/loc_41/loc_a1/SFX_TIMER_CH4. Live-out is RAM only, so each side runs on
// a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). $100A is read exactly ONCE, so its
// value depends only on the pokey state captured at entry -- clock-free reads it byte-identically.
// Run: node --test games/centiped/idiomatic/test/equivalence-21c7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_21c7 as oracleRom } from "../../translated/loc_21c7.js";
import { seedSegmentSpawnState } from "../seedSegmentSpawnState.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_88, loc_ab, CONFIG_DIP_BYTE, loc_a9, OBJECT_Y_STEER, loc_51, loc_f0,
  loc_71, loc_61, loc_41, loc_a1, SFX_TIMER_CH4,
} from "../names.js";
import { stampEntry, deadStackAtEntry, deadStackDeepAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x21c7;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x21c7 dispatches -- seedSegmentSpawnState == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch 0x21c7 at least once");
  for (const cap of CAPS) {
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), deadStackDeepAtEntry(0x40, ma, mb));
    const o = cap.clone(), c = cap.clone();
    oracle(o); seedSegmentSpawnState(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A pristine crafted machine with SP seated on a real caller-return word (so the oracle's balanced
// nested push/pop lands in the excluded scratch) and the poly counter idle (pokeyC0 null -> $100A is a
// constant, so the mirror branch is taken identically on both sides). `seed` places the selector inputs.
function craft(slot, ab, fd, a9, f0) {
  const m = new Machine(ROM);
  m.regs.s = 0xfa;
  m.mem.write8(0x0100 | 0xfb, 0xcc);
  m.mem.write8(0x0100 | 0xfc, 0xab); // caller return = 0xabcd
  m.mem.write8(loc_88, slot);
  m.mem.write8((loc_ab + slot) & 0xff, ab);
  m.mem.write8(CONFIG_DIP_BYTE, fd);
  m.mem.write8((loc_a9 + slot) & 0xff, a9);
  m.mem.write8(loc_f0, f0);
  return m;
}

test("CRAFTED: selector branches + constant spawn cells match the oracle in RAM (-stack)", () => {
  const cases = [
    { slot: 0, ab: 0x05, fd: 0x00, a9: 0x00, f0: 0x33, sel: 0x02 }, // loc_ab != 0 -> selector stays 2
    { slot: 0, ab: 0x00, fd: 0x40, a9: 0x10, f0: 0x00, sel: 0x01 }, // threshold 0x50 >= 0x10 -> selector 1
    { slot: 0, ab: 0x00, fd: 0x40, a9: 0x60, f0: 0xff, sel: 0x02 }, // threshold 0x50 < 0x60 -> selector 2
    { slot: 3, ab: 0x00, fd: 0x00, a9: 0x11, f0: 0x5a, sel: 0x02 }, // threshold 0x10 < 0x11 -> selector 2
  ];
  for (const { slot, ab, fd, a9, f0, sel } of cases) {
    const o = craft(slot, ab, fd, a9, f0), c = craft(slot, ab, fd, a9, f0);
    oracle(o); seedSegmentSpawnState(c);
    const label = `slot=${slot} ab=0x${ab.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.mem.read8(OBJECT_Y_STEER), sel, `OBJECT_Y_STEER selector ${label}`);
    assert.equal(c.mem.read8(loc_71), (0x60 ^ f0) & 0xff, `loc_71 ${label}`);
    assert.equal(c.mem.read8(loc_61), 0xff, `loc_61 ${label}`);
    assert.equal(c.mem.read8(loc_41), 0xf8, `loc_41 ${label}`);
    assert.equal(c.mem.read8(loc_a1), 0x60, `loc_a1 ${label}`);
    assert.equal(c.mem.read8(SFX_TIMER_CH4), 0x00, `SFX_TIMER_CH4 ${label}`);
  }
});

test("TEETH: a twin that never drops the selector to 1 diverges in RAM", () => {
  // Broken twin: the real logic MINUS the loc_a9 gate, so the selector is always 2.
  const broken = (m) => {
    const x = m.mem8[loc_88];
    let sel = 0x02; // BUG: never drops to 1
    m.mem8[OBJECT_Y_STEER] = sel;
    if (m.mem8[0x100a] & 0x04) sel = (0x100 - sel) & 0xff;
    m.mem8[loc_51] = sel;
    m.mem8[loc_71] = 0x60 ^ m.mem8[loc_f0];
    m.mem8[loc_61] = 0xff; m.mem8[loc_41] = 0xf8; m.mem8[loc_a1] = 0x60; m.mem8[SFX_TIMER_CH4] = 0x00;
    void x;
  };
  const o = craft(0, 0x00, 0x40, 0x10, 0x00), c = craft(0, 0x00, 0x40, 0x10, 0x00);
  oracle(o); broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM-diff check FAILED to catch the missing selector drop");
  // The selector feeds OBJECT_Y_STEER (raw) and loc_51 (mirrored); the first differing address is loc_51.
  assert.equal(d.addr, loc_51 & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, seedSegmentSpawnState, TARGET, craft(0, 0x00, 0x40, 0x10, 0x00));
  assert.equal(r.placeable, true, `seedSegmentSpawnState must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
