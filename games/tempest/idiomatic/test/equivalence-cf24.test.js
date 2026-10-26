// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for tickHeartbeatCounters -- a dense per-lane update over $0d/$10/$13 driven by the control bits in
// $07/$08/$09, then a position/score accumulation into $16/$17/$18 via a lookup table in ROM, then two clamp
// passes over the $13 lane triple. Fully deterministic (no POKEY / clock reads), so the CRAFTED arm seeds the
// working cells, runs both arms, and compares RAM (dumpState, minus stack scratch below the entry SP). A leaf: the module omits
// the ROM ret and the seam completes it, so the arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-cf24.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_cf24 } from "../../translated/loc_cf24.js";
import { tickHeartbeatCounters } from "../tickHeartbeatCounters.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { LANE_WRAP_POS, LANE_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xcf24;
const oracle = atEntry(loc_cf24);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// A non-default seed that drives all three lanes through the store/decrement path and both clamp passes.
const seed = (m) => {
  const w = (a, v) => m.mem.write8(a, v);
  w(0x06, 0x00); w(0x07, 0x00); w(0x08, 0x00); w(0x09, 0x00); w(0x0c, 0x05);
  w(0x0d, 0x05); w(0x0e, 0x05); w(0x0f, 0x05);
  w(0x10, 0x02); w(0x11, 0x02); w(0x12, 0x02);
  w(0x13, 0x20); w(0x14, 0x20); w(0x15, 0x20);
  w(0x16, 0x40); w(0x17, 0x00); w(0x18, 0x00);
};

test("CAPTURE: real 0xcf24 dispatches -- tickHeartbeatCounters == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); tickHeartbeatCounters(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: a seeded lane update + accumulation + clamp passes matches the oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); tickHeartbeatCounters(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  // spot-check two cells the seed drives deterministically
  assert.equal(c.mem.read8(LANE_COUNTER), 0x10, "$0013 lane clamped down by 0x10");
  assert.equal(c.mem.read8(LANE_WRAP_POS), 0x00, "$000d lane zeroed by the flash-decrement path");
});

test("TEETH: the seeded run actually mutates RAM, so the diff has teeth (untouched != oracle)", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const untouched = new Machine(ROM, OPTS); seed(untouched);
  oracle(o);
  assert.notEqual(ramDiff(o, untouched), null, "the routine left RAM unchanged -- the seed does not bite");
  // and the idiomatic reproduces exactly that mutation
  const c = new Machine(ROM, OPTS); seed(c);
  tickHeartbeatCounters(c);
  assert.equal(ramDiff(o, c), null, "idiomatic must reproduce the oracle's mutation");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, tickHeartbeatCounters, TARGET, m);
  assert.equal(r.placeable, true, `tickHeartbeatCounters must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
