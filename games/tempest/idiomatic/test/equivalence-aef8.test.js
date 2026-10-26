// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawThreeCharGlyphString (ROM 0xaef8) -- from the caller's A it sets a slot count, copies three
// 2-byte glyph words through the ($74) pointer, then tail-transfers into advanceDisplayCursor to advance the cursor.
// The oracle m.calls translated df5f; the idiomatic dissolves it into a direct idiomatic call. Both are
// memory-equivalent, so each arm compares RAM (dumpState, minus stack scratch below the entry SP). Live-out is RAM only
// (regs at RTS are the tail callee's incidental leftovers). A is a live-in via the register bridge.
// Run: node --test games/tempest/idiomatic/test/equivalence-aef8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aef8 } from "../../translated/loc_aef8.js";
import { drawThreeCharGlyphString } from "../drawThreeCharGlyphString.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { TABLE_CURSOR, DRAW_CURSOR_LO, DRAW_CURSOR_HI, SLOT_VALUE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (n) => new Uint8Array(readFileSync(new URL(n, ROM_DIR)));
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? rd("maincpu.bin") : null;
const opt = (n) => (existsSync(new URL(n, ROM_DIR)) ? rd(n) : undefined);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaef8;
const oracle = atEntry(loc_aef8);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

const A_IN = 0x04;
// Point the ($74) buffer at RAM 0x0400 and seed three small (unclamped) source bytes.
function seeded(a = A_IN) {
  const m = new Machine(ROM, OPTS);
  m.regs.a = a;
  m.mem.write8(DRAW_CURSOR_LO, 0x00);
  m.mem.write8(DRAW_CURSOR_HI, 0x04); // pointer -> 0x0400
  m.mem.write8((SLOT_VALUE + a + 0) & 0xffff, 0x02);
  m.mem.write8((SLOT_VALUE + a + 1) & 0xffff, 0x05);
  m.mem.write8((SLOT_VALUE + a + 2) & 0xffff, 0x0a);
  return m;
}

test("CAPTURE: real 0xaef8 dispatches -- drawThreeCharGlyphString == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawThreeCharGlyphString(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: three glyph words copied and the cursor advanced via df5f (== oracle, RAM)", () => {
  const o = seeded(), c = seeded();
  oracle(o); drawThreeCharGlyphString(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after copy + advance");
  assert.equal(c.mem.read8(DRAW_CURSOR_LO), 0x06, "cursor advanced by 6");
});

test("TEETH: a twin that skips the df5f dissolve leaves the cursor unadvanced and diverges", () => {
  const o = seeded(); oracle(o);
  assert.equal(o.mem.read8(DRAW_CURSOR_LO), 0x06, "precondition: oracle advanced the cursor");
  const c = seeded(); drawThreeCharGlyphString(c);
  c.mem.write8(DRAW_CURSOR_LO, 0x00); // BUG: as if the df5f call never ran
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped df5f");
});

test("TEETH: a twin that corrupts one copied glyph byte diverges", () => {
  const o = seeded(); oracle(o);
  const c = seeded(); drawThreeCharGlyphString(c);
  c.mem.write8(0x0402, (c.mem.read8(0x0402) ^ 0xff) & 0xff); // BUG: wrong glyph byte
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a corrupted glyph byte");
});
