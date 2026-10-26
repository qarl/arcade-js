// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitCappedCount (ROM 0xaf71-0xaf76) -- clamps A to a max of 0x63, then falls into
// emitByteAsBcdDigits (pack-to-BCD + emit). The idiomatic side dissolves the jsr into a direct emitByteAsBcdDigits(m, clamped)
// call, seating the clamped byte explicitly. Both sides pull A from m.regs.a, so seed it. Live-out is
// memory only, so each arm compares RAM (dumpState minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-af71.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_af71 } from "../../translated/loc_af71.js";
import { emitCappedCount } from "../emitCappedCount.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { emitByteAsBcdDigits } from "../emitByteAsBcdDigits.js";
import { loc_29, COORD_LIST_PTR_LO, DRAW_CURSOR_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaf71;
const oracle = atEntry(loc_af71);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xaf71 dispatches -- emitCappedCount == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitCappedCount(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Cursor aimed into vector RAM so the emit lands in the diffed region.
function seed(m, aVal) {
  m.regs.a = aVal;
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_LO + 1, 0x21); // ($74) -> 0x2100
}

test("CRAFTED: A=0x40 (< 0x63, passes through) -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x40);
  const c = new Machine(ROM, OPTS); seed(c, 0x40);
  oracle(o); emitCappedCount(c);
  assert.equal(ramDiff(o, c), null, "RAM equal for the unclamped byte");
});

test("CRAFTED: A=0x80 (>= 0x63, clamps to 0x63) -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x80);
  const c = new Machine(ROM, OPTS); seed(c, 0x80);
  oracle(o); emitCappedCount(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the clamp");
  assert.equal(c.mem.read8(loc_29), c.mem.read8(COORD_LIST_PTR_LO), "packed BCD of the clamped 0x63 landed");
});

test("TEETH: a twin that skips the clamp diverges from the oracle (A=0x80)", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x80); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c, 0x80);
  const broken = (m, a = m.regs.a) => emitByteAsBcdDigits(m, a); // BUG: never clamps to 0x63
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped clamp");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_LO + 1, 0x21);
  const r = seamPlaceable(withOmittedRet, emitCappedCount, TARGET, m);
  assert.equal(r.placeable, true, `emitCappedCount must be seam-placeable; got: ${r.error}`);
});
