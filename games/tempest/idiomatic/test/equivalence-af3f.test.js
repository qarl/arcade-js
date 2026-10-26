// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawCounterSlot (ROM 0xaf3f) -- draws one slot: when $0600,x is zero it returns at once,
// else it emits the slot's capped count at a per-slot screen position, dissolving m.calls to b0d1/ab0d/df75/
// af71/b56a/ab98/aa9e into direct idiomatic calls. All output is RAM, so each arm compares RAM (dumpState
// minus stack scratch below the entry SP). X is a live-in via the register bridge. The deep path runs ab98->ab3b, whose copy
// loop is bounded by a bit7-set terminator planted in the seeded pointer chain; ($74) points into vector RAM.
// Run: node --test games/tempest/idiomatic/test/equivalence-af3f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_af3f } from "../../translated/loc_af3f.js";
import { drawCounterSlot } from "../drawCounterSlot.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SLOT_METRIC, loc_2e } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (n) => new Uint8Array(readFileSync(new URL(n, ROM_DIR)));
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? rd("maincpu.bin") : null;
const opt = (n) => (existsSync(new URL(n, ROM_DIR)) ? rd(n) : undefined);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaf3f;
const oracle = atEntry(loc_af3f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

// X=0 selects slot 0. The deep path runs ab98(X=4) -> ab3b, whose ($ac),$35=4 lookup at $3b -> 0x0260; the
// byte at 0x0261 has bit7 set so the copy loop exits after one pass. ($74) -> vector RAM 0x2000 (diffed).
function seatDeep(m) {
  m.regs.x = 0x00;
  m.mem.write8(SLOT_METRIC, 0x05);                              // slot 0 count non-zero
  m.mem.write8(0x00ac, 0x00); m.mem.write8(0x00ad, 0x02);  // ($ac) -> 0x0200
  m.mem.write8(0x0204, 0x60); m.mem.write8(0x0205, 0x02);  // ($ac),4 -> 0x0260
  m.mem.write8(0x0261, 0x80);                               // copy-loop terminator (bit7 set)
  m.mem.write8(0x0074, 0x00); m.mem.write8(0x0075, 0x20);  // ($74) -> 0x2000 (vector RAM)
}
function seatEmpty(m) {
  m.regs.x = 0x00;
  m.mem.write8(SLOT_METRIC, 0x00); // slot 0 count zero -> immediate return
}

test("CAPTURE: real 0xaf3f dispatches -- drawCounterSlot == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawCounterSlot(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED (empty slot): $0600,x == 0 -> immediate return, no writes (== oracle)", () => {
  const o = new Machine(ROM, OPTS); seatEmpty(o);
  const c = new Machine(ROM, OPTS); seatEmpty(c);
  oracle(o); drawCounterSlot(c);
  assert.equal(ramDiff(o, c), null, "RAM equal (both early-returned)");
  assert.equal(c.mem.read8(loc_2e), 0x00, "$2e untouched on the empty-slot path");
});

test("CRAFTED (deep): non-empty slot draws the count -- drawCounterSlot == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seatDeep(o);
  const c = new Machine(ROM, OPTS); seatDeep(c);
  oracle(o); drawCounterSlot(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the full draw");
  assert.equal(c.mem.read8(loc_2e), 0x00, "$2e = slot index");
});

test("TEETH: a twin that draws even for an empty slot diverges from the oracle", () => {
  // Use slot 1 (X=1, $0601 defaults to 0 -> empty) so the routine's first draw store ($2e = x)
  // writes a NON-zero value; on slot 0 that store is invisibly 0 and the tooth couldn't bite.
  const o = new Machine(ROM, OPTS); seatEmpty(o); o.regs.x = 0x01; oracle(o);
  const c = new Machine(ROM, OPTS); seatEmpty(c); c.regs.x = 0x01;
  const broken = (m) => { m.mem8[loc_2e] = m.regs.x; }; // BUG: performs the draw path's first store ($2e=x), ignoring the $0600,x==0 early return
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a drawn empty slot");
});

test("TEETH (deep): a twin that corrupts one emitted vector byte diverges", () => {
  const o = new Machine(ROM, OPTS); seatDeep(o); oracle(o);
  const c = new Machine(ROM, OPTS); seatDeep(c); drawCounterSlot(c);
  c.mem.write8(0x2000, (c.mem.read8(0x2000) ^ 0xff) & 0xff); // BUG: wrong byte in the vector buffer
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a corrupted emit");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seatEmpty(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawCounterSlot, TARGET, m);
  assert.equal(r.placeable, true, `drawCounterSlot must be seam-placeable; got: ${r.error}`);
});
