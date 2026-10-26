// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seatDemoCoordListPointer (ROM 0x9a9d-0x9aba) -- from its entry it seeds the pointer-pair cells
// ($2c from a fixed table byte, $2b=0, $2d from the held source cell) and reloads A from $29. The dead
// mid-block (never reached from this entry) is not modelled. Live-outs are RAM plus A, so each arm compares
// RAM (dumpState minus stack scratch below the entry SP) and A (o.regs.a vs c.regs.a).
// Run: node --test games/tempest/idiomatic/test/equivalence-9a9d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9a9d } from "../../translated/loc_9a9d.js";
import { seatDemoCoordListPointer } from "../seatDemoCoordListPointer.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, loc_2b, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI, LIST_PTR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9a9d;
const oracle = atEntry(loc_9a9d);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9a9d dispatches -- seatDemoCoordListPointer == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); seatDemoCoordListPointer(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m) {
  m.mem.write8(LIST_PTR_HI, 0x6e); // source byte -> $2d
  m.mem.write8(loc_29, 0x42);  // holding cell -> A
  m.mem.write8(COORD_LIST_PTR_LO, 0xa1); m.mem.write8(loc_2b, 0xa2); m.mem.write8(COORD_LIST_PTR_HI, 0xa3); // dirty sentinels
}

test("CRAFTED: pointer-pair cells seeded and A reloaded -- RAM and A equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); seatDemoCoordListPointer(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after setup");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8(loc_2b), 0x00, "$2b index cleared");
  assert.equal(c.mem.read8(COORD_LIST_PTR_HI), 0x6e, "$2d holds the source byte");
  assert.equal(c.regs.a, 0x42, "A reloaded from $29");
});

test("TEETH: a twin that skips the $2d store diverges from the oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const { mem8 } = m;
    mem8[COORD_LIST_PTR_LO] = mem8[0x9b02];
    mem8[loc_2b] = 0x00;
    // BUG: never writes $2d from the source cell
    m.regs.a = mem8[loc_29];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped $2d store");
});

test("TEETH (register): a twin that leaves A untouched diverges from the oracle in A", () => {
  const o = new Machine(ROM, OPTS); seed(o); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c);
  c.regs.a = 0x00;
  const broken = (m) => {
    const { mem8 } = m;
    mem8[COORD_LIST_PTR_LO] = mem8[0x9b02];
    mem8[loc_2b] = 0x00;
    mem8[COORD_LIST_PTR_HI] = mem8[LIST_PTR_HI];
    // BUG: never reloads A from $29
  };
  broken(c);
  assert.notEqual(c.regs.a, o.regs.a, "A diff FAILED to catch the skipped reload");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, seatDemoCoordListPointer, TARGET, m);
  assert.equal(r.placeable, true, `seatDemoCoordListPointer must be seam-placeable; got: ${r.error}`);
});
