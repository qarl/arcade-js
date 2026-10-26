// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for insertTimedObjectOfType (ROM 0xa3d4-0xa3d5) -- stores A into $2c, then falls into insertTimedObject
// (the 8-slot object insert). The oracle m.calls the frozen a3d6; the idiomatic calls idiomatic a3d6.
// All output is RAM (the inserted slot's four fields + the count), so each arm compares the RAM diff
// (minus the dead stack). An omitted-ret rewrite (the seam completes the ret). A/X/Y at RTS incidental.
// Run: node --test games/tempest/idiomatic/test/equivalence-a3d4.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a3d4 } from "../../translated/loc_a3d4.js";
import { insertTimedObjectOfType } from "../insertTimedObjectOfType.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { COORD_LIST_PTR_LO, loc_29, COORD_LIST_PTR_HI, TIMED_OBJECT_COUNT, SHAPE_ACTIVE, SHAPE_ID, SHAPE_COORD, SHAPE_ANIM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa3d4;
const oracle = atEntry(loc_a3d4);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

// Seed A + the source fields a3d6 copies, plus the 8-slot table and age table.
function seat(m, s = {}) {
  m.regs.a = s.a ?? 0x77;
  m.regs.x = s.x ?? 0x03;
  m.regs.y = s.y ?? 0x05;
  m.mem.write8(COORD_LIST_PTR_LO, s.c2c ?? 0x11);   // distinct from A so the $2c store is observable
  m.mem.write8(loc_29, s.c29 ?? 0x22);
  m.mem.write8(COORD_LIST_PTR_HI, s.c2d ?? 0x33);
  m.mem.write8(TIMED_OBJECT_COUNT, s.count ?? 0x02);
  for (let i = 0; i < 8; i++) {
    m.mem.write8((SHAPE_ACTIVE + i) & 0xffff, (s.table ?? [0, 0, 0, 0, 0, 0, 0, 0])[i]);
    m.mem.write8((SHAPE_ANIM + i) & 0xffff, (s.ages ?? [1, 2, 3, 4, 5, 6, 7, 8])[i]);
  }
}

test("CAPTURE: real 0xa3d4 dispatches -- insertTimedObjectOfType == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); insertTimedObjectOfType(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seeded states across every branch == oracle (RAM)", () => {
  const cases = [
    { tag: "empty slot 7 reused", table: [9, 9, 9, 9, 9, 9, 9, 0] },
    { tag: "empty slot 0 reused", table: [0, 9, 9, 9, 9, 9, 9, 9] },
    { tag: "no free slot -> evict max age", table: [1, 2, 3, 4, 5, 6, 7, 8], ages: [3, 3, 9, 3, 3, 3, 3, 3] },
    { tag: "no free slot, tie -> lowest index wins", table: [1, 2, 3, 4, 5, 6, 7, 8], ages: [9, 9, 9, 9, 9, 9, 9, 9] },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seat(o, s);
    const c = new Machine(ROM, OPTS); seat(c, s);
    oracle(o); insertTimedObjectOfType(c);
    assert.equal(ramDiff(o, c), null, s.tag);
    assert.equal(c.mem.read8(COORD_LIST_PTR_LO), s.a ?? 0x77, `${s.tag}: A stored into $2c`);
  }
});

test("TEETH: a twin that skips the $2c store diverges from the oracle", () => {
  const s = { a: 0x77, c2c: 0x11, table: [9, 9, 9, 9, 9, 9, 9, 0] };
  const o = new Machine(ROM, OPTS); seat(o, s);
  const c = new Machine(ROM, OPTS); seat(c, s);
  oracle(o);
  // BUG: never stores A into $2c, so the inserted slot's $0302 field carries the stale value.
  const broken = (m) => {
    const { mem8 } = m;
    let slot = -1, best = 0, bestI = 0;
    for (let i = 7; i >= 0; i--) {
      if (mem8[(SHAPE_ACTIVE + i) & 0xffff] === 0) { slot = i; break; }
      const age = mem8[(SHAPE_ANIM + i) & 0xffff];
      if (age >= best) { best = age; bestI = i; }
    }
    if (slot < 0) { mem8[TIMED_OBJECT_COUNT] = (mem8[TIMED_OBJECT_COUNT] - 1) & 0xff; slot = bestI; }
    mem8[(SHAPE_ANIM + slot) & 0xffff] = 0;
    mem8[(SHAPE_ID + slot) & 0xffff] = mem8[COORD_LIST_PTR_LO];   // stale $2c (store skipped)
    mem8[(SHAPE_ACTIVE + slot) & 0xffff] = mem8[loc_29];
    mem8[(SHAPE_COORD + slot) & 0xffff] = mem8[COORD_LIST_PTR_HI];
    mem8[TIMED_OBJECT_COUNT] = (mem8[TIMED_OBJECT_COUNT] + 1) & 0xff;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped $2c store");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seat(m, { table: [9, 9, 9, 9, 9, 9, 9, 0] });
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, insertTimedObjectOfType, TARGET, m);
  assert.equal(r.placeable, true, `insertTimedObjectOfType must be seam-placeable; got: ${r.error}`);
});
