// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawSlotShapeWithHeader (ROM 0xab17-0xab97) -- vector-list drawer: latch X and the A byte into
// $35/$2b, fetch the ($ac) list pointer, cache the cursor into $b6/$b7 when X==0x2c, set scale, then copy
// indexed point pairs into the ($74) buffer until a terminator, tail-jmp advanceDisplayCursor. All six m.calls
// (ab0d, df6a, df75, b0d1, b0dd, df5f) are dissolved. Live-out is memory only; each arm compares RAM.
// Run: node --test games/tempest/idiomatic/test/equivalence-ab17.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ab17 } from "../../translated/loc_ab17.js";
import { drawSlotShapeWithHeader } from "../drawSlotShapeWithHeader.js";
import { u16, u8 } from "../../../../core/int.js";
import { emitFixedVectorWord } from "../emitFixedVectorWord.js";
import { emitBlankVectorWordTag70 } from "../emitBlankVectorWordTag70.js";
import { emitScaledCoordinateRecord } from "../emitScaledCoordinateRecord.js";
import { emitColorStatIfChanged } from "../emitColorStatIfChanged.js";
import { emitScaleWordIfChanged } from "../emitScaleWordIfChanged.js";
import { advanceDisplayCursor } from "../advanceDisplayCursor.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xab17;
const oracle = atEntry(loc_ab17);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xab17 dispatches -- drawSlotShapeWithHeader == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawSlotShapeWithHeader(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A + X are register inputs; ($ac) at offset X points to a vector list terminated by a bit7-set byte.
function seedAt(m, a, x, tableBase, listBase, cursorHi) {
  m.regs.a = a; m.regs.x = x;
  m.mem.write8(0xac, tableBase & 0xff); m.mem.write8(0xad, (tableBase >> 8) & 0xff);
  m.mem.write8((tableBase + x) & 0xffff, listBase & 0xff);
  m.mem.write8((tableBase + x + 1) & 0xffff, (listBase >> 8) & 0xff);
  m.mem.write8((listBase + 0) & 0xffff, 0x06);
  m.mem.write8((listBase + 1) & 0xffff, 0x03);
  m.mem.write8((listBase + 2) & 0xffff, 0x82);
  m.mem.write8(0x74, 0x00); m.mem.write8(0x75, cursorHi);
}

test("CRAFTED: X=0 slot, A latched, no cursor cache -- drawSlotShapeWithHeader == oracle in RAM", () => {
  const s = (m) => seedAt(m, 0x37, 0x00, 0x0400, 0x0420, 0x28);
  const o = new Machine(ROM, OPTS); s(o);
  const c = new Machine(ROM, OPTS); s(c);
  oracle(o); drawSlotShapeWithHeader(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after emit");
  assert.equal(c.mem.read8(0x35), 0x00, "$35 latched X");
});

test("CACHE: X=0x2c latches the cursor into $b6/$b7 -- drawSlotShapeWithHeader == oracle in RAM", () => {
  const s = (m) => { seedAt(m, 0x37, 0x2c, 0x0600, 0x0700, 0x2c); m.mem.write8(0x74, 0x11); m.mem.write8(0x75, 0x2c); };
  const o = new Machine(ROM, OPTS); s(o);
  const c = new Machine(ROM, OPTS); s(c);
  oracle(o); drawSlotShapeWithHeader(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the cache path");
  assert.equal(c.mem.read8(0xb6), 0x11, "$b6 = cached cursor low");
  assert.equal(c.mem.read8(0xb7), 0x2c, "$b7 = cached cursor high");
});

// Full broken twin (X != 0x2c path): drops the -1 on the closing df5f stride.
function brokenTail(m, a = m.regs.a, x = m.regs.x) {
  const { mem8, mem16 } = m;
  mem8[0x35] = x; mem8[0x2b] = a;
  let y = x;
  mem8[0x3b] = mem8[u16(mem16[0xac] + y)];
  y = u8(y + 1);
  mem8[0x3c] = mem8[u16(mem16[0xac] + y)];
  if (x === 0x2c) { mem8[0xb6] = mem8[0x74]; mem8[0xb7] = mem8[0x75]; }
  mem8[0x2a] = mem8[mem16[0x3b]];
  emitFixedVectorWord(m);
  mem8[0x73] = 0x00; mem8[0x72] = 0x01;
  emitBlankVectorWordTag70(m);
  emitScaledCoordinateRecord(m, mem8[0x2a], mem8[0x2b]);
  y = mem8[0x35];
  mem8[0x3b] = mem8[u16(mem16[0xac] + y)];
  y = u8(y + 1);
  mem8[0x3c] = mem8[u16(mem16[0xac] + y)];
  const key = mem8[u16(0xd121 + mem8[0x35])];
  emitColorStatIfChanged(m, key >> 4);
  emitScaleWordIfChanged(m, key & 0x0f);
  mem8[0x2a] = 0x00;
  let listIdx = 0x01, entry;
  do {
    entry = mem8[u16(mem16[0x3b] + listIdx)];
    mem8[0x2b] = entry;
    const src = entry & 0x7f;
    listIdx = u8(listIdx + 1);
    mem8[0x2c] = listIdx;
    let outOff = mem8[0x2a];
    mem8[u16(mem16[0x74] + outOff)] = mem8[u16(0x31e4 + src)];
    outOff = u8(outOff + 1);
    mem8[u16(mem16[0x74] + outOff)] = mem8[u16(0x31e5 + src)];
    outOff = u8(outOff + 1);
    mem8[0x2a] = outOff;
  } while ((entry & 0x80) === 0);
  advanceDisplayCursor(m, mem8[0x2a]); // BUG: missing the -1
}

test("TEETH: a twin that mis-marshals the df5f tail stride diverges from the oracle", () => {
  const s = (m) => seedAt(m, 0x37, 0x00, 0x0400, 0x0420, 0x28);
  const o = new Machine(ROM, OPTS); s(o); oracle(o);
  const c = new Machine(ROM, OPTS); s(c); brokenTail(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong tail stride");
});

test("MUTATION: non-default seed (A=0xc3, X=0x08, different table/cursor) -- drawSlotShapeWithHeader == oracle in RAM", () => {
  const s = (m) => {
    seedAt(m, 0xc3, 0x08, 0x0500, 0x0560, 0x2a);
    m.mem.write8(0x0562, 0x11); m.mem.write8(0x0563, 0x94);
  };
  const o = new Machine(ROM, OPTS); s(o);
  const c = new Machine(ROM, OPTS); s(c);
  oracle(o); drawSlotShapeWithHeader(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the non-default seed");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedAt(m, 0x37, 0x00, 0x0400, 0x0420, 0x28);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawSlotShapeWithHeader, TARGET, m);
  assert.equal(r.placeable, true, `drawSlotShapeWithHeader must be seam-placeable; got: ${r.error}`);
});
