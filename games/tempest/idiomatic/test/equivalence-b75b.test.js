// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawSlotShapeList -- a caller that walks twelve slots emitting each non-empty entry's shape
// (dissolving its in-loop jmp into the already-idiomatic seatShapeParamsAndEmit, value + index passed explicitly) then
// latches a level byte. The callee chain shapes vector work cells; live-out is memory only, so each side
// runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). No register inputs.
// Run: node --test games/tempest/idiomatic/test/equivalence-b75b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b75b } from "../../translated/loc_b75b.js";
import { drawSlotShapeList } from "../drawSlotShapeList.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { SLOT_STATE, TARGET_SEG, FRAME_COUNTER, ACTIVE_OBJECT_COUNT, COLOR_RAM_8, SLOT_LOOP_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb75b;
const oracle = atEntry(loc_b75b);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xb75b dispatches -- drawSlotShapeList == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawSlotShapeList(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

const seedVectorRam = (m) => { for (let a = 0x2000; a < 0x2100; a++) m.mem.write8(a, (a * 7) & 0xff); };
const seed = (m, stage) => {
  seedVectorRam(m);
  for (let i = 0; i <= 0x0b; i++) {
    // mix in some empty entries (skipped) and some live ones across the near/far split
    m.mem.write8(u16(SLOT_STATE + i), i % 3 === 0 ? 0x00 : (0x10 + i));
    m.mem.write8(u16(TARGET_SEG + i), 0x40 + i);
  }
  m.mem.write8(FRAME_COUNTER, 0x33);
  m.mem.write8(ACTIVE_OBJECT_COUNT, stage);
};

test("CRAFTED: seeded loop is RAM-equivalent and latches the level byte", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x04); // stage < 6 -> level 0x04
  const c = new Machine(ROM, OPTS); seed(c, 0x04);
  oracle(o); drawSlotShapeList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the walk");
  assert.equal(c.io.colorram[COLOR_RAM_8 & 0x0f], 0x04, "level byte latched to 0x04");
  assert.equal(c.mem.read8(SLOT_LOOP_INDEX), o.mem.read8(SLOT_LOOP_INDEX), "loop counter matches oracle");
});

test("CRAFTED: stage in [6,8) latches 0x0b; stage >= 8 latches 0x0c", () => {
  for (const [stage, want] of [[0x07, 0x0b], [0x09, 0x0c]]) {
    const o = new Machine(ROM, OPTS); seed(o, stage);
    const c = new Machine(ROM, OPTS); seed(c, stage);
    oracle(o); drawSlotShapeList(c);
    assert.equal(ramDiff(o, c), null, `RAM equal at stage ${stage}`);
    assert.equal(c.io.colorram[COLOR_RAM_8 & 0x0f], want, `level byte at stage ${stage}`);
  }
});

test("TEETH (non-default seed): a twin that latches the wrong level byte diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x09);
  const c = new Machine(ROM, OPTS); seed(c, 0x09);
  oracle(o);
  drawSlotShapeList(c);
  c.mem.write8(COLOR_RAM_8, 0x00); // BUG: clobber the latched level byte
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong level byte");
});
