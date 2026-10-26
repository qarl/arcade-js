// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildEnemyDisplayList -- rebuilds the per-frame enemy display list: per slot copy a header
// then append a midpoint pair or a straight/sign-fixed block; dissolves m.calls to df6a/c66d/c6c7/df5f.
// Output is RAM (the ($74) display list + scratch cells), so each arm compares the RAM diff (minus dead
// stack). A pure tail-caller (jmp df5f). CRAFTED keeps every slot inactive (kind bytes 0), so the copy
// path is taken and the POKEY-random branch of c6c7 is never reached.
// Run: node --test games/tempest/idiomatic/test/equivalence-c5c2.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c5c2 } from "../../translated/loc_c5c2.js";
import { buildEnemyDisplayList } from "../buildEnemyDisplayList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  DEPTH_LO, DEPTH_HI, DRAW_CURSOR_LO, DRAW_CURSOR_HI, DRAW_CURSOR_OFFSET, DRAW_SRC_PTR_LO, DRAW_SRC_PTR_HI,
  loc_110, TUBE_GEOM_FLAG, REDRAW_COUNTER, LANE_TARGET_FLAG,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc5c2;
const oracle = atEntry(loc_c5c2);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 5000) : [];

// Run the build: guards pass, non-forced path, every kind byte 0 (straight-copy, no random branch).
// Point the display-list ($74) and source ($aa) pointers into distinct vector-RAM pages, with source
// bytes seeded so the copies are observable.
function seat(m) {
  m.mem.write8(loc_110, 0x00);
  m.mem.write8(DEPTH_LO, 0x01);   // nonzero -> skip the $5f gate
  m.mem.write8(DEPTH_HI, 0x00);
  m.mem.write8(TUBE_GEOM_FLAG, 0x00);
  m.mem.write8(REDRAW_COUNTER, 0x00);
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x24); // dest 0x2400
  m.mem.write8(DRAW_SRC_PTR_LO, 0x00); m.mem.write8(DRAW_SRC_PTR_HI, 0x26); // source 0x2600
  for (let i = 0; i < 16; i++) m.mem.write8((LANE_TARGET_FLAG + i) & 0xffff, 0x00);
  for (let i = 0; i < 0x100; i++) m.mem.write8((0x2600 + i) & 0xffff, (i * 7) & 0xff);
}

test("CAPTURE: real 0xc5c2 dispatches -- buildEnemyDisplayList == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); buildEnemyDisplayList(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: full list rebuild (all slots straight-copy) == oracle (RAM)", () => {
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  oracle(o); buildEnemyDisplayList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after rebuild");
});

test("CRAFTED-guard: $0110 set -> immediate return leaves RAM untouched == oracle", () => {
  const o = new Machine(ROM, OPTS); seat(o); o.mem.write8(loc_110, 0x01);
  const c = new Machine(ROM, OPTS); seat(c); c.mem.write8(loc_110, 0x01);
  oracle(o); buildEnemyDisplayList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on early return");
});

test("TEETH: a twin that corrupts the write cursor diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  oracle(o);
  const broken = (mm) => { buildEnemyDisplayList(mm); mm.mem8[DRAW_CURSOR_OFFSET] ^= 0xff; }; // BUG: leaves a wrong cursor
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the corrupted cursor");
});

test("SP-TOOTH: the omitted-ret tail rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, buildEnemyDisplayList, TARGET, m);
  assert.equal(r.placeable, true, `buildEnemyDisplayList must be seam-placeable; got: ${r.error}`);
});
