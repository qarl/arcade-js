// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for primeTopPriorityObject (ROM 0xa34b-0xa36e) -- seeds a fresh top-priority object's flag/source/
// target cells, then fires the sound gate (gateSound5f) and the table insert (insertTimedObject), then raises two ready
// flags. The idiomatic side dissolves the two jsr into direct gateSound5f/insertTimedObject calls, passing the entry
// X/Y (preserved across both callees). Live-out is memory only (A at RTS is incidental; X/Y are restored to
// their entry values), so each arm compares RAM (dumpState minus stack scratch below the entry SP) and checks X/Y unchanged.
// Run: node --test games/tempest/idiomatic/test/equivalence-a34b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a34b } from "../../translated/loc_a34b.js";
import { primeTopPriorityObject } from "../primeTopPriorityObject.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { gateSound5f } from "../gateSound5f.js";
import { insertTimedObject } from "../insertTimedObject.js";
import { STATUS_FLAGS, loc_29, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI, OBJECT_ANIM_PHASE, OBJECT_ANIM_TIMER, PLAYER_SEGMENT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa34b;
const oracle = atEntry(loc_a34b);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa34b dispatches -- primeTopPriorityObject == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); primeTopPriorityObject(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X preserved");
    assert.equal(c.regs.y, o.regs.y, "Y preserved");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m) {
  m.regs.x = 0x05; m.regs.y = 0x03; // register bridge -> $31/$32 (sound) and $35/$36 (insert)
  m.mem.write8(STATUS_FLAGS, 0x80);        // sound enable high bit set so the gate runs its body
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x77);      // source byte -> $29
  m.mem.write8(PLAYER_SEGMENT, 0x88);      // target byte -> $2d
}

test("CRAFTED: seeds, sound gate and insert run -- RAM equal and X/Y preserved", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); primeTopPriorityObject(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after setup");
  assert.equal(c.regs.x, o.regs.x, "X preserved");
  assert.equal(c.regs.y, o.regs.y, "Y preserved");
  assert.equal(c.mem.read8(OBJECT_ANIM_PHASE), 0xff, "$013b flag set");
  assert.equal(c.mem.read8(COORD_LIST_PTR_LO), 0x01, "$2c seeded");
  assert.equal(c.mem.read8(PLAYER_FINE_ANGLE), 0x81, "$0201 ready flag");
  assert.equal(c.mem.read8(OBJECT_ANIM_TIMER), 0x01, "$013c ready flag");
});

test("TEETH: a twin that passes a stale X/Y to the sound gate and insert diverges in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m, x = m.regs.x, y = m.regs.y) => {
    const { mem8 } = m;
    mem8[OBJECT_ANIM_PHASE] = 0xff;
    mem8[COORD_LIST_PTR_LO] = 0x01;
    mem8[loc_29] = mem8[PLAYER_SHOT_DEPTH];
    mem8[COORD_LIST_PTR_HI] = mem8[PLAYER_SEGMENT];
    gateSound5f(m, 0x00, 0x00); // BUG: stale X/Y -> wrong $31/$32
    insertTimedObject(m, 0x00, 0x00); // BUG: stale X/Y -> wrong $35/$36
    mem8[PLAYER_FINE_ANGLE] = 0x81;
    mem8[OBJECT_ANIM_TIMER] = 0x01;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the stale register bridge");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, primeTopPriorityObject, TARGET, m);
  assert.equal(r.placeable, true, `primeTopPriorityObject must be seam-placeable; got: ${r.error}`);
});
