// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceCoordListByEntryStride (ROM 0x96cb) -- a vector-list coordinate walker ($969d dispatch target).
// Reads (0x2c),Y and (0x2c),Y-1, stores their delta at loc_29, advances Y by delta+2. Live-out is one RAM
// cell (loc_29) plus Y and A, so the arms compare RAM (-stack) + Y + A. A leaf: it omits the ROM ret and
// the seam completes it. No POKEY/clock read, so the CRAFTED diff is deterministic. Both sides run in binary
// mode (fresh Machine D-clear), where sec;sbc = cur-prev and sec;adc = Y-1+delta+1 exactly.
// Run: node --test games/tempest/idiomatic/test/equivalence-96cb.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_96cb } from "../../translated/loc_96cb.js";
import { advanceCoordListByEntryStride } from "../advanceCoordListByEntryStride.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (f) => (existsSync(new URL(f, ROM_DIR)) ? new Uint8Array(readFileSync(new URL(f, ROM_DIR))) : null);
const ROM = rd("maincpu.bin");
const opt = (f) => rd(f);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const ROM_PRESENT = ROM !== null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x96cb;
const oracle = atEntry(loc_96cb);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x96cb dispatches -- advanceCoordListByEntryStride == oracle in RAM (-stack), A and Y", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); advanceCoordListByEntryStride(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
    assert.equal(c.regs.y, o.regs.y, "Y live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: (ptr),Y minus (ptr),Y-1 -> delta at loc_29, Y advanced by delta+2", () => {
  const cases = [
    { tag: "cur>prev", ptr: 0x0500, y: 0x10, cur: 0x20, prev: 0x05 },
    { tag: "cur<prev wraps", ptr: 0x0480, y: 0x08, cur: 0x02, prev: 0x40 },
    { tag: "cur==prev delta 0", ptr: 0x0600, y: 0x04, cur: 0x33, prev: 0x33 },
  ];
  for (const { tag, ptr, y, cur, prev } of cases) {
    const seed = (mm) => {
      mm.mem.write8(COORD_LIST_PTR_LO, ptr & 0xff); mm.mem.write8(COORD_LIST_PTR_HI, (ptr >> 8) & 0xff);
      mm.mem.write8((ptr + y) & 0xffff, cur);
      mm.mem.write8((ptr + y - 1) & 0xffff, prev);
      mm.regs.y = y;
    };
    const o = new Machine(ROM, OPTS); seed(o);
    const c = new Machine(ROM, OPTS); seed(c);
    oracle(o); const ret = advanceCoordListByEntryStride(c);
    assert.equal(ramDiff(o, c), null, `RAM (loc_29 delta): ${tag}`);
    assert.equal(c.regs.y, o.regs.y, `Y advanced matches oracle: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A (pre-inc cursor) matches oracle: ${tag}`);
    assert.deepEqual(ret, [o.regs.a, o.regs.y], `return == [A,Y]: ${tag}`);
  }
});

test("TEETH: a twin that skips the delta write to loc_29 is caught by the RAM diff", () => {
  const ptr = 0x0500, y = 0x10, cur = 0x20, prev = 0x05; // non-default seed -> delta 0x1b (non-zero)
  const o = new Machine(ROM, OPTS);
  o.mem.write8(COORD_LIST_PTR_LO, ptr & 0xff); o.mem.write8(COORD_LIST_PTR_HI, (ptr >> 8) & 0xff);
  o.mem.write8(ptr + y, cur); o.mem.write8(ptr + y - 1, prev); o.regs.y = y;
  oracle(o);
  assert.notEqual(o.mem.read8(loc_29), 0x00, "precondition: oracle wrote a non-zero delta at loc_29");
  const brokenDelta = 0x00; // BUG: never wrote loc_29
  assert.notEqual(brokenDelta, o.mem.read8(loc_29), "the RAM diff FAILED to catch a skipped loc_29 write");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.mem.write8(COORD_LIST_PTR_LO, 0x00); m.mem.write8(COORD_LIST_PTR_HI, 0x05); m.regs.y = 0x10;
  m.regs.s = 0xff;
  m.push16(0xabcd);
  const r = seamPlaceable(withOmittedRet, advanceCoordListByEntryStride, TARGET, m);
  assert.equal(r.placeable, true, `advanceCoordListByEntryStride must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
