// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceMovingSpike -- per-frame step of the moving spike: guard, optional start sound,
// 16-bit height advance with ceiling park + end sound, a table rebuild, a second accumulator step, a
// delta rederive, and a slot-row collision scan. The idiomatic side dissolves every jsr into direct
// idiomatic calls (ccee/ccf2/cd06 take their X/Y from the seated registers, a347 by explicit args).
// Live-out is memory only, so each arm compares RAM (dumpState minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-97f8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_97f8 } from "../../translated/loc_97f8.js";
import { advanceMovingSpike } from "../advanceMovingSpike.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  GAME_MODE, STATUS_FLAGS, DEPTH_ACCUM_LO, DEPTH_HI, loc_9f, SPIKE_STEP_LO, SPIKE_STEP_HI, SPIKE_ACTIVE_FLAG,
  SPIKE_HEIGHT_LO, SPIKE_TABLE_GUARD, PLAYER_SEGMENT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH, LANE_LIMIT,
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

const TARGET = 0x97f8;
const oracle = atEntry(loc_97f8);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 6000) : [];

test("CAPTURE: real 0x97f8 dispatches -- advanceMovingSpike == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); advanceMovingSpike(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Pass both guards, hit the start-sound trigger height, advance within range, skip the rebuild, then
// land a collision: slot X = $0200 holds a nonzero value below the current height.
function seedStep(m) {
  m.mem.write8(PLAYER_FINE_ANGLE, 0x00); // primary flag low (bit7 = 0) -> continue
  m.mem.write8(SPIKE_ACTIVE_FLAG, 0x80); // arm flag negative (bit7 = 1) -> continue
  m.mem.write8(STATUS_FLAGS, 0x80);   // sound enable high -> registration path runs
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x10); // trigger height -> start sound; stays < 0x50 after advance
  m.mem.write8(SPIKE_HEIGHT_LO, 0x00);
  m.mem.write8(SPIKE_STEP_LO, 0x10); // per-frame delta low
  m.mem.write8(SPIKE_STEP_HI, 0x00); // per-frame delta high
  m.mem.write8(DEPTH_ACCUM_LO, 0x00);
  m.mem.write8(DEPTH_HI, 0x00);
  m.mem.write8(loc_9f, 0x04); // source for the rederived delta -> 0x10 << 2 == 0x40 clamp path
  m.mem.write8(SPIKE_TABLE_GUARD, 0x00);
  m.mem.write8(PLAYER_SEGMENT, 0x05); // target slot index
  for (let i = 0; i <= 0x0f; i++) m.mem.write8((LANE_LIMIT + i) & 0xffff, 0x00);
  m.mem.write8((LANE_LIMIT + 0x05) & 0xffff, 0x08); // slot 5 value below height -> collision
}

test("CRAFTED: full step -- height advance, delta rederive, and collision match the oracle", () => {
  const o = new Machine(ROM, OPTS); seedStep(o);
  const c = new Machine(ROM, OPTS); seedStep(c);
  oracle(o); advanceMovingSpike(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the step");
  assert.equal(c.mem.read8(SPIKE_HEIGHT_LO), 0x10, "height low advanced");
  assert.equal(c.mem.read8(SPIKE_STEP_LO), 0x40, "per-frame delta rederived");
  assert.equal(c.mem.read8(SPIKE_TABLE_GUARD), 0x00, "rebuild flag cleared on collision");
});

test("TEETH: a twin that passes the guards but skips the advance diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedStep(o);
  const c = new Machine(ROM, OPTS); seedStep(c);
  oracle(o);
  const broken97f8 = (m) => { m.mem8[GAME_MODE] = 0x00; /* BUG: never advances height, delta, or collision */ };
  broken97f8(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped step");
});

test("TEETH-GUARD: primary flag high -- oracle and idiomatic both early-out identically", () => {
  const seed = (m) => { m.mem.write8(PLAYER_FINE_ANGLE, 0x80); m.mem.write8(SPIKE_ACTIVE_FLAG, 0x80); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); advanceMovingSpike(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the guarded early-out");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedStep(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, advanceMovingSpike, TARGET, m);
  assert.equal(r.placeable, true, `advanceMovingSpike must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller (moved 0) placeable");
});
