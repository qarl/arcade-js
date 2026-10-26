// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for the seatCoordListPointerAtIndex3 mid-entry (ROM 0x9ab7) -- it presets the index to 3 and runs the
// shared pointer-pair setup (0x9b02[3]->$2c, 0x9afd[3]->$2d, 3->$2b, A<-$29). Neither the incoming A nor
// Y is read (the entry sets its own index), so live-out is RAM (dumpState minus stack scratch below the entry SP) plus A.
// The oracle is the frozen mid-entry export loc_9ab7 in translated/loc_9a9d.js.
// Run: node --test games/tempest/idiomatic/test/equivalence-9ab7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9ab7 } from "../../translated/loc_9a9d.js";
import { seatCoordListPointerAtIndex3 } from "../seatDemoCoordListPointer.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { loc_29, loc_2b, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI, LIST_PTR_TABLE_HI, LIST_PTR_TABLE_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9ab7;
const oracle = atEntry(loc_9ab7);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9ab7 dispatches -- seatCoordListPointerAtIndex3 == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); seatCoordListPointerAtIndex3(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, a29) {
  m.regs.a = 0x00; m.regs.y = 0x77; // incoming A/Y are dead -- the entry sets its own index
  m.mem.write8(loc_29, a29);
  m.mem.write8(COORD_LIST_PTR_LO, 0xa1); m.mem.write8(loc_2b, 0xa2); m.mem.write8(COORD_LIST_PTR_HI, 0xa3); // dirty sentinels
}

test("CRAFTED: index-3 pointer-pair seated and A reloaded -- RAM and A equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x42);
  const c = new Machine(ROM, OPTS); seed(c, 0x42);
  oracle(o); seatCoordListPointerAtIndex3(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after setup");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8(loc_2b), 0x03, "$2b holds the index");
  assert.equal(c.mem.read8(COORD_LIST_PTR_LO), o.mem.read8(COORD_LIST_PTR_LO), "$2c low pointer matches oracle");
  assert.equal(c.mem.read8(COORD_LIST_PTR_HI), o.mem.read8(COORD_LIST_PTR_HI), "$2d high pointer matches oracle");
  assert.equal(c.regs.a, 0x42, "A reloaded from $29");
});

test("MUTATION: a twin that skips the index stash diverges from the oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x42);
  const c = new Machine(ROM, OPTS); seed(c, 0x42);
  oracle(o);
  const broken = (m) => {
    const { mem8 } = m;
    mem8[COORD_LIST_PTR_LO] = mem8[u16(LIST_PTR_TABLE_LO + 0x03)];
    mem8[COORD_LIST_PTR_HI] = mem8[u16(LIST_PTR_TABLE_HI + 0x03)];
    // BUG: never stashes the index, so the $2b sentinel survives
    m.regs.a = mem8[loc_29];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped index stash");
});
