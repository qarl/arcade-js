// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceEnemyFreeFlight (ROM 0xa6a9-0xa720) -- integrate slot x's three motion axes into their
// fraction+whole coordinate pairs, resetting the whole on ring overflow. X is the slot index (param); the
// live-out is RAM only (final A/Y just mirror the shared-cell whole), so each side runs on a clone and the
// contract is RAM (dumpState, minus stack scratch below the entry SP). A leaf: the module omits the ROM ret and the seam
// completes it, so the arms compare RAM (-stack), NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-a6a9.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a6a9 } from "../../translated/loc_a6a9.js";
import { advanceEnemyFreeFlight } from "../advanceEnemyFreeFlight.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  OBJECT_AXIS0_FRAC, ENEMY_VEL0_LO, ENEMY_VEL0_HI, ENEMY_SLOT_FLAGS,
  OBJECT_INDEX_TABLE, ENEMY_VEL1_LO, ENEMY_VEL1_HI, OBJECT_AXIS1_POS,
  OBJECT_RECORD_TABLE, ENEMY_VEL2_LO, ENEMY_VEL2_HI, ENEMY_POS2,
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

const TARGET = 0xa6a9;
const oracle = atEntry(loc_a6a9);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa6a9 dispatches -- advanceEnemyFreeFlight == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const y = advanceEnemyFreeFlight(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(y, o.regs.y, "returned register (exit Y = whole0) matches oracle's live-out Y");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// slot 3: axis0 keeps its whole, axis1 leaves it, axis2 overflows the ring (whole snaps to 0).
const X = 3;
function seed(m) {
  m.regs.x = X;
  m.mem.write8(OBJECT_AXIS0_FRAC + X, 0x90); m.mem.write8(ENEMY_VEL0_LO + X, 0x80); m.mem.write8(ENEMY_VEL0_HI + X, 0x10); m.mem.write8(ENEMY_SLOT_FLAGS + X, 0x50);
  m.mem.write8(OBJECT_INDEX_TABLE + X, 0x02); m.mem.write8(ENEMY_VEL1_LO + X, 0x01); m.mem.write8(ENEMY_VEL1_HI + X, 0x90); m.mem.write8(OBJECT_AXIS1_POS + X, 0x05);
  m.mem.write8(OBJECT_RECORD_TABLE + X, 0x00); m.mem.write8(ENEMY_VEL2_LO + X, 0x00); m.mem.write8(ENEMY_VEL2_HI + X, 0x10); m.mem.write8(ENEMY_POS2 + X, 0xe5);
}

test("CRAFTED: three axes integrate; axis-2 ring overflow forces the shared whole to 0", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); const y = advanceEnemyFreeFlight(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after integrate");
  assert.equal(c.mem.read8(OBJECT_AXIS0_FRAC + X), 0x10, "axis0 fraction wrapped");
  assert.equal(c.mem.read8(OBJECT_AXIS1_POS + X), 0x95, "axis1 whole stored");
  assert.equal(c.mem.read8(ENEMY_POS2 + X), 0xf5, "axis2 whole stored (raw, unclamped)");
  assert.equal(c.mem.read8(ENEMY_SLOT_FLAGS + X), 0x00, "shared whole zeroed by axis2 overflow");
  // register live-out: exit Y = whole0 (0 here, forced by axis-2 overflow) == oracle's Y at RTS
  assert.equal(y, o.regs.y, "returned register (exit Y) matches oracle's live-out Y");
  assert.equal(y, 0x00, "exit Y is 0 (axis-2 overflow zeroed whole0)");
});

test("REG-LIVE-OUT: no-overflow axes -- exit Y carries axis-0 whole and matches oracle Y", () => {
  // seed all three axes to stay inside the ring so whole0 survives to exit Y as the axis-0 whole.
  function seedNoOverflow(m) {
    m.regs.x = X;
    m.mem.write8(OBJECT_AXIS0_FRAC + X, 0x10); m.mem.write8(ENEMY_VEL0_LO + X, 0x00); m.mem.write8(ENEMY_VEL0_HI + X, 0x02); m.mem.write8(ENEMY_SLOT_FLAGS + X, 0x40);
    m.mem.write8(OBJECT_INDEX_TABLE + X, 0x10); m.mem.write8(ENEMY_VEL1_LO + X, 0x00); m.mem.write8(ENEMY_VEL1_HI + X, 0x02); m.mem.write8(OBJECT_AXIS1_POS + X, 0x40);
    m.mem.write8(OBJECT_RECORD_TABLE + X, 0x10); m.mem.write8(ENEMY_VEL2_LO + X, 0x00); m.mem.write8(ENEMY_VEL2_HI + X, 0x02); m.mem.write8(ENEMY_POS2 + X, 0x40);
  }
  const o = new Machine(ROM, OPTS); seedNoOverflow(o);
  const c = new Machine(ROM, OPTS); seedNoOverflow(c);
  oracle(o); const y = advanceEnemyFreeFlight(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after integrate (no overflow)");
  assert.equal(y, o.regs.y, "exit Y matches oracle Y");
  assert.equal(y, 0x42, "exit Y is the axis-0 whole (0x40 + 0x02)");
});

test("TEETH-RET: a twin returning a wrong exit register diverges from the oracle Y", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const badReturn = advanceEnemyFreeFlight(c) ^ 0xff; // any corruption of the true whole0
  assert.notEqual(badReturn, o.regs.y, "a wrong return would (correctly) fail the live-out check");
});

test("TEETH: a twin that ignores axis-1/2 ring overflow (never zeroes the shared whole) diverges", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenA6a9 = (m, x) => {
    const mem8 = m.mem8;
    const axis = (frac, vlow, sign, whole) => {
      const sum = mem8[(frac + x) & 0xffff] + mem8[(vlow + x) & 0xffff];
      mem8[(frac + x) & 0xffff] = sum;
      const s = mem8[(sign + x) & 0xffff];
      const w = (s + mem8[(whole + x) & 0xffff] + (sum > 0xff ? 1 : 0)) & 0xff;
      return { w, overflow: (s & 0x80) ? w < 0x10 : w >= 0xf0 };
    };
    const a0 = axis(OBJECT_AXIS0_FRAC, ENEMY_VEL0_LO, ENEMY_VEL0_HI, ENEMY_SLOT_FLAGS);
    const whole0 = a0.overflow ? 0 : a0.w; // BUG: axis1/2 overflow never re-zeroes this
    const a1 = axis(OBJECT_INDEX_TABLE, ENEMY_VEL1_LO, ENEMY_VEL1_HI, OBJECT_AXIS1_POS); mem8[(OBJECT_AXIS1_POS + x) & 0xffff] = a1.w;
    const a2 = axis(OBJECT_RECORD_TABLE, ENEMY_VEL2_LO, ENEMY_VEL2_HI, ENEMY_POS2); mem8[(ENEMY_POS2 + x) & 0xffff] = a2.w;
    mem8[(ENEMY_SLOT_FLAGS + x) & 0xffff] = whole0;
  };
  brokenA6a9(c, X);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing overflow-zero");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, advanceEnemyFreeFlight, TARGET, m);
  assert.equal(r.placeable, true, `advanceEnemyFreeFlight must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
