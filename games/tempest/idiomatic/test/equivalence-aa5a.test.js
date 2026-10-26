// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawFrameWithSlot08 (ROM 0xaa5a-0xaa61) -- draws object slot X=8 (drawSlotShapeRecord) then tail-calls
// the shared post-draw step prepCountThenComposeFrame. Dissolves both m.calls. All output is RAM (emitted vector words +
// the post step), so each arm compares the RAM diff (minus the dead stack). Omitted-ret caller.
// Run: node --test games/tempest/idiomatic/test/equivalence-aa5a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aa5a } from "../../translated/loc_aa5a.js";
import { drawFrameWithSlot08 } from "../drawFrameWithSlot08.js";
import { drawSlotShapeRecord } from "../drawSlotShapeRecord.js";
import { prepCountThenComposeFrame } from "../prepCountThenComposeFrame.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaa5a;
const oracle = atEntry(loc_aa5a);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

// drawFrameWithSlot08 -> drawSlotShapeRecord (slot 8), then prepCountThenComposeFrame -> drawSlotThenDigitRun (slot 2) -> composeFrameDisplayList -> drawOverlayFrame (more slots).
// Every drawSlotShapeRecord chases the ($ac) object-table pointer to a bit7-terminated vector list and appends into
// the ($74) cursor; a bare Machine leaves those pointers zero, so ab14 dereferences unmapped MMIO. Give
// each drawn slot a valid list and aim the cursor at vector RAM. Slot 8 (the real draw) and slot 0 (the
// teeth's wrong draw) point at DISTINCT lists so the wrong-slot twin genuinely diverges; the interior
// chain slots share one list. (ROM stays TRUTH; this only supplies the live-in memory both sides read.)
const OBJ_TABLE = 0x0400;
const LIST_SHARED = 0x0480;
const LIST_SLOT8 = 0x0490;
const LIST_SLOT0 = 0x04a0;
function point(m, x, list) {
  m.mem.write8((OBJ_TABLE + x) & 0xffff, list & 0xff);
  m.mem.write8((OBJ_TABLE + x + 1) & 0xffff, (list >> 8) & 0xff);
}
function seedRender(m) {
  m.mem.write8(0xac, OBJ_TABLE & 0xff); m.mem.write8(0xad, (OBJ_TABLE >> 8) & 0xff);
  for (const x of [0x02, 0x24, 0x2c, 0x2e, 0x30, 0x32, 0x36, 0x38, 0x3a]) point(m, x, LIST_SHARED);
  point(m, 0x08, LIST_SLOT8);
  point(m, 0x00, LIST_SLOT0);
  m.mem.write8(LIST_SHARED + 0, 0x06); m.mem.write8(LIST_SHARED + 1, 0x03); m.mem.write8(LIST_SHARED + 2, 0x82);
  m.mem.write8(LIST_SLOT8 + 0, 0x06); m.mem.write8(LIST_SLOT8 + 1, 0x03); m.mem.write8(LIST_SLOT8 + 2, 0x82);
  m.mem.write8(LIST_SLOT0 + 0, 0x0a); m.mem.write8(LIST_SLOT0 + 1, 0x05); m.mem.write8(LIST_SLOT0 + 2, 0x84); // distinct
  m.mem.write8(0x74, 0x00); m.mem.write8(0x75, 0x28); // cursor -> vector RAM (0x2800)
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xaa5a dispatches -- drawFrameWithSlot08 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawFrameWithSlot08(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: slot-8 draw + post step == oracle (RAM)", () => {
  const o = freezePokey(new Machine(ROM, OPTS)); seedRender(o);
  const c = freezePokey(new Machine(ROM, OPTS)); seedRender(c);
  oracle(o); drawFrameWithSlot08(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the slot draw + post step");
});

test("TEETH (slot index): a twin that draws slot 0 instead of slot 8 diverges", () => {
  const o = freezePokey(new Machine(ROM, OPTS)); seedRender(o); oracle(o);
  const c = freezePokey(new Machine(ROM, OPTS)); seedRender(c);
  // BUG: draws the wrong object slot (X=0, a distinct list), so the emitted vector words differ.
  const broken = (m) => { drawSlotShapeRecord(m, 0x00); prepCountThenComposeFrame(m); };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong slot index");
});

test("SP-TOOTH: the omitted-ret caller is seam-placeable", () => {
  const m = freezePokey(new Machine(ROM, OPTS));
  seedRender(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawFrameWithSlot08, TARGET, m);
  assert.equal(r.placeable, true, `drawFrameWithSlot08 must be seam-placeable; got: ${r.error}`);
});
