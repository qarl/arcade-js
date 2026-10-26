// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for expandShapeListToVectors (ROM 0xab3b-0xab97) -- header/scale setup then a copy loop that emits
// indexed point pairs into the ($74) buffer until a high-bit terminator, tail-jmp advanceDisplayCursor. All five
// m.calls (df6a, df75, b0d1, b0dd, df5f) are dissolved to direct idiomatic calls. Live-out is memory
// only (buffer + cursor + scratch), so each arm compares RAM (dumpState minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-ab3b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ab3b } from "../../translated/loc_ab3b.js";
import { expandShapeListToVectors } from "../expandShapeListToVectors.js";
import { u16, u8 } from "../../../../core/int.js";
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

const TARGET = 0xab3b;
const oracle = atEntry(loc_ab3b);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xab3b dispatches -- expandShapeListToVectors == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); expandShapeListToVectors(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Point $ac -> a pointer table at 0x0400 whose (index 0) entry points to a vector list at 0x0420,
// terminated by a bit7-set byte. Cursor $74 -> 0x2800 (vector RAM, diffed).
function seed(m) {
  m.mem.write8(0x35, 0x00);                             // list index
  m.mem.write8(0xac, 0x00); m.mem.write8(0xad, 0x04);   // ($ac) -> 0x0400
  m.mem.write8(0x0400, 0x20); m.mem.write8(0x0401, 0x04); // ($3b) -> 0x0420
  m.mem.write8(0x0420, 0x06);                           // header byte (index 0)
  m.mem.write8(0x0421, 0x03);                           // entry, bit7 clear
  m.mem.write8(0x0422, 0x82);                           // entry, bit7 set -> terminate
  m.mem.write8(0x74, 0x00); m.mem.write8(0x75, 0x28);   // cursor -> 0x2800
  m.mem.write8(0x2a, 0x04); m.mem.write8(0x2b, 0x02);   // feed df75 marshalling
}

test("CRAFTED: header/scale + pair-copy loop -- expandShapeListToVectors == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); expandShapeListToVectors(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after emit");
  assert.equal(c.mem.read8(0x2a), 0x04, "$2a = 2 entries x 2 bytes");
  assert.equal(c.mem.read8(0x2b), 0x82, "$2b = last (terminator) entry");
});

// Full broken twin: same body, but the tail-call marshalling drops the -1 on the df5f stride.
function brokenTail(m) {
  const { mem8, mem16 } = m;
  mem8[0x73] = 0x00; mem8[0x72] = 0x01;
  emitBlankVectorWordTag70(m);
  emitScaledCoordinateRecord(m, mem8[0x2a], mem8[0x2b]);
  let y = mem8[0x35];
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
  advanceDisplayCursor(m, mem8[0x2a]); // BUG: missing the -1 on the closing stride
}

test("TEETH: a twin that mis-marshals the df5f tail stride diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c); brokenTail(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong tail stride");
});

function seedMut(m) {
  m.mem.write8(0x35, 0x00);
  m.mem.write8(0xac, 0x00); m.mem.write8(0xad, 0x05);   // ($ac) -> 0x0500
  m.mem.write8(0x0500, 0x30); m.mem.write8(0x0501, 0x05); // ($3b) -> 0x0530
  m.mem.write8(0x0530, 0x09);
  m.mem.write8(0x0531, 0x11);
  m.mem.write8(0x0532, 0x07);
  m.mem.write8(0x0533, 0x94);                           // terminator
  m.mem.write8(0x74, 0x40); m.mem.write8(0x75, 0x2a);   // cursor -> 0x2a40
  m.mem.write8(0x2a, 0x1c); m.mem.write8(0x2b, 0xc3);
}

test("MUTATION: non-default seed (longer list, different cursor) -- expandShapeListToVectors == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedMut(o);
  const c = new Machine(ROM, OPTS); seedMut(c);
  oracle(o); expandShapeListToVectors(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the non-default seed");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seed(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, expandShapeListToVectors, TARGET, m);
  assert.equal(r.placeable, true, `expandShapeListToVectors must be seam-placeable; got: ${r.error}`);
});
