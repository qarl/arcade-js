// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitColorStatIfChanged (ROM 0xb0d1-0xb0dc) -- returns early when $9e already equals the
// input Y; otherwise latches Y into $9e and tail-emits a fixed-tag record via emitTaggedVectorWord. The idiomatic
// side dissolves the tail jsr $df4c into a direct emitTaggedVectorWord(m, 0x08, y) call. Live-out is memory only
// (tail-caller into the df-family emitter), so each arm compares RAM (dumpState minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-b0d1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b0d1 } from "../../translated/loc_b0d1.js";
import { emitColorStatIfChanged } from "../emitColorStatIfChanged.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_9e, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb0d1;
const oracle = atEntry(loc_b0d1);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb0d1 dispatches -- emitColorStatIfChanged == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitColorStatIfChanged(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Cursor into vector RAM so the tail emit lands in a diffed region.
function seedEmit(m, y, latched) {
  m.regs.y = y;
  m.mem.write8(loc_9e, latched);
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // ($74) -> 0x2000
}

test("CRAFTED: Y != $9e -- latches Y and emits; RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedEmit(o, 0x05, 0x11);
  const c = new Machine(ROM, OPTS); seedEmit(c, 0x05, 0x11);
  oracle(o); emitColorStatIfChanged(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after latch+emit");
  assert.equal(c.mem.read8(loc_9e), 0x05, "$9e latched to Y");
});

test("CRAFTED: Y == $9e -- early return, no change; RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedEmit(o, 0x22, 0x22);
  const c = new Machine(ROM, OPTS); seedEmit(c, 0x22, 0x22);
  oracle(o); emitColorStatIfChanged(c);
  assert.equal(ramDiff(o, c), null, "RAM equal (early return path)");
});

test("TEETH: a twin that skips the latch+emit diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedEmit(o, 0x05, 0x11); oracle(o);
  const c = new Machine(ROM, OPTS); seedEmit(c, 0x05, 0x11);
  const broken = (_m) => { /* BUG: never latches $9e, never emits */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped latch+emit");
});

test("SP-TOOTH: the omitted-ret tail-caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitColorStatIfChanged, TARGET, m);
  assert.equal(r.placeable, true, `emitColorStatIfChanged must be seam-placeable; got: ${r.error}`);
});
