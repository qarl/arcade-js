// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawScoreStatusList -- flags a rebuild, gates on a byte, latches it into two slots and kicks a
// spread build. The idiomatic side dissolves jsr bda0 into a direct call. Live-out is memory only, so each
// arm compares RAM (dumpState minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-b586.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b586 } from "../../translated/loc_b586.js";
import { drawScoreStatusList } from "../drawScoreStatusList.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_9e, PLAYER_SEGMENT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH, loc_2f, RIM_ROT_OFFSET, OBJ_DEPTH, DEPTH_LO, DEPTH_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb586;
const oracle = atEntry(loc_b586);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb586 dispatches -- drawScoreStatusList == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawScoreStatusList(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Gate byte in range and marker not the skip value: latches the gate, then reaches the spread build,
// which itself early-exits (guard clear and counter below reference), keeping the RAM effect bounded.
function seedBuild(m) {
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x40); // gate: nonzero and < 0xf0
  m.mem.write8(PLAYER_FINE_ANGLE, 0x00); // marker: not 0x81
  m.mem.write8(PLAYER_SEGMENT, 0x03); // index
  m.mem.write8(RIM_ROT_OFFSET, 0x08);  // size source
  m.mem.write8(DEPTH_LO, 0x00);  // guard clear
  m.mem.write8(DEPTH_HI, 0x50);  // reference > gate -> callee early-outs
}

test("CRAFTED: in-range gate -- slots latched and RAM matches the oracle", () => {
  const o = new Machine(ROM, OPTS); seedBuild(o);
  const c = new Machine(ROM, OPTS); seedBuild(c);
  oracle(o); drawScoreStatusList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after build");
  assert.equal(c.mem.read8(OBJ_DEPTH), 0x40, "gate latched into $57");
  assert.equal(c.mem.read8(loc_2f), 0x40, "gate latched into $2f");
});

test("TEETH: a twin that skips latching the gate diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedBuild(o);
  const c = new Machine(ROM, OPTS); seedBuild(c);
  oracle(o);
  const brokenB586 = (m) => { m.mem8[loc_9e] = 0x01; /* BUG: never latches $57/$2f, never builds */ };
  brokenB586(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped latch");
});

test("TEETH-OUTRANGE: gate >= 0xf0 -- oracle and idiomatic both early-out identically", () => {
  const seed = (m) => { m.mem.write8(PLAYER_SHOT_DEPTH, 0xf5); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); drawScoreStatusList(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the out-of-range early-out");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedBuild(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawScoreStatusList, TARGET, m);
  assert.equal(r.placeable, true, `drawScoreStatusList must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller (moved 0) placeable");
});
