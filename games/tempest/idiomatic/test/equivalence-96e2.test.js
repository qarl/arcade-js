// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for sumCoordListEntryRun (ROM 0x96e2-0x96f3) -- calls computeCoordListBackDelta for a repeat count, loads the first
// (0x2c),y entry, then folds `count` more copies of the next entry into a one-byte running total. The
// idiomatic side dissolves the jsr $96f4 into a direct computeCoordListBackDelta(m, y) call and consumes its returned count.
// Live-out is the accumulator A (returned by the module), compared against the oracle's exit regs.a; RAM
// (dumpState minus stack scratch below the entry SP) also covers $29 written inside computeCoordListBackDelta.
// Run: node --test games/tempest/idiomatic/test/equivalence-96e2.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_96e2 } from "../../translated/loc_96e2.js";
import { sumCoordListEntryRun } from "../sumCoordListEntryRun.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { loc_2b, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x96e2;
const oracle = atEntry(loc_96e2);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Point (0x2c) at diffed vector RAM, seed a count basis at $2b plus table entries, and preset Y.
function seed(m, y) {
  m.mem.write8(COORD_LIST_PTR_LO, 0x00); m.mem.write8(COORD_LIST_PTR_HI, 0x20); // (0x2c) -> $2000
  m.mem.write8(loc_2b, 0x05);                             // count basis
  m.mem.write8(u16(0x2000 + (y - 2)), 0x02);             // (0x2c),y-2  -> count = 0x05 - 0x02 = 3
  m.mem.write8(u16(0x2000 + y), 0x10);                    // first entry
  m.mem.write8(u16(0x2000 + y + 1), 0x02);               // folded entry
  m.regs.y = y;
}

test("CAPTURE: real 0x96e2 dispatches -- sumCoordListEntryRun == oracle in RAM (-stack) and live-out A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const rv = sumCoordListEntryRun(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(rv & 0xff, o.regs.a, "returned total must equal oracle exit A");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: count=3 fold -- RAM equal and returned total equals oracle exit A", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x04);
  const c = new Machine(ROM, OPTS); seed(c, 0x04);
  oracle(o); const rv = sumCoordListEntryRun(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after fold");
  assert.equal(rv & 0xff, o.regs.a, "returned total equals oracle exit A");
  assert.equal(rv & 0xff, 0x16, "0x10 + 3*0x02 = 0x16");
});

test("TEETH: a twin returning only the first entry (no fold) diverges from oracle exit A", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x04); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c, 0x04);
  const brokenE2 = (m, y = m.regs.y) => {
    const { mem8, mem16 } = m;
    const ptr = mem16[COORD_LIST_PTR_LO];
    return mem8[u16(ptr + y)]; // BUG: never folds the count copies
  };
  assert.notEqual(brokenE2(c) & 0xff, o.regs.a, "the live-out check FAILED to catch the missing fold");
});

test("SP-TOOTH: the omitted-ret routine (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, sumCoordListEntryRun, TARGET, m);
  assert.equal(r.placeable, true, `sumCoordListEntryRun must be seam-placeable; got: ${r.error}`);
});
