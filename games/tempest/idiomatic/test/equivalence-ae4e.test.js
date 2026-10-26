// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawHighlightedGlyphRowList (ROM 0xae4e) -- runs a descending do-while (0x37: 0x15 step -3) that emits
// a run of slot records, seeding each pass's glyph triple ($56-$58) from the $0706 table. Dissolves m.calls
// to ab14/b0dd/ab0d/df75/b0d1/dfb1/b56a/aef8 into direct idiomatic calls. All output is RAM, so each arm
// compares RAM (dumpState minus stack scratch below the entry SP). A is a live-in via the register bridge. The one ab14 call's
// copy loop is bounded by a bit7-set terminator planted in the seeded pointer chain; ($74) -> vector RAM.
// Run: node --test games/tempest/idiomatic/test/equivalence-ae4e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ae4e } from "../../translated/loc_ae4e.js";
import { drawHighlightedGlyphRowList } from "../drawHighlightedGlyphRowList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SLOT_LOOP_INDEX, PROJ_X_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (n) => new Uint8Array(readFileSync(new URL(n, ROM_DIR)));
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? rd("maincpu.bin") : null;
const opt = (n) => (existsSync(new URL(n, ROM_DIR)) ? rd(n) : undefined);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xae4e;
const oracle = atEntry(loc_ae4e);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

// ab14 is called once with X=0x10 -> $35=0x10; its ($ac),$35 lookup at $3b -> 0x0260, whose byte at 0x0261
// has bit7 set so the copy loop exits after one pass. ($74) -> vector RAM 0x2000 (diffed, ample for the run).
function seat(m, a = 0x11) {
  m.regs.a = a;
  m.mem.write8(0x00ac, 0x00); m.mem.write8(0x00ad, 0x02);  // ($ac) -> 0x0200
  m.mem.write8(0x0210, 0x60); m.mem.write8(0x0211, 0x02);  // ($ac),0x10 -> 0x0260
  m.mem.write8(0x0261, 0x80);                               // copy-loop terminator (bit7 set)
  m.mem.write8(0x0074, 0x00); m.mem.write8(0x0075, 0x20);  // ($74) -> 0x2000 (vector RAM)
}

test("CAPTURE: real 0xae4e dispatches -- drawHighlightedGlyphRowList == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawHighlightedGlyphRowList(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: run the descending emit loop -- drawHighlightedGlyphRowList == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  oracle(o); drawHighlightedGlyphRowList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the full run");
  assert.equal(c.mem.read8(SLOT_LOOP_INDEX), 0xfd, "$37 stepped past zero (0x00 - 3)");
  assert.equal(c.mem.read8(PROJ_X_LO), 0x11, "$63 = A live-in");
});

test("TEETH: a twin that corrupts a seeded glyph cell diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seat(o); oracle(o);
  const c = new Machine(ROM, OPTS); seat(c); drawHighlightedGlyphRowList(c);
  c.mem.write8(0x0058, (c.mem.read8(0x0058) ^ 0xff) & 0xff); // BUG: wrong $58 glyph byte
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a corrupted glyph cell");
});

test("TEETH (marshalling): a twin that skips the whole emit run diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seat(o); oracle(o);
  const c = new Machine(ROM, OPTS); seat(c);
  const broken = (m, a = m.regs.a) => { m.mem8[PROJ_X_LO] = a; }; // BUG: seats $63 but never emits anything
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped emit run");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seat(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawHighlightedGlyphRowList, TARGET, m);
  assert.equal(r.placeable, true, `drawHighlightedGlyphRowList must be seam-placeable; got: ${r.error}`);
});
