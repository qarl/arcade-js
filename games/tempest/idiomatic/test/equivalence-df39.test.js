// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitCoordinateVectorWord (ROM 0xdf39-0xdf4b) -- a tail-CALLER that emits a coordinate word through
// the ($74) cursor (high byte = tagged upper nibble of A, low byte = X rotated right) then dissolves its
// tail branch into a direct advanceDisplayCursor cursor-advance (the fall path, unreachable since Y is always 1, would
// tail into emitTaggedVectorWord). Effect is memory only; the emitter returns nothing, so each arm compares RAM
// (dumpState minus stack scratch below the entry SP). A/X are register inputs, carried on both sides via clones of one base.
// Run: node --test games/tempest/idiomatic/test/equivalence-df39.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df39 } from "../../translated/loc_df39.js";
import { emitCoordinateVectorWord } from "../emitCoordinateVectorWord.js";
import { advanceDisplayCursor } from "../advanceDisplayCursor.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
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

const TARGET = 0xdf39;
const oracle = atEntry(loc_df39);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xdf39 dispatches -- emitCoordinateVectorWord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitCoordinateVectorWord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Cursor into vector RAM (0x2000). A=0x0b: hi=((0x0b>>1)&0x0f)|0xa0=0xa5, carry=1. X=0x44: lo=0x80|0x22=0xa2.
function seed(m) {
  m.mem.write8(0x74, 0x00);
  m.mem.write8(0x75, 0x20);
  m.regs.a = 0x0b;
  m.regs.x = 0x44;
}

test("CRAFTED: emits {lo,hi} coordinate word and advances the cursor by two", () => {
  const base = new Machine(ROM, OPTS); seed(base);
  const o = base.clone(), c = base.clone();
  oracle(o); emitCoordinateVectorWord(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after emit");
  assert.equal(c.mem.read8(0x2000), 0xa2, "low byte = X rotated right with carry-in");
  assert.equal(c.mem.read8(0x2001), 0xa5, "high byte = tagged upper nibble of A");
  assert.equal(c.mem.read8(0x74), 0x02, "cursor advanced by two");
});

test("TEETH: a twin that drops the 0xa0 tag on the high byte diverges from the oracle", () => {
  const base = new Machine(ROM, OPTS); seed(base);
  const o = base.clone(), c = base.clone();
  oracle(o);
  const broken = (m, a = m.regs.a, x = m.regs.x) => {
    const { mem8, mem16 } = m;
    const carry = a & 0x01;
    const hi = (a >> 1) & 0x0f; // BUG: no | 0xa0 tag
    const lo = ((carry << 7) | (x >> 1)) & 0xff;
    const ptr = mem16[0x74];
    mem8[(ptr + 1) & 0xffff] = hi;
    mem8[ptr & 0xffff] = lo;
    return advanceDisplayCursor(m, 1); // advance identically so only the tag differs
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing tag");
});
