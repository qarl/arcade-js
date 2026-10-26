// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitHeaderedBodyRecord (emit header pair + a fixed body byte through the record
// cursor). The oracle m.calls the translated emitVectorHeaderWord / emitRecordTailByte; the idiomatic calls their
// idiomatic twins directly. The cursor lives at $0074/$0075 and the writes land wherever it
// points, so the contract is RAM (dumpState, minus stack scratch below the entry SP). CRAFTED points the cursor
// into vector RAM (0x2000-0x2fff, diffed); CAPTURE replays real dispatch clones.
// Run: node --test games/tempest/idiomatic/test/equivalence-df0d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df0d } from "../../translated/loc_df0d.js";
import { emitHeaderedBodyRecord } from "../emitHeaderedBodyRecord.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdf0d;
const oracle = atEntry(loc_df0d);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xdf0d dispatches -- emitHeaderedBodyRecord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitHeaderedBodyRecord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Point the cursor into diffed vector RAM and emit a record through both sides.
function cursorArm(lo, hi) {
  const seed = (m) => {
    m.mem.write8(DRAW_CURSOR_LO, lo);
    m.mem.write8(DRAW_CURSOR_HI, hi);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); emitHeaderedBodyRecord(c);
  return { d: ramDiff(o, c), c };
}

test("CRAFTED: cursor at 0x2000 -- header 0x40/0x80 + body 0x20 emitted, RAM equal", () => {
  const { d, c } = cursorArm(0x00, 0x20);
  assert.equal(d, null, "record-emit dissolve must match oracle");
  assert.equal(c.mem.read8(0x2000), 0x40, "header byte 0");
  assert.equal(c.mem.read8(0x2001), 0x80, "header byte 1");
  assert.equal(c.mem.read8(0x2002), 0x20, "body byte at cursor origin");
});

test("CRAFTED: cursor at a different origin 0x2800, RAM equal", () => {
  const { d } = cursorArm(0x00, 0x28);
  assert.equal(d, null, "record-emit dissolve must match at a moved cursor");
});

test("TEETH: a twin that omits the trailing dfac store diverges from the oracle", () => {
  const seed = (m) => { m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  // BUG: writes only the header + first body byte, never runs the dfac tail store/advance.
  const broken = (m) => {
    const { mem8, mem16 } = m;
    const ptr = mem16[DRAW_CURSOR_LO];
    mem8[ptr] = 0x40; mem8[(ptr + 1) & 0xffff] = 0x80;
    mem8[(ptr + 2) & 0xffff] = 0x20;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "RAM diff FAILED to catch the dropped dfac tail");
});
