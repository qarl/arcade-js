// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildMarkerRowVectorList (ROM 0xa97f-0xa9d6) -- builds the 7-entry vector list at $2f60 from
// y-keyed base indices, seeds the $3b/$3c glyph pointer, and tail-transfers into buildTextBufferDigitString (the nibble
// emitter). Dissolves that fall-through into a direct idiomatic call. The oracle m.calls frozen a9d7; the
// idiomatic calls idiomatic a9d7. Output is RAM ($2f60 list, $38, $3b/$3c) plus the a9d7 write cursor left
// in X on the emit path -- so tail cases also assert o.regs.x vs c.regs.x. The early-exit path emits
// nothing (X incidental there). An omitted-ret rewrite.
// Run: node --test games/tempest/idiomatic/test/equivalence-a97f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a97f } from "../../translated/loc_a97f.js";
import { buildMarkerRowVectorList } from "../buildMarkerRowVectorList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  loc_2b, loc_3d, STATUS_FLAGS, VEC_GLYPH_BUFFER, SLOT_COUNTDOWN, TABLE_CURSOR, GAME_MODE, WORK_PTR_LO, WORK_PTR_HI,
  BAR_GLYPH_LOW, BAR_GLYPH_HIGH, MARKERROW_HEAD_OFS,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa97f;
const oracle = atEntry(loc_a97f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

function seat(m, s = {}) {
  m.regs.a = s.a ?? 0x0c;
  m.regs.y = s.y ?? 1;
  m.regs.x = 0x00;
  m.mem.write8(loc_3d, s.c3d ?? 0x05);
  m.mem.write8(STATUS_FLAGS, s.c5 ?? 0x00);
  m.mem.write8(GAME_MODE, s.c00 ?? 0x00);
  m.mem.write8(BAR_GLYPH_LOW, s.g0 ?? 0xaa);
  m.mem.write8(BAR_GLYPH_HIGH, s.g1 ?? 0xbb);
  const cnt = s.cnt ?? [0, 3, 3, 3, 3, 3, 3, 3];
  for (let i = 0; i < 8; i++) m.mem.write8((SLOT_COUNTDOWN + i) & 0xffff, cnt[i]);
  m.mem.write8(TABLE_CURSOR, 0x00);
  m.mem.write8(loc_2b, 0x00);
  m.mem.write8(WORK_PTR_LO, 0x00);
  m.mem.write8(WORK_PTR_HI, 0x00);
}

test("CAPTURE: real 0xa97f dispatches -- buildMarkerRowVectorList == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); buildMarkerRowVectorList(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seeded states across every branch == oracle (RAM + emit cursor)", () => {
  const cases = [
    { tag: "build + emit, off-marker", y: 1, c3d: 5, c00: 0, tail: true },
    { tag: "marker path: head zeroed + count dec", y: 3, c3d: 3, c5: 0x80, c00: 0, tail: true },
    { tag: "early exit: state 4 off-marker", y: 1, c3d: 5, c00: 4, tail: false },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seat(o, s);
    const c = new Machine(ROM, OPTS); seat(c, s);
    oracle(o); buildMarkerRowVectorList(c);
    assert.equal(ramDiff(o, c), null, s.tag);
    if (s.tail) assert.equal(c.regs.x, o.regs.x, `${s.tag}: emit cursor (X) live-out`);
  }
});

test("TEETH: a twin that skips the head-zero + emit tail diverges (RAM + cursor)", () => {
  const s = { a: 0x0c, y: 3, c3d: 3, c5: 0x80, c00: 0 };
  const o = new Machine(ROM, OPTS); seat(o, s);
  const c = new Machine(ROM, OPTS); seat(c, s);
  oracle(o);
  // BUG: never zeroes the head at the marker and skips the loop + $3b pointer + a9d7 emit.
  const broken = (m, y) => {
    const { mem8 } = m;
    mem8[loc_2b] = y;
    const a = 0x0c | 0x70; // head NOT zeroed
    const x = mem8[(MARKERROW_HEAD_OFS + y) & 0xffff];
    mem8[(VEC_GLYPH_BUFFER + x) & 0xffff] = a;
  };
  broken(c, s.y);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped emit tail");
  assert.notEqual(c.regs.x, o.regs.x, "the emit cursor (X) FAILED to diverge");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m, { y: 1, c3d: 5, c00: 4 }); // early-exit seed keeps the tooth cheap
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, buildMarkerRowVectorList, TARGET, m);
  assert.equal(r.placeable, true, `buildMarkerRowVectorList must be seam-placeable; got: ${r.error}`);
});
