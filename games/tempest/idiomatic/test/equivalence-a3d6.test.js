// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for insertTimedObject (ROM 0xa3d6-0xa415) -- inserts an object into the 8-slot table at
// $030a/$0302/$0312/$02fa,x: reuses the first empty $030a,x==0 slot, else evicts the max-$0312 slot and
// dec's the count $0116; fills the four fields, inc's $0116. Live-out is memory only (A/X/Y at RTS are
// incidental -- X/Y are restored to entry), so each side runs on a clone and the contract is RAM (dumpState,
// minus stack scratch below the entry SP). A leaf: the module omits the ROM ret and the seam completes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-a3d6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a3d6 } from "../../translated/loc_a3d6.js";
import { insertTimedObject } from "../insertTimedObject.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI, TIMED_OBJECT_COUNT, SHAPE_ACTIVE, SHAPE_ANIM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa3d6;
const oracle = atEntry(loc_a3d6);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa3d6 dispatches -- insertTimedObject == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); insertTimedObject(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: free-slot insert -- new object lands in the first empty slot, count bumps", () => {
  const seed = (m) => {
    m.regs.x = 0x11; m.regs.y = 0x22;
    for (let i = 0; i < 8; i++) m.mem.write8((SHAPE_ACTIVE + i) & 0xffff, i === 3 ? 0x00 : 0x90 + i);
    for (let i = 0; i < 8; i++) m.mem.write8((SHAPE_ANIM + i) & 0xffff, 0x10 + i);
    m.mem.write8(loc_29, 0xab);
    m.mem.write8(COORD_LIST_PTR_LO, 0xcd);
    m.mem.write8(COORD_LIST_PTR_HI, 0xef);
    m.mem.write8(TIMED_OBJECT_COUNT, 0x05);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); insertTimedObject(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after insert");
  assert.equal(c.mem.read8((SHAPE_ACTIVE + 3) & 0xffff), 0xab, "type field written to free slot 3");
  assert.equal(c.mem.read8((SHAPE_ANIM + 3) & 0xffff), 0x00, "counter zeroed in free slot 3");
  assert.equal(c.mem.read8(TIMED_OBJECT_COUNT), 0x06, "count incremented");
});

test("CRAFTED: no free slot -- max-$0312 slot evicted, count net-unchanged", () => {
  const seed = (m) => {
    m.regs.x = 0x00; m.regs.y = 0x00;
    for (let i = 0; i < 8; i++) m.mem.write8((SHAPE_ACTIVE + i) & 0xffff, 0x90 + i); // all occupied
    for (let i = 0; i < 8; i++) m.mem.write8((SHAPE_ANIM + i) & 0xffff, i === 2 ? 0xf0 : 0x10); // slot 2 is max
    m.mem.write8(loc_29, 0x77);
    m.mem.write8(COORD_LIST_PTR_LO, 0x66);
    m.mem.write8(COORD_LIST_PTR_HI, 0x55);
    m.mem.write8(TIMED_OBJECT_COUNT, 0x08);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); insertTimedObject(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after eviction");
  assert.equal(c.mem.read8((SHAPE_ACTIVE + 2) & 0xffff), 0x77, "new object evicts the max slot (2)");
  assert.equal(c.mem.read8(TIMED_OBJECT_COUNT), 0x08, "count dec then inc -- net unchanged");
});

test("TEETH: a twin that skips the final count-increment diverges from the oracle", () => {
  const seed = (m) => {
    m.regs.x = 0x11; m.regs.y = 0x22;
    for (let i = 0; i < 8; i++) m.mem.write8((SHAPE_ACTIVE + i) & 0xffff, i === 3 ? 0x00 : 0x90 + i);
    for (let i = 0; i < 8; i++) m.mem.write8((SHAPE_ANIM + i) & 0xffff, 0x10 + i);
    m.mem.write8(loc_29, 0xab); m.mem.write8(COORD_LIST_PTR_LO, 0xcd); m.mem.write8(COORD_LIST_PTR_HI, 0xef);
    m.mem.write8(TIMED_OBJECT_COUNT, 0x05);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const mem = m.mem8;
    // fill the free slot 3 but BUG: never increment the count $0116
    mem[(SHAPE_ANIM + 3) & 0xffff] = 0x00;
    mem[(0x0302 + 3) & 0xffff] = mem[0x2c];
    mem[(SHAPE_ACTIVE + 3) & 0xffff] = mem[0x29];
    mem[(0x02fa + 3) & 0xffff] = mem[0x2d];
    mem[0x35] = m.regs.x; mem[0x36] = m.regs.y; mem[0x2a] = 0; mem[0x2b] = 0;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped count-increment");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, insertTimedObject, TARGET, m);
  assert.equal(r.placeable, true, `insertTimedObject must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
