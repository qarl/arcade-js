// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for storeHeadVelocity (0x2e8c) -- commits the head velocity to $60/$8b then
// dispatches by the incoming zero flag (nonzero -> advance orientation, zero -> reseed the wave). A
// dispatching leaf: it omits the ROM ret and the seam completes it. The reseed path runs seedWaveState,
// which reads the POKEY RANDOM register, so both sides pin the poly counter to origin (t[0]) -- the one
// engine-level clock variable the clock-free layer cannot reproduce.
// Run: node --test games/centiped/idiomatic/test/equivalence-2e8c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2e8c as oracleRom } from "../../translated/loc_2e8c.js";
import { storeHeadVelocity } from "../storeHeadVelocity.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_00, loc_40, loc_60, loc_70, loc_88, loc_8b, loc_ab, loc_ef,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2e8c;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Hold the poly counter at origin so a RANDOM read is the constant t[0] on both sides.
const pinRng = (m) => { m.io.pokeyC0 = null; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any gap */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Seat a fresh entry with the incoming A + zero flag and the cells the two continuations read.
function seed({ a = 0, zero = a === 0, ef = 0, p88 = 0, ab = 0, c00 = 0, c40 = 0, c70 = 0 } = {}) {
  const m = new Machine(ROM);
  pinRng(m);
  m.regs.s = 0xfd;
  m.mem.write8(0x0100 | ((0xfd + 1) & 0xff), 0x34); // caller-return (ret-1) lo
  m.mem.write8(0x0100 | ((0xfd + 2) & 0xff), 0x12); // caller-return (ret-1) hi
  m.regs.a = a;
  m.regs.fZ = zero;
  m.mem.write8(loc_ef, ef);
  m.mem.write8(loc_88, p88);
  m.mem.write8((loc_ab + p88) & 0xff, ab);
  m.mem.write8(loc_00, c00);
  m.mem.write8(loc_40, c40);
  m.mem.write8(loc_70, c70);
  return m;
}

test("CAPTURE: real 0x2e8c dispatches -- storeHeadVelocity == oracle in RAM (-stack, RNG pinned)", () => {
  for (const cap of CAPS) {
    const o = pinRng(cap.clone());
    const c = pinRng(cap.clone());
    oracle(o);
    storeHeadVelocity(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (RNG pinned to t[0])`);
});

test("CRAFTED: both dispatch branches (nonzero -> advance, zero -> reseed) == oracle", () => {
  const cases = [
    { tag: "zero -> reseed wave", a: 0x00, zero: true, ef: 0x00, p88: 0x00, ab: 0x00 },
    { tag: "zero -> reseed wave (ef set, wide slot)", a: 0x00, zero: true, ef: 0x55, p88: 0x01, ab: 0x08 },
    { tag: "nonzero -> advance orientation (tick phase)", a: 0x03, zero: false, c00: 0x00, c40: 0x31, c70: 0x40, ef: 0x00 },
    { tag: "nonzero -> advance orientation (off phase)", a: 0xfe, zero: false, c00: 0x01, c40: 0x22, c70: 0x10, ef: 0x00 },
  ];
  for (const s of cases) {
    const base = seed(s);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    storeHeadVelocity(c);
    assert.equal(ramDiff(o, c), null, s.tag);
    // Positive control: the velocity landed in $8b regardless of branch.
    assert.equal(o.mem.read8(loc_8b), s.a, `$8b written (${s.tag})`);
  }
  console.log("  CRAFTED: storeHeadVelocity == oracle on both dispatch branches");
});

test("TEETH: a skipped $8b store is caught by the RAM diff", () => {
  const base = seed({ a: 0x2a, zero: false, c00: 0x01, c40: 0x22 });
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  // Broken twin: runs the real routine but drops the $8b store, so $8b keeps its pre-value.
  // (A crude twin that also skipped the nonzero branch would diff first at a lower advance cell,
  // not at $8b -- this isolates the missing store so the tooth bites exactly the velocity cell.)
  const pre8b = base.mem8[loc_8b];
  oracle(c);
  c.mem8[loc_8b] = pre8b;
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a skipped $8b store");
  assert.equal(d.addr, loc_8b, "diff should be at the $8b velocity cell");
  console.log("  TEETH: dropped-$8b twin caught at the $8b cell");
});

test("SP-TOOTH: the dispatching rewrite is seam-placeable, and a leaked push is refused", () => {
  const m = seed({ a: 0x00, zero: true }); // reseed path -> dissolved leaf, SP unmoved
  const r = seamPlaceable(withOmittedRet, storeHeadVelocity, TARGET, m);
  assert.equal(r.placeable, true, `storeHeadVelocity must be seam-placeable; got: ${r.error}`);
  // Null-mutant: a body that leaks a push16 leaves SP adrift and the seam must refuse it.
  const leaky = (mm) => { mm.push16(0x1234); };
  const bad = seamPlaceable(withOmittedRet, leaky, TARGET, seed({ a: 0x00, zero: true }));
  assert.equal(bad.placeable, false, "the SP tooth FAILED to refuse a leaked push16");
  console.log("  SP-TOOTH: dispatching leaf placeable; leaked push refused");
});
