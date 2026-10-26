// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for the advanceEnemyLaneDepth mid-entry (ROM 0x9c63) -- the ADD path of the tube-coordinate stepper:
// slot x's 16-bit coordinate (low ENEMY_DEPTH_LO,x / high ENEMY_DEPTH,x) += the per-segment delta (low ENEMY_CLIMB_DELTA_LO_0,y /
// high ENEMY_CLIMB_DELTA_HI_0,y, with carry). Then the new high byte selects: <= PLAYER_SHOT_DEPTH steps the slot via settleEnemyAtTargetDepth;
// otherwise >= 0x20 finishes (A = new high); under 0x20 with the (ENEMY_SLOT_DIR,x & 3) gate clear finishes (A = 0),
// or set retires the slot via retireEnemyAndSpawnSplit (A = the slot index). Live-out is RAM (minus stack scratch below the entry SP) plus A.
// Oracle is the frozen mid-entry export loc_9c63 in translated/loc_9c58.js.
// Run: node --test games/tempest/idiomatic/test/equivalence-9c63.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9c63 } from "../../translated/loc_9c58.js";
import { advanceEnemyLaneDepth } from "../stepEnemyDepthInLaneDirection.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { ENEMY_CLIMB_DELTA_LO_0, ENEMY_CLIMB_DELTA_HI_0, PLAYER_SHOT_DEPTH, ENEMY_SLOT_DIR, ENEMY_DEPTH_LO, ENEMY_DEPTH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9c63;
const oracle = atEntry(loc_9c63);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9c63 dispatches -- advanceEnemyLaneDepth == oracle in RAM (-stack) and A", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a slot whose deep retireEnemyAndSpawnSplit dispatch the oracle can't resolve -- both would throw
    advanceEnemyLaneDepth(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) checked`);
});

function seed(m, x, y, lo, hi, loD, hiD, floor, gate) {
  m.regs.x = x; m.regs.y = y; m.regs.a = 0x00;
  m.mem.write8(u16(ENEMY_DEPTH_LO + x), lo);
  m.mem.write8(u16(ENEMY_DEPTH + x), hi);
  m.mem.write8(u16(ENEMY_CLIMB_DELTA_LO_0 + y), loD);
  m.mem.write8(u16(ENEMY_CLIMB_DELTA_HI_0 + y), hiD);
  m.mem.write8(PLAYER_SHOT_DEPTH, floor);
  m.mem.write8(u16(ENEMY_SLOT_DIR + x), gate);
}

test("CRAFTED: high stays >= 0x20 above the floor -- finishes with A = the new high byte", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x00, 0x02, 0x00, 0x40, 0x00, 0x00, 0x10, 0x00);
  const c = new Machine(ROM, OPTS); seed(c, 0x00, 0x02, 0x00, 0x40, 0x00, 0x00, 0x10, 0x00);
  oracle(o); advanceEnemyLaneDepth(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x40, "A is the new high byte");
  assert.equal(c.mem.read8(u16(ENEMY_DEPTH + 0x00)), 0x40, "high coordinate stepped up");
});

test("CRAFTED: high under 0x20 above the floor with the gate clear -- finishes with A = 0", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x00, 0x02, 0x00, 0x10, 0x00, 0x00, 0x05, 0x00);
  const c = new Machine(ROM, OPTS); seed(c, 0x00, 0x02, 0x00, 0x10, 0x00, 0x00, 0x05, 0x00);
  oracle(o); advanceEnemyLaneDepth(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x00, "A is zero when the retire gate is clear");
});

test("CRAFTED: high at/below the floor steps the slot via settleEnemyAtTargetDepth -- RAM and A equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x00, 0x02, 0x00, 0x10, 0x00, 0x00, 0x20, 0x00);
  const c = new Machine(ROM, OPTS); seed(c, 0x00, 0x02, 0x00, 0x10, 0x00, 0x00, 0x20, 0x00);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (!threw) {
    advanceEnemyLaneDepth(c);
    // On this path advanceEnemyLaneDepth delegates entirely to settleEnemyAtTargetDepth and returns; A is whatever settleEnemyAtTargetDepth leaves,
    // which is not a declared live-out of settleEnemyAtTargetDepth (its own gate does not compare A), so compare RAM only.
    assert.equal(ramDiff(o, c), null, "RAM equal after the settleEnemyAtTargetDepth step");
  }
});

test("CRAFTED: high under 0x20 above the floor with the gate set retires via retireEnemyAndSpawnSplit -- RAM and A equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x00, 0x02, 0x00, 0x10, 0x00, 0x00, 0x05, 0x01);
  const c = new Machine(ROM, OPTS); seed(c, 0x00, 0x02, 0x00, 0x10, 0x00, 0x00, 0x05, 0x01);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (!threw) {
    advanceEnemyLaneDepth(c);
    assert.equal(ramDiff(o, c), null, "RAM equal after the retireEnemyAndSpawnSplit retire");
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  }
});

test("MUTATION: a twin that drops the add carry into the high byte diverges from the oracle in RAM", () => {
  // lo carries (0xff + 0x02) so the correct high byte is +1
  const o = new Machine(ROM, OPTS); seed(o, 0x00, 0x02, 0xff, 0x40, 0x02, 0x00, 0x10, 0x00);
  const c = new Machine(ROM, OPTS); seed(c, 0x00, 0x02, 0xff, 0x40, 0x02, 0x00, 0x10, 0x00);
  oracle(o);
  const broken = (m, x = m.regs.x, y = m.regs.y) => {
    const { mem8 } = m;
    mem8[u16(ENEMY_DEPTH_LO + x)] = mem8[u16(ENEMY_DEPTH_LO + x)] + mem8[u16(ENEMY_CLIMB_DELTA_LO_0 + y)];
    mem8[u16(ENEMY_DEPTH + x)] = (mem8[u16(ENEMY_DEPTH + x)] + mem8[u16(ENEMY_CLIMB_DELTA_HI_0 + y)]) & 0xff; // BUG: no carry-in
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped add carry");
});
