// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for computeDisplayListChecksum (ROM 0xaeca) -- when $0156 is non-zero it seats it in $58, builds a record
// via ab14 (X=0x34) and dfb1, and zeros $56/$57; then always folds 17 ROM bytes ($d575,y for y=0x10..0) plus
// 0x85 (carry-chained) into $b5. Dissolves the m.calls to ab14/dfb1. Output is RAM ($b5 + record) plus the
// checksum left in A (a register live-out), so arms compare RAM (dumpState minus stack scratch below the entry SP) and the
// returned checksum vs the oracle's A. The flag-branch ab14 copy loop is bounded by a seeded terminator.
// Run: node --test games/tempest/idiomatic/test/equivalence-aeca.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aeca } from "../../translated/loc_aeca.js";
import { computeDisplayListChecksum } from "../computeDisplayListChecksum.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { BONUS_LIFE_INTERVAL, PROJ_PT_X } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (n) => new Uint8Array(readFileSync(new URL(n, ROM_DIR)));
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? rd("maincpu.bin") : null;
const opt = (n) => (existsSync(new URL(n, ROM_DIR)) ? rd(n) : undefined);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaeca;
const B5 = 0x00b5;
const oracle = atEntry(loc_aeca);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

// Flag path (X=0x34 inside ab14 -> $35=0x34): the ($ac),$35 lookup at $3b -> 0x0260, whose byte at 0x0261 has
// bit7 set so the copy loop exits after one pass. ($74) -> vector RAM 0x2000 (diffed).
function seatFlag(m) {
  m.mem.write8(BONUS_LIFE_INTERVAL, 0x55);                              // flag non-zero -> take the ab14/dfb1 branch
  m.mem.write8(0x00ac, 0x00); m.mem.write8(0x00ad, 0x02);  // ($ac) -> 0x0200
  m.mem.write8(0x0234, 0x60); m.mem.write8(0x0235, 0x02);  // ($ac),0x34 -> 0x0260
  m.mem.write8(0x0261, 0x80);                               // copy-loop terminator (bit7 set)
  m.mem.write8(0x0074, 0x00); m.mem.write8(0x0075, 0x20);  // ($74) -> 0x2000 (vector RAM)
}

test("CAPTURE: real 0xaeca dispatches -- computeDisplayListChecksum == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); computeDisplayListChecksum(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED (flag clear): $0156 == 0 -> checksum only -- computeDisplayListChecksum == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); o.mem.write8(BONUS_LIFE_INTERVAL, 0x00);
  const c = new Machine(ROM, OPTS); c.mem.write8(BONUS_LIFE_INTERVAL, 0x00);
  oracle(o); const rv = computeDisplayListChecksum(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after checksum");
  assert.equal(c.mem.read8(B5), o.mem.read8(B5), "$b5 checksum matches the oracle");
  assert.equal(rv, o.regs.a, "returned checksum matches the oracle's A live-out");
});

test("CRAFTED (flag set): $0156 != 0 -> ab14/dfb1 record + checksum -- computeDisplayListChecksum == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seatFlag(o);
  const c = new Machine(ROM, OPTS); seatFlag(c);
  oracle(o); const rv = computeDisplayListChecksum(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after record + checksum");
  assert.equal(c.mem.read8(PROJ_PT_X), 0x55, "$58 seated from the flag byte");
  assert.equal(rv, o.regs.a, "returned checksum matches the oracle's A live-out");
});

test("TEETH: a twin that seeds the checksum with the wrong constant diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); o.mem.write8(BONUS_LIFE_INTERVAL, 0x00); oracle(o);
  const c = new Machine(ROM, OPTS); c.mem.write8(BONUS_LIFE_INTERVAL, 0x00);
  const broken = (m) => {
    const { mem8 } = m;
    let acc = 0x00; // BUG: should start at 0x85
    let carry = 0;
    for (let y = 0x10; y >= 0; y--) {
      const sum = acc + mem8[(0xd575 + y) & 0xffff] + carry;
      acc = sum & 0xff; carry = sum > 0xff ? 1 : 0;
    }
    mem8[B5] = acc;
    return acc;
  };
  const rv = broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong checksum seed");
  assert.notEqual(rv, o.regs.a, "the live-out check FAILED to catch the wrong checksum seed");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); m.mem.write8(BONUS_LIFE_INTERVAL, 0x00);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, computeDisplayListChecksum, TARGET, m);
  assert.equal(r.placeable, true, `computeDisplayListChecksum must be seam-placeable; got: ${r.error}`);
});
