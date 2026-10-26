// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for paintRimLanes (ROM 0xb367-0xb475) -- rebuilds the 16-entry flag block $0425.. from the
// enemy tables, then walks two 16-entry passes writing per-column state through the ($3b) list and OR-ing
// color bits into the ($b0) list. The idiomatic side dissolves the four jsr (seatDrawCursor/c30d/b2fe/b2de) into
// direct calls. Live-out is memory only (ends rts, registers incidental), so the arms compare RAM
// (dumpState -stack). Real base states seed the crafted/teeth arms so the list pointers are valid.
// Run: node --test games/tempest/idiomatic/test/equivalence-b367.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b367 } from "../../translated/loc_b367.js";
import { paintRimLanes } from "../paintRimLanes.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { LANE_FLAGS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb367;
const oracle = atEntry(loc_b367);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xb367 dispatches -- paintRimLanes == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); paintRimLanes(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: a dirtied flag block is rebuilt identically to the oracle", () => {
  if (!CAPS.length) { console.log("  CRAFTED: no dispatch captured -- skipped"); return; }
  const o = CAPS[0].clone(), c = CAPS[0].clone();
  for (let i = 0; i < 16; i++) { o.mem.write8(u16(LANE_FLAGS + i), 0xa0 + i); c.mem.write8(u16(LANE_FLAGS + i), 0xa0 + i); }
  oracle(o); paintRimLanes(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the rebuild");
  for (let i = 0; i < 16; i++) assert.equal(c.mem.read8(u16(LANE_FLAGS + i)), o.mem.read8(u16(LANE_FLAGS + i)), `flag ${i} matches oracle`);
});

test("TEETH: a twin that leaves the dirtied flag block untouched diverges from the oracle", () => {
  if (!CAPS.length) { console.log("  TEETH: no dispatch captured -- skipped"); return; }
  const o = CAPS[0].clone(), c = CAPS[0].clone();
  for (let i = 0; i < 16; i++) { o.mem.write8(u16(LANE_FLAGS + i), 0xa0 + i); c.mem.write8(u16(LANE_FLAGS + i), 0xa0 + i); }
  oracle(o);
  const brokenB367 = (_m) => { /* BUG: never clears or rebuilds the flag block */ };
  brokenB367(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped rebuild");
});

test("SP-TOOTH: the omitted-ret routine (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, paintRimLanes, TARGET, m);
  assert.equal(r.placeable, true, `paintRimLanes must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret routine (moved 0) placeable");
});
