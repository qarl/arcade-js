// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawFrameWithSlot32 (ROM 0xaa79-0xaa8f) -- draws a vector list (drawSlotShapeWithHeader A=0/X=$32), then
// when ($03 & $1f) < $10 draws a second (A=$e0/X=$22), and tail-calls the frame setup buildTextOverlayList. Dissolves
// every m.call. All output is RAM (emitted vector words + setup), so each arm compares the RAM diff (minus
// the dead stack). Omitted-ret caller.
// Run: node --test games/tempest/idiomatic/test/equivalence-aa79.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aa79 } from "../../translated/loc_aa79.js";
import { drawFrameWithSlot32 } from "../drawFrameWithSlot32.js";
import { drawSlotShapeWithHeader } from "../drawSlotShapeWithHeader.js";
import { buildTextOverlayList } from "../buildTextOverlayList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { FRAME_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaa79;
// Prime the object-render pipeline these routines dive into (ab17/ab14/a8b4 read a list-pointer table
// via ($ac),x and emit vector words through ($74)). A fresh Machine leaves $ac/$74 = 0, so the list
// pointer resolves into the unmapped 0x8000 hole. Point $ac at a synthetic pointer table in work RAM
// whose every slot targets a one-entry, bit7-terminated list, and $74 at a writable output buffer.
function seedPipe(m) {
  const w = (a, v) => m.mem.write8(a, v);
  w(0xac, 0x00); w(0xad, 0x04); // list-pointer table base -> 0x0400
  w(0x74, 0x00); w(0x75, 0x05); // vector-word output buffer -> 0x0500
  for (let i = 0; i < 0x80; i += 2) { w(0x0400 + i, 0x20); w(0x0400 + i + 1, 0x04); } // every slot -> 0x0420
  w(0x0420, 0x00); w(0x0421, 0x80); // list: one entry then a bit7 terminator
}
const oracle = atEntry(loc_aa79);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xaa79 dispatches -- drawFrameWithSlot32 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawFrameWithSlot32(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: low status draws both lists, high status draws only one -- both == oracle (RAM)", () => {
  const cases = [
    { tag: "$03 nibble low -> second draw fires", c03: 0x05 },
    { tag: "$03 nibble high -> second draw skipped", c03: 0x1a },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seedPipe(o); o.mem.write8(FRAME_COUNTER, s.c03);
    const c = new Machine(ROM, OPTS); seedPipe(c); c.mem.write8(FRAME_COUNTER, s.c03);
    oracle(o); drawFrameWithSlot32(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a twin that always draws the second list diverges on the high-status case", () => {
  const c03 = 0x1a; // >= 0x10 -> oracle must skip the second draw
  const o = new Machine(ROM, OPTS); seedPipe(o); o.mem.write8(FRAME_COUNTER, c03); oracle(o);
  const c = new Machine(ROM, OPTS); seedPipe(c); c.mem.write8(FRAME_COUNTER, c03);
  // BUG: ignores the gate and always draws the second list.
  const broken = (m) => { drawSlotShapeWithHeader(m, 0x00, 0x32); drawSlotShapeWithHeader(m, 0xe0, 0x22); buildTextOverlayList(m); };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the ungated second draw");
});

test("SP-TOOTH: the omitted-ret caller is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seedPipe(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawFrameWithSlot32, TARGET, m);
  assert.equal(r.placeable, true, `drawFrameWithSlot32 must be seam-placeable; got: ${r.error}`);
});
