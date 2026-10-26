// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for copyZpStateToSnapshot (ROM 0x26a0) -- mark loc_c1/loc_c2 = 0xff, copy the two
// nine-byte zero-page blocks loc_02..loc_0a and loc_1a..loc_22 up into the page-1 snapshot buffer
// (HIGH_SCORE_TABLE..loc_0180 and loc_0181..loc_0189), then TAIL-JUMP to loc_3a08, which XOR-folds
// 0x0178..0x01b4 into the HIGH_SCORE_CHECKSUM checksum. Live-out is RAM only, so each side runs on a clone and the
// contract is RAM (dumpState, minus stack scratch below the entry SP). The tail transfer is preserved as m.call(0x3a08), so
// loc_3a08 owns the RTS -- the seam observes the "+2, pc on the caller slot" translated-tail-transfer
// case, not the omitted-ret case.
//
// NOTE -- boot never dispatches 0x26a0 (it runs on a state-save path), so CAPTURE is empty; the CRAFTED,
// TEETH and SP-TOOTH arms carry the proof.
// Run: node --test games/centiped/idiomatic/test/equivalence-26a0.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_26a0 as oracleRom } from "../../translated/loc_26a0.js";
import { copyZpStateToSnapshot } from "../copyZpStateToSnapshot.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_c1, loc_c2, loc_02, loc_1a, HIGH_SCORE_TABLE, loc_0181, HIGH_SCORE_CHECKSUM } from "../names.js";
import { stampEntry, deadStackAtEntry, deadStackDeepAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x26a0;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x26a0 dispatches -- copyZpStateToSnapshot == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), deadStackDeepAtEntry(0x40, ma, mb));
    const o = cap.clone(), c = cap.clone();
    oracle(o); copyZpStateToSnapshot(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (boot does not dispatch 0x26a0)`);
});

// A pristine crafted machine: SP seated so loc_3a08's RTS pops a dead scratch word (or, with retSeat, a
// real caller-return word for the seam tooth). Seeds the two source blocks and the rest of the fold range
// so the copy and the HIGH_SCORE_CHECKSUM checksum are both observable.
function craft(retSeat) {
  const m = new Machine(ROM);
  if (retSeat) {
    m.regs.s = 0xf0;
    m.mem.write8(0x0100 | 0xf1, 0xcc);
    m.mem.write8(0x0100 | 0xf2, 0xab); // caller return = 0xabcd
  } else {
    m.regs.s = 0xfa;
    m.mem.write8(0x0100 | 0xfb, 0x00);
    m.mem.write8(0x0100 | 0xfc, 0x00);
  }
  for (let i = 0; i <= 8; i++) {
    m.mem.write8((loc_02 + i) & 0xff, 0x50 + i);
    m.mem.write8((loc_1a + i) & 0xff, 0xa0 + i);
  }
  for (let a = 0x018a; a <= 0x01b4; a++) m.mem.write8(a, (a * 7) & 0xff); // seed the rest of the fold range
  return m;
}

test("CRAFTED: both zp blocks copied + loc_c1/loc_c2 marked + loc_3a08 checksum folded (RAM -stack)", () => {
  const o = craft(false), c = craft(false);
  oracle(o); copyZpStateToSnapshot(c);
  assert.equal(ramDiff(o, c), null, "snapshot copy + fold RAM (-stack) mismatch");
  assert.equal(c.mem.read8(loc_c1), 0xff, "loc_c1");
  assert.equal(c.mem.read8(loc_c2), 0xff, "loc_c2");
  for (let i = 0; i <= 8; i++) {
    assert.equal(c.mem.read8((HIGH_SCORE_TABLE + i) & 0xffff), 0x50 + i, `HIGH_SCORE_TABLE+${i}`);
    assert.equal(c.mem.read8((loc_0181 + i) & 0xffff), 0xa0 + i, `loc_0181+${i}`);
  }
  assert.notEqual(c.mem.read8(HIGH_SCORE_CHECKSUM), 0x00, "loc_3a08 must have folded a checksum into HIGH_SCORE_CHECKSUM");
});

test("TEETH: a twin that skips the loc_c1 mark diverges in RAM", () => {
  const droppedC1 = (m) => {
    // m.mem8[loc_c1] = 0xff;  BUG dropped
    m.mem8[loc_c2] = 0xff;
    for (let x = 8; x >= 0; x--) {
      m.mem8[(HIGH_SCORE_TABLE + x) & 0xffff] = m.mem8[(loc_02 + x) & 0xff];
      m.mem8[(loc_0181 + x) & 0xffff] = m.mem8[(loc_1a + x) & 0xff];
    }
    return m.call(0x3a08);
  };
  const o = craft(false), c = craft(false);
  oracle(o); droppedC1(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM-diff check FAILED to catch the dropped loc_c1 mark");
  assert.equal(d.addr, loc_c1 & 0xffff);
});

test("SP-TOOTH: the loc_3a08 tail-transfer (+2, pc on caller slot) is seam-placeable", () => {
  const r = seamPlaceable(withOmittedRet, copyZpStateToSnapshot, TARGET, craft(true));
  assert.equal(r.placeable, true, `copyZpStateToSnapshot must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: loc_3a08 tail-transfer (+2) placeable");
});
