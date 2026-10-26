// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for projectPointThroughMathbox -- computes clamped signed X/Y deltas, drives the math coprocessor twice
// (writing inputs, waiting on the status register, reading the result pair), and folds paired offsets into
// two 16-bit accumulators with saturating limits. Live-out is memory only (A/X at RTS are incidental), so
// each side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). The coprocessor is
// instantaneous and deterministic, so identical writes yield identical reads on both arms. A leaf: the module
// omits the ROM ret and the seam completes it, so the arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-c098.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c098 } from "../../translated/loc_c098.js";
import { projectPointThroughMathbox } from "../projectPointThroughMathbox.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  loc_32, MATHBOX_SIGN_X, MATHBOX_SIGN_Y, PROJ_PT_Y, OBJ_DEPTH, PROJ_PT_X, DEPTH_LO, PROJ_Y_REF, DEPTH_HI, PROJ_X_REF,
  PROJ_OFS_Y_LO, PROJ_OFS_Y_HI, PROJ_OFS_X_LO, PROJ_OFS_X_HI,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc098;
const oracle = atEntry(loc_c098);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// Non-default deltas: |dx|=0x30 (sign 0x00), |dy|=0x20 (sign 0xff), positive 16-bit delta (no clamp).
const seed = (m) => {
  m.mem.write8(OBJ_DEPTH, 0x40); m.mem.write8(DEPTH_HI, 0x10); m.mem.write8(DEPTH_LO, 0x00);
  m.mem.write8(PROJ_PT_X, 0x50); m.mem.write8(PROJ_X_REF, 0x20);
  m.mem.write8(PROJ_PT_Y, 0x10); m.mem.write8(PROJ_Y_REF, 0x30);
  m.mem.write8(PROJ_OFS_Y_LO, 0x03); m.mem.write8(PROJ_OFS_Y_HI, 0x00);
  m.mem.write8(PROJ_OFS_X_LO, 0x05); m.mem.write8(PROJ_OFS_X_HI, 0x00);
};

test("CAPTURE: real 0xc098 dispatches -- projectPointThroughMathbox == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); projectPointThroughMathbox(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: deltas + signs land, coprocessor-fed RAM matches the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); projectPointThroughMathbox(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  // deterministic (non-coprocessor) results
  assert.equal(c.mem.read8(loc_32), 0x20, "|dy| stored");
  assert.equal(c.mem.read8(MATHBOX_SIGN_X), 0x00, "dx sign stored");
  assert.equal(c.mem.read8(MATHBOX_SIGN_Y), 0xff, "dy sign stored");
});

test("TEETH: a twin whose delta store is corrupted diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); projectPointThroughMathbox(c);
  c.mem.write8(loc_32, (c.mem.read8(loc_32) ^ 0xff) & 0xff); // BUG: |dy| corrupted
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the corrupted store");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seed(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, projectPointThroughMathbox, TARGET, m);
  assert.equal(r.placeable, true, `projectPointThroughMathbox must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
