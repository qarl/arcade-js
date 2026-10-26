// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearEightByteTableAndFlag (ROM 0x929f-0x92ac) -- blanks the 8-byte table $030a..$0311 (X = 7..0)
// then clears the $0116 flag. Live-out is memory only (A/X at RTS are incidental), so each side runs on a
// clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). A leaf: the module omits the ROM ret and
// the seam completes it, so the arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-929f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_929f } from "../../translated/loc_929f.js";
import { clearEightByteTableAndFlag } from "../clearEightByteTableAndFlag.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SHAPE_ACTIVE, TIMED_OBJECT_COUNT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x929f;
const oracle = atEntry(loc_929f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x929f dispatches -- clearEightByteTableAndFlag == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); clearEightByteTableAndFlag(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: table $030a..$0311 and flag $0116 all clear to 0x00", () => {
  const seed = (m) => {
    for (let i = 0; i < 8; i++) m.mem.write8((SHAPE_ACTIVE + i) & 0xffff, 0xa0 + i); // dirty sentinels
    m.mem.write8(TIMED_OBJECT_COUNT, 0x5c);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); clearEightByteTableAndFlag(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after clear");
  for (let i = 0; i < 8; i++) assert.equal(c.mem.read8((SHAPE_ACTIVE + i) & 0xffff), 0x00, `entry ${i} cleared`);
  assert.equal(c.mem.read8(TIMED_OBJECT_COUNT), 0x00, "$0116 cleared");
});

test("TEETH: a twin that leaves $0116 (or the last entry) untouched diverges from the oracle", () => {
  const seed = (m) => {
    for (let i = 0; i < 8; i++) m.mem.write8((SHAPE_ACTIVE + i) & 0xffff, 0xa0 + i);
    m.mem.write8(TIMED_OBJECT_COUNT, 0x5c);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken929f = (m) => {
    const mem = m.mem8;
    for (let x = 7; x >= 1; x--) mem[(SHAPE_ACTIVE + x) & 0xffff] = 0x00; // BUG: never clears entry 0 or $0116
  };
  broken929f(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the skipped stores");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, clearEightByteTableAndFlag, TARGET, m);
  assert.equal(r.placeable, true, `clearEightByteTableAndFlag must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
