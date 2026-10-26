// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for plotRecordFieldColumns (ROM 0x2d5c) -- draws a header row then, for each of a run
// of three-byte records ($0002/$0003/$0004,index), prints the three fields as digit pairs through the kept
// print sub (0x384f) and plots three glyph bytes, stepping a column cursor until the record index reaches
// 0x18. The dissolved subs (0x37d5/0x3836/0x3833) are called directly and are each memory-equivalent to
// their frozen form; the print sub stays a kept call. No branches on external input, so a small set of
// seeded record/mask states plus the real captures cover it. Draw output lands in video RAM (excluded from
// dumpState); the observable RAM is the zero-page draw state (dumpState, minus stack scratch below the entry SP).
// Run: node --test games/centiped/idiomatic/test/equivalence-2d5c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d5c as oracleRom } from "../../translated/loc_2d5c.js";
import { plotRecordFieldColumns } from "../plotRecordFieldColumns.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_8d, loc_ef, loc_f3, CONFIG_DIP_BYTE } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2d5c;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before a boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(8, 2500) : [];

// Seat the record bytes ($0002..) + glyph table ($001a..) + the mask/high-adjust/mode cells the draw reads.
function seed({ fill = 0, ef = 0x00, f3 = 0x00, fd = 0x00 } = {}) {
  const m = new Machine(ROM);
  for (let a = 0x0002; a <= 0x0040; a++) m.mem8[a] = (fill + a) & 0xff;
  m.mem8[loc_ef] = ef;
  m.mem8[loc_f3] = f3;
  m.mem8[CONFIG_DIP_BYTE] = fd;
  return m;
}

test("CAPTURE: real 0x2d5c dispatches -- plotRecordFieldColumns == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); plotRecordFieldColumns(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: header + record columns == oracle across record/mask seeds (RAM -stack)", () => {
  // The draw cursor resets to $05:col each of the eight records and steps by (0x20 ^ $ef) + carry with
  // $f3 folded into the high byte per store. A large mask (0x0f/0xff) or any nonzero $f3 walks the cursor
  // past OBJ RAM (0x07ff) into the decode hole -- the FROZEN ORACLE faults there too, so those are
  // unreachable states, not module bugs. A mask near 0x20 (small stride) keeps the cursor bounded while
  // still driving the nonzero-mask XOR arm of the store sub, so it is the reachable way to vary the mask.
  const cases = [
    { tag: "zero records, no mask", fill: 0, ef: 0x00, f3: 0x00, fd: 0x00 },
    { tag: "ascending records, mask XOR (bounded stride)", fill: 0x11, ef: 0x20, f3: 0x00, fd: 0x00 },
    { tag: "mode-byte variant", fill: 0x40, ef: 0x00, f3: 0x00, fd: 0x03 },
    { tag: "mask XOR + mode set", fill: 0x80, ef: 0x28, f3: 0x00, fd: 0x01 },
  ];
  for (const cs of cases) {
    const o = seed(cs), c = seed(cs);
    oracle(o); plotRecordFieldColumns(c);
    assert.equal(ramDiff(o, c), null, cs.tag);
  }
});

test("CRAFTED: the record index cell walks to the same terminal as the oracle", () => {
  const cs = { fill: 0x11, ef: 0x20 };
  const o = seed(cs), c = seed(cs);
  oracle(o); plotRecordFieldColumns(c);
  assert.equal(o.mem8[loc_8d], c.mem8[loc_8d], "final record-index cell matches oracle");
});

test("TEETH: a twin that leaves the index cell off by one is caught by the RAM diff", () => {
  const brokenIndex = (mm) => { plotRecordFieldColumns(mm); mm.mem8[loc_8d] = (mm.mem8[loc_8d] + 1) & 0xff; };
  const cs = { fill: 0x11, ef: 0x20 };
  const o = seed(cs), c = seed(cs);
  oracle(o); brokenIndex(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch an off-by-one index cell");
});

test("SP-TOOTH: the omitted-ret terminal (moved 0) places; a stray-push mutant is refused", () => {
  const mk = () => {
    const m = seed({});
    m.regs.s = 0xfb;
    m.mem.write16(0x0100 | ((m.regs.s + 1) & 0xff), 0xabcd); // a real caller-return word for the seam
    return m;
  };
  const r = seamPlaceable(withOmittedRet, plotRecordFieldColumns, TARGET, mk());
  assert.equal(r.placeable, true, `plotRecordFieldColumns must be seam-placeable; got: ${r.error}`);
  const strayMutant = (mm) => { const rr = plotRecordFieldColumns(mm); mm.push16(0x1234); return rr; };
  assert.equal(seamPlaceable(withOmittedRet, strayMutant, TARGET, mk()).placeable, false, "the seam must REFUSE a strayed SP");
  console.log("  SP-TOOTH: omitted-ret terminal placeable, stray-push refused");
});
