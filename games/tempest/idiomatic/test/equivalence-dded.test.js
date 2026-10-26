// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for eraseEaromLowRegions -- a trampoline that runs the shared mask-merge with the fixed mask
// 0x03: $01c6 <- 0xff, $01c7 |= 0x03, $01c8 |= 0x03. Live-out is memory only (A/Y at RTS are incidental,
// the merge leaf treats them as dead), so the arms compare RAM (dumpState, minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-dded.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_dded } from "../../translated/loc_dded.js";
import { eraseEaromLowRegions } from "../eraseEaromLowRegions.js";
import { requestEaromBlankWrite } from "../requestEaromBlankWrite.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { EAROM_BLANK_FLAG, EAROM_REGION_PENDING, EAROM_REGION_DIR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdded;
const oracle = atEntry(loc_dded);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xdded dispatches -- eraseEaromLowRegions == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); eraseEaromLowRegions(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: $01c6 <- 0xff, mask 0x03 OR-ed into $01c7/$01c8", () => {
  const seed = (m) => {
    m.regs.s = 0xfb;
    m.mem.write8(EAROM_BLANK_FLAG, 0x11);
    m.mem.write8(EAROM_REGION_PENDING, 0x50);
    m.mem.write8(EAROM_REGION_DIR, 0x88);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); eraseEaromLowRegions(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(EAROM_BLANK_FLAG), 0xff, "$01c6 <- 0xff");
  assert.equal(c.mem.read8(EAROM_REGION_PENDING), 0x50 | 0x03, "$01c7 OR 0x03");
  assert.equal(c.mem.read8(EAROM_REGION_DIR), 0x88 | 0x03, "$01c8 OR 0x03");
});

test("TEETH: a twin that leaves $01c8 untouched (non-default seed) diverges from the oracle", () => {
  const seed = (m) => {
    m.regs.s = 0xfb;
    m.mem.write8(EAROM_BLANK_FLAG, 0x11);
    m.mem.write8(EAROM_REGION_PENDING, 0x50);
    m.mem.write8(EAROM_REGION_DIR, 0x88); // non-default so the skipped OR shows
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const mem = m.mem8;
    mem[EAROM_BLANK_FLAG] = 0xff;
    mem[EAROM_REGION_PENDING] = mem[EAROM_REGION_PENDING] | 0x03; // BUG: never touches $01c8
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped OR");
});

test("TEETH: passing the wrong mask (0x00) diverges from the oracle", () => {
  const seed = (m) => {
    m.regs.s = 0xfb;
    m.mem.write8(EAROM_BLANK_FLAG, 0x11);
    m.mem.write8(EAROM_REGION_PENDING, 0x50);
    m.mem.write8(EAROM_REGION_DIR, 0x88);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  requestEaromBlankWrite(c, 0x00); // BUG: wrong mask leaves $01c7/$01c8 low bits clear
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong mask");
});

test("SP-TOOTH: the omitted-ret trampoline is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, eraseEaromLowRegions, TARGET, m);
  assert.equal(r.placeable, true, `eraseEaromLowRegions must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret trampoline placeable");
});
