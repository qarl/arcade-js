// SPDX-License-Identifier: GPL-3.0-only
// also gates: 0xddfd queueEaromRequestAtIndexZero
// also gates: 0xddff queueEaromRequest
// Memory-equivalence for queueEaromRegionSave -- Y into $01c6, mask A OR-ed into $01c7/$01c8. Entry ddfb presets A=4,Y=0;
// alt-entries ddfd (Y=0) and ddff (shared tail) are exercised directly. The oracle's push/pull is a bare A
// save/restore whose scratch byte lands in the excluded stack window when SP is high. A leaf: the module omits
// the ROM ret and the seam completes it, so the arms compare RAM (-stack).
// Run: node --test games/tempest/idiomatic/test/equivalence-ddfb.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_ddfb, loc_ddfd, loc_ddff } from "../../translated/loc_ddfb.js";
import { queueEaromRegionSave, queueEaromRequestAtIndexZero, queueEaromRequest } from "../queueEaromRegionSave.js";
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

const TARGET = 0xddfb;
const oracle = atEntry(loc_ddfb);
const oracleDdfd = atEntry(loc_ddfd);
const oracleDdff = atEntry(loc_ddff);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xddfb dispatches -- queueEaromRegionSave == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); queueEaromRegionSave(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED ddfb: $01c6 <- 0 and $01c7/$01c8 get 0x04 OR-ed in", () => {
  const seed = (m) => {
    m.regs.s = 0xfb;
    m.mem.write8(EAROM_BLANK_FLAG, 0x11);
    m.mem.write8(EAROM_REGION_PENDING, 0x50);
    m.mem.write8(EAROM_REGION_DIR, 0x88);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); queueEaromRegionSave(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(EAROM_BLANK_FLAG), 0x00, "$01c6 zeroed");
  assert.equal(c.mem.read8(EAROM_REGION_PENDING), 0x50 | 0x04, "$01c7 OR 0x04");
  assert.equal(c.mem.read8(EAROM_REGION_DIR), 0x88 | 0x04, "$01c8 OR 0x04");
});

test("CRAFTED ddfd (alt entry): Y=0 with the live-in mask A OR-ed into $01c7/$01c8", () => {
  const seed = (m) => {
    m.regs.s = 0xfb; m.regs.a = 0x44;
    m.mem.write8(EAROM_BLANK_FLAG, 0x11);
    m.mem.write8(EAROM_REGION_PENDING, 0x50);
    m.mem.write8(EAROM_REGION_DIR, 0x88);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracleDdfd(o); queueEaromRequestAtIndexZero(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(EAROM_BLANK_FLAG), 0x00, "$01c6 zeroed");
  assert.equal(c.mem.read8(EAROM_REGION_PENDING), 0x50 | 0x44, "$01c7 OR 0x44");
  assert.equal(c.mem.read8(EAROM_REGION_DIR), 0x88 | 0x44, "$01c8 OR 0x44");
});

test("CRAFTED ddff (alt entry): live-in Y into $01c6, live-in mask A OR-ed into $01c7/$01c8", () => {
  const seed = (m) => {
    m.regs.s = 0xfb; m.regs.a = 0x22; m.regs.y = 0x33;
    m.mem.write8(EAROM_BLANK_FLAG, 0x11);
    m.mem.write8(EAROM_REGION_PENDING, 0x50);
    m.mem.write8(EAROM_REGION_DIR, 0x88);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracleDdff(o); queueEaromRequest(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(EAROM_BLANK_FLAG), 0x33, "$01c6 <- Y");
  assert.equal(c.mem.read8(EAROM_REGION_PENDING), 0x50 | 0x22, "$01c7 OR 0x22");
  assert.equal(c.mem.read8(EAROM_REGION_DIR), 0x88 | 0x22, "$01c8 OR 0x22");
});

test("TEETH: a twin that leaves $01c8 untouched diverges from the oracle", () => {
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
    mem[EAROM_BLANK_FLAG] = 0x00;
    mem[EAROM_REGION_PENDING] = (mem[EAROM_REGION_PENDING] | 0x04) & 0xff; // BUG: never touches $01c8
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped OR");
});

test("SP-TOOTH: the omitted-ret leaf is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, queueEaromRegionSave, TARGET, m);
  assert.equal(r.placeable, true, `queueEaromRegionSave must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf placeable");
});
