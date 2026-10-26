// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for setupEnemyCoordList (ROM 0x9b07-0x9b1d) -- sets up a coordinate list for the packed index in
// loc_2b, saving/restoring the caller's index in SAVED_INDEX2 around the call. When loc_29 >= 0x20 the index is
// dispatched through the dispatchCoordListSetup list-setup selector; otherwise seatCoordListPointer seats the pointer pair directly.
// The caller's index (entry Y) is preserved across the call, so live-out is RAM (dumpState minus
// stack scratch below the entry SP) PLUS Y (and A, which the setup callee reloads). Oracle is the frozen translated setupEnemyCoordList.
// Run: node --test games/tempest/idiomatic/test/equivalence-9b07.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9b07 } from "../../translated/loc_9b07.js";
import { setupEnemyCoordList } from "../setupEnemyCoordList.js";
import { seatCoordListPointer } from "../seatCoordListPointer.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, loc_2b, SAVED_INDEX2 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9b07;
const oracle = atEntry(loc_9b07);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9b07 dispatches -- setupEnemyCoordList == oracle in RAM (-stack), Y and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); setupEnemyCoordList(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.y, o.regs.y, "Y live-out matches");
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed the branch selector loc_29, the packed index loc_2b, and a distinct entry Y so the save/restore is
// observable. The index is kept to a registered list-setup entry (0/2) so the oracle's dispatch resolves.
function seed(m, a29, idx, y) {
  m.regs.y = y; m.regs.a = 0x00;
  m.mem.write8(loc_29, a29);
  m.mem.write8(loc_2b, idx);
}

test("CRAFTED: high count dispatches through the selector -- RAM, Y and A equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x30, 0x00, 0x55); // loc_29>=0x20 -> dispatchCoordListSetup(idx=0 -> seatDemoCoordListPointer)
  const c = new Machine(ROM, OPTS); seed(c, 0x30, 0x00, 0x55);
  oracle(o); setupEnemyCoordList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the selector path");
  assert.equal(c.regs.y, o.regs.y, "Y restored to the entry index");
  assert.equal(c.regs.y, 0x55, "Y is the saved entry index, not the packed index");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
});

test("CRAFTED: low count seats the pointer pair directly -- RAM, Y and A equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x05, 0x02, 0x55); // loc_29<0x20 -> seatCoordListPointer(idx=2)
  const c = new Machine(ROM, OPTS); seed(c, 0x05, 0x02, 0x55);
  oracle(o); setupEnemyCoordList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the direct-setup path");
  assert.equal(c.regs.y, o.regs.y, "Y restored to the entry index");
  assert.equal(c.mem.read8(loc_2b), 0x02, "the packed index was seated as the list index by seatCoordListPointer");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
});

test("TEETH: a twin that skips the Y restore is RAM-clean but diverges in the Y live-out", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x05, 0x02, 0x55);
  const c = new Machine(ROM, OPTS); seed(c, 0x05, 0x02, 0x55);
  oracle(o);
  const broken = (m, y = m.regs.y) => {
    const { mem8 } = m;
    mem8[SAVED_INDEX2] = y;
    const idx = mem8[loc_2b];
    seatCoordListPointer(m, idx);
    m.regs.y = idx; // BUG: leaves Y as the packed index instead of restoring the saved entry index
  };
  broken(c);
  assert.equal(ramDiff(o, c), null, "the twin still matches in RAM (the defect is Y-only)");
  assert.notEqual(c.regs.y, o.regs.y, "the Y live-out comparison FAILED to catch the skipped restore");
});
