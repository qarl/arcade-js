// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawTimedObjectList (ROM 0xc54d-0xc5c1) -- a CALLER that dissolves jsr $df4c and jsr $bd09
// into direct idiomatic calls: while the guard flag is set it forces three cursor cells and, per nonzero
// table slot, picks a draw mode and emits it, restoring the saved cells; the tail bumps one counter. Effect
// is memory only, so each arm compares RAM (dumpState minus stack scratch below the entry SP). $bd09 can read POKEY random on
// some states, so both arms run on clones of one seeded base (poly-frozen); CAPTURE clones each real
// dispatch. Caller: the module omits the ROM ret, seam completes it.
// Run: node --test games/tempest/idiomatic/test/equivalence-c54d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c54d } from "../../translated/loc_c54d.js";
import { drawTimedObjectList } from "../drawTimedObjectList.js";
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

const TARGET = 0xc54d;
const oracle = atEntry(loc_c54d);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xc54d dispatches -- drawTimedObjectList == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawTimedObjectList(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Guard set, two nonzero slots, $9f>=5 (index-derived mode), cursor into vector RAM, tail-increment armed.
function seed(m) {
  m.mem.write8(0x0115, 0x01);
  m.mem.write8(0x9f, 0x06);
  m.mem.write8(0x74, 0x00);
  m.mem.write8(0x75, 0x20);
  m.mem.write8(0x03fe + 2, 0x11); // nonzero slot 2
  m.mem.write8(0x03fe + 5, 0x22); // nonzero slot 5
  m.mem.write8(0x5f, 0x71); // save-cell sentinels (must be restored)
  m.mem.write8(0x5b, 0x72);
  m.mem.write8(0xa0, 0x73);
  m.mem.write8(0x011f, 0x01); // tail flag
  m.mem.write8(0x42, 0x20);   // >= 0x15
  m.mem.write8(0x40, 0x03);   // counter index
  m.mem.write8(0x0200 + 3, 0x10); // counter seed
}

test("CRAFTED: guarded draw pass -- RAM equal, saved cells restored, tail counter bumped", () => {
  const base = new Machine(ROM, OPTS); seed(base);
  const o = base.clone(), c = base.clone();
  oracle(o); drawTimedObjectList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after pass");
  assert.equal(c.mem.read8(0x5f), 0x71, "$5f restored");
  assert.equal(c.mem.read8(0x5b), 0x72, "$5b restored");
  assert.equal(c.mem.read8(0xa0), 0x73, "$a0 restored");
  assert.equal(c.mem.read8(0x0200 + 3), 0x11, "tail counter incremented");
});

test("TEETH: an empty twin (no forced cells, no emit, no counter bump) diverges from the oracle", () => {
  const base = new Machine(ROM, OPTS); seed(base);
  const o = base.clone(), c = base.clone();
  oracle(o);
  const broken = (_m) => { /* BUG: does none of the guarded work */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped pass");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawTimedObjectList, TARGET, m);
  assert.equal(r.placeable, true, `drawTimedObjectList must be seam-placeable; got: ${r.error}`);
});
