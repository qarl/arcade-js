// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for autoAdvanceRimRotation -- folds the sign-extended scroll delta into the long accumulator,
// steps the 16-bit position by a fixed stride, flags saturation, and on a zero high-difference rebuilds
// the position seeds, then tail-delegates jmp 0x9749 (dissolved into the idiomatic rotateBlasterAroundRim, X/Y threaded).
// Live-out is RAM plus the rotation's exit [X, Y], which it returns, so each arm compares RAM (dumpState minus
// STACK_SCRATCH) and the CAPTURE arm also the returned pair. The routine seats
// state then tail-calls, so it is an omitted-ret dispatch (SP-tooth). $0201 bit7 is seeded to steer the
// delegated spinner update to its deterministic early-out.
// Run: node --test games/tempest/idiomatic/test/equivalence-904b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_904b as oracle } from "../../translated/loc_904b.js";
import { autoAdvanceRimRotation } from "../autoAdvanceRimRotation.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PLAYER_FINE_ANGLE, LEVEL_GEOM_SCALE, DEPTH_HI, DEPTH_LO, DEPTH_TARGET, STATUS_FLAGS, loc_3d, GAME_MODE, SPIKE_TABLE_GUARD, PLAYER_SHOT_DEPTH, loc_102 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x904b;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x904b dispatches -- autoAdvanceRimRotation == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { const ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry Y goes in as the argument; the routine takes no entry X
      assert.deepEqual(autoAdvanceRimRotation(c, ey), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: zero high-diff rebuilds the position seeds ($5b=0 path)", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x80);   // steer the delegated spinner update to its early-out
    m.mem.write8(LEVEL_GEOM_SCALE, 0x90);   // negative raw delta -> sign-extend
    m.mem.write8(DEPTH_HI, 0x00);
    m.mem.write8(DEPTH_LO, 0x00);    // stays 0 after the stride add -> zero high-diff
    m.mem.write8(DEPTH_TARGET, 0x44);
    m.mem.write8(STATUS_FLAGS, 0x80);     // bit7 set -> seed = 0x04
    m.mem.write8(loc_3d, 0x03);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); autoAdvanceRimRotation(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the rebuild path");
  assert.equal(c.mem.read8(DEPTH_HI), 0x44, "$5f reseeded from the target");
  assert.equal(c.mem.read8(DEPTH_LO), 0xff, "$5b reseeded to 0xff");
  assert.equal(c.mem.read8(GAME_MODE), 0x04, "seed byte = 0x04 when $05 bit7 set");
  assert.equal(c.mem.read8(PLAYER_SHOT_DEPTH), 0x10, "$0202 primed");
});

test("CRAFTED: nonzero high-diff skips the rebuild", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x80);
    m.mem.write8(LEVEL_GEOM_SCALE, 0x10);   // positive raw delta
    m.mem.write8(DEPTH_HI, 0x00);
    m.mem.write8(DEPTH_LO, 0x10);    // nonzero high byte -> nonzero high-diff
    m.mem.write8(DEPTH_TARGET, 0x00);
    m.mem.write8(STATUS_FLAGS, 0x00);
    m.mem.write8(loc_3d, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); autoAdvanceRimRotation(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the skip path");
  assert.equal(c.mem.read8(DEPTH_LO), 0x10, "$5b unchanged (rebuild skipped)");
});

test("CRAFTED: high byte >= 0xfc sets the saturation flag", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x80);
    m.mem.write8(LEVEL_GEOM_SCALE, 0x00);
    m.mem.write8(DEPTH_HI, 0xf0);
    m.mem.write8(DEPTH_LO, 0xfc);    // >= 0xfc -> flag
    m.mem.write8(DEPTH_TARGET, 0x00);
    m.mem.write8(0x0115, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); autoAdvanceRimRotation(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the saturation path");
  assert.equal(c.mem.read8(SPIKE_TABLE_GUARD), 0x01, "$0115 flagged");
});

test("TEETH: a twin that skips the sign-extend diverges from the oracle", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x80);
    m.mem.write8(LEVEL_GEOM_SCALE, 0x90);   // negative -> sign-extend matters
    m.mem.write8(DEPTH_HI, 0x00);
    m.mem.write8(DEPTH_LO, 0x10);
    m.mem.write8(DEPTH_TARGET, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  // BUG: treats the raw delta as always non-negative (no sign-extend into the high work byte).
  const broken = (m) => {
    const mem8 = m.mem8;
    mem8[PLAYER_SHOT_DEPTH] = 0x10;
    mem8[0x29] = 0x00; mem8[0x2b] = 0x00; mem8[0x2a] = mem8[LEVEL_GEOM_SCALE];
    for (let i = 0; i < 2; i++) {
      const hi = mem8[0x2a];
      mem8[0x2a] = (hi >> 1) | (hi & 0x80);
      mem8[0x29] = (mem8[0x29] >> 1) | ((hi & 1) << 7);
    }
    let s = mem8[0x29] + mem8[0x0122]; mem8[0x0122] = s & 0xff;
    s = mem8[0x2a] + mem8[0x68] + (s >> 8); mem8[0x68] = s & 0xff;
    s = mem8[0x2b] + mem8[0x69] + (s >> 8); mem8[0x69] = s & 0xff;
    let p = mem8[DEPTH_HI] + 0x18; mem8[DEPTH_HI] = p & 0xff;
    p = mem8[DEPTH_LO] + (p >> 8); mem8[DEPTH_LO] = p & 0xff;
    if (mem8[DEPTH_LO] >= 0xfc) mem8[SPIKE_TABLE_GUARD] = 0x01;
    mem8[0x0114] = 0xff;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing sign-extend");
});

test("SP-TOOTH: the omitted-ret dispatch (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.mem.write8(PLAYER_FINE_ANGLE, 0x80);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, autoAdvanceRimRotation, TARGET, m);
  assert.equal(r.placeable, true, `autoAdvanceRimRotation must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret dispatch (moved 0) placeable");
});
