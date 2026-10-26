// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildTubeLaneCoords (ROM 0xc235-0xc2e7) -- level-geometry setup. Dissolves jsr $c2e8 into a
// direct idiomatic call (passing $46,x explicitly, consuming its returned A as the seed index); the oracle
// runs the TRANSLATED resolveShapeTableIndex via m.call. Live-out is memory only (final A/X/Y are incidental), so each
// side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). resolveShapeTableIndex reads POKEY
// random ($60ca) only when its input >= 0x62; the crafted seeds stay below that, and CAPTURE compares on
// identical clones (poly-frozen), so both arms read the same byte. A caller: the module omits the ROM ret.
// Run: node --test games/tempest/idiomatic/test/equivalence-c235.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c235 } from "../../translated/loc_c235.js";
import { buildTubeLaneCoords } from "../buildTubeLaneCoords.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  GAME_MODE_PENDING, loc_3d, PLAYER_LEVEL_TBL, DEPTH_LO, PROJ_OFS_Y_LO, PROJ_OFS_Y_HI,
  PROJ_OFS_X_LO, PROJ_OFS_X_HI, loc_10f, loc_110, loc_113, SEG_MID_X,
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

const TARGET = 0xc235;
const oracle = atEntry(loc_c235);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xc235 dispatches -- buildTubeLaneCoords == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); buildTubeLaneCoords(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Difference branch: $02 != 0x1e drives the 16-bit subtract + 4-step shift into $0121.
const seedDiff = (m) => {
  m.mem.write8(loc_3d, 0x00);
  m.mem.write8(PLAYER_LEVEL_TBL, 0x30); // c2e8 input (< 0x62 -> deterministic, no random)
  m.mem.write8(GAME_MODE_PENDING, 0x00);
  m.mem.write8(PROJ_OFS_X_LO, 0x20);
  m.mem.write8(PROJ_OFS_X_HI, 0x10);
};

test("CRAFTED-DIFF: $02!=0x1e path -- constant cells set, RAM matches the oracle", () => {
  const o = new Machine(ROM, OPTS); seedDiff(o);
  const c = new Machine(ROM, OPTS); seedDiff(c);
  oracle(o); buildTubeLaneCoords(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(loc_113), 0x2c, "$0113 = 0x2c");
  assert.equal(c.mem.read8(DEPTH_LO), 0xff, "$5b = 0xff");
  assert.equal(c.mem.read8(PROJ_OFS_Y_LO), 0x00, "$66 cleared");
  assert.equal(c.mem.read8(PROJ_OFS_Y_HI), 0x00, "$67 cleared");
  assert.equal(c.mem.read8(loc_10f), 0x00, "$010f cleared");
  assert.equal(c.mem.read8(loc_110), 0x00, "$0110 cleared");
});

test("CRAFTED-COPY: $02==0x1e path -- offset pair copied, RAM matches the oracle", () => {
  const seedCopy = (m) => { seedDiff(m); m.mem.write8(GAME_MODE_PENDING, 0x1e); };
  const o = new Machine(ROM, OPTS); seedCopy(o);
  const c = new Machine(ROM, OPTS); seedCopy(c);
  oracle(o); buildTubeLaneCoords(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.mem.read8(PROJ_OFS_X_LO), o.mem.read8(PROJ_OFS_X_LO), "$68 copied identically");
  assert.equal(c.mem.read8(PROJ_OFS_X_HI), o.mem.read8(PROJ_OFS_X_HI), "$69 copied identically");
});

test("TEETH: a twin whose $0435[0] average is corrupted diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedDiff(o);
  const c = new Machine(ROM, OPTS); seedDiff(c);
  oracle(o); buildTubeLaneCoords(c);
  c.mem.write8(SEG_MID_X, (c.mem.read8(SEG_MID_X) ^ 0xff) & 0xff); // BUG: averaged output corrupted
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the corrupted store");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedDiff(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, buildTubeLaneCoords, TARGET, m);
  assert.equal(r.placeable, true, `buildTubeLaneCoords must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller (moved 0) placeable");
});
