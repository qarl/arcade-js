// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawEnemyShapeList (ROM 0xb79a-0xb7e4) -- clears $9e, walks the eight slots ($030a,x)
// top-down and, for each non-empty slot, emits a shape record via seatShapeParamsAndEmit (or animateShapeOneVector for shape 1),
// then latches $9f into $01ff when $0720 is set and $9f>=0x0d. The idiomatic side dissolves the two
// jsr ($bcfd, $b7eb) into direct calls. Live-out is memory only, so each arm compares RAM (-stack).
// Run: node --test games/tempest/idiomatic/test/equivalence-b79a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b79a } from "../../translated/loc_b79a.js";
import { drawEnemyShapeList } from "../drawEnemyShapeList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  loc_9e, loc_9f, SLOT_LOOP_INDEX, loc_720, HIGH_LEVEL_MARKER,
  SHAPE_ACTIVE, SHAPE_COORD, SHAPE_ID, SHAPE_ANIM, DRAW_CURSOR_LO, DRAW_CURSOR_HI,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb79a;
const oracle = atEntry(loc_b79a);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb79a dispatches -- drawEnemyShapeList == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawEnemyShapeList(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Slot 0 non-empty shape 0 (bcfd path); slot 1 non-empty shape 1 (b7eb path); the rest empty.
// Cursor into vector RAM so both emit paths write to a diffed region.
function seedSlots(m, flag720, saved9f) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // ($74) -> 0x2000
  for (let i = 0; i < 8; i++) {
    m.mem.write8((SHAPE_ACTIVE + i) & 0xffff, 0x00);
    m.mem.write8((SHAPE_COORD + i) & 0xffff, 0x00);
    m.mem.write8((SHAPE_ID + i) & 0xffff, 0x00);
    m.mem.write8((SHAPE_ANIM + i) & 0xffff, 0x00);
  }
  m.mem.write8((SHAPE_ACTIVE + 0) & 0xffff, 0x44); m.mem.write8((SHAPE_COORD + 0) & 0xffff, 0x02);
  m.mem.write8((SHAPE_ID + 0) & 0xffff, 0x00); m.mem.write8((SHAPE_ANIM + 0) & 0xffff, 0x30);
  m.mem.write8((SHAPE_ACTIVE + 1) & 0xffff, 0x55); m.mem.write8((SHAPE_COORD + 1) & 0xffff, 0x01);
  m.mem.write8((SHAPE_ID + 1) & 0xffff, 0x01);
  m.mem.write8(loc_720, flag720);
  m.mem.write8(loc_9f, saved9f);
}

test("CRAFTED: mixed slots + $0720 set, $9f>=0x0d -- RAM equal and $01ff latched", () => {
  const o = new Machine(ROM, OPTS); seedSlots(o, 0x01, 0x20);
  const c = new Machine(ROM, OPTS); seedSlots(c, 0x01, 0x20);
  oracle(o); drawEnemyShapeList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after slot walk + latch");
  assert.equal(c.mem.read8(loc_9e), 0x00, "$9e cleared");
  assert.equal(c.mem.read8(SLOT_LOOP_INDEX), 0xff, "$37 counter wrapped to 0xff");
  assert.equal(c.mem.read8(HIGH_LEVEL_MARKER), 0x20, "$01ff latched from $9f");
});

test("CRAFTED: $9f below threshold -- no latch; RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedSlots(o, 0x01, 0x05);
  const c = new Machine(ROM, OPTS); seedSlots(c, 0x01, 0x05);
  oracle(o); drawEnemyShapeList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal (below-threshold path)");
});

test("TEETH: a twin that skips the final $01ff latch diverges from the oracle", () => {
  // $01ff sits above the entry floor (fresh S=0xfd: floor 0x01fe), so ramDiff compares it; the latch
  // is also verified on the cell directly: the module must reproduce the oracle's latch, and a twin
  // that skips it must diverge on that exact cell.
  const o = new Machine(ROM, OPTS); seedSlots(o, 0x01, 0x20); oracle(o);
  const c = new Machine(ROM, OPTS); seedSlots(c, 0x01, 0x20);
  drawEnemyShapeList(c);
  assert.equal(o.mem.read8(HIGH_LEVEL_MARKER), 0x20, "oracle must latch $01ff from $9f");
  assert.equal(c.mem.read8(HIGH_LEVEL_MARKER), o.mem.read8(HIGH_LEVEL_MARKER), "module must reproduce the $01ff latch");
  c.mem.write8(HIGH_LEVEL_MARKER, 0x00); // BUG: undo the latch the oracle performed
  assert.notEqual(c.mem.read8(HIGH_LEVEL_MARKER), o.mem.read8(HIGH_LEVEL_MARKER), "skipping the $01ff latch must diverge");
  assert.notEqual(ramDiff(o, c), null, "the RAM diff must hear the skipped $01ff latch");
});

test("SP-TOOTH: the omitted-ret routine (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawEnemyShapeList, TARGET, m);
  assert.equal(r.placeable, true, `drawEnemyShapeList must be seam-placeable; got: ${r.error}`);
});
