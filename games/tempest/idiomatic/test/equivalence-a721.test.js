// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for decayEnemyFreeFlightVelocity (ROM 0xa721-0xa75c) -- steps a slot's three axis velocities through
// stepVelocityTowardZero and, when all saturate, zeros the slot's whole coordinate. The idiomatic side dissolves the
// three jsr $a75d into direct stepVelocityTowardZero(...) calls. Live-out is memory only (RAM incl. $29/$2a/$2b and
// the per-axis cells), so each arm compares RAM (dumpState minus stack scratch below the entry SP); X is unchanged so it is
// not asserted. Run: node --test games/tempest/idiomatic/test/equivalence-a721.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a721 } from "../../translated/loc_a721.js";
import { decayEnemyFreeFlightVelocity } from "../decayEnemyFreeFlightVelocity.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { stepVelocityTowardZero } from "../stepVelocityTowardZero.js";
import { loc_29, ENEMY_VEL1_LO, ENEMY_VEL0_LO, ENEMY_VEL2_LO, ENEMY_VEL1_HI, ENEMY_VEL0_HI, ENEMY_VEL2_HI, ENEMY_SLOT_FLAGS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa721;
const oracle = atEntry(loc_a721);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa721 dispatches -- decayEnemyFreeFlightVelocity == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); decayEnemyFreeFlightVelocity(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Slot 0: three velocities small enough that one fixed step (a788=0x20) crosses zero on every
// axis -> all three saturate ($29: 0xfd + 3 wraps to 0x00) -> the slot coord is zeroed.
function seedSaturating(m) {
  m.regs.x = 0;
  for (const b of [ENEMY_VEL1_LO, ENEMY_VEL0_LO, ENEMY_VEL2_LO]) m.mem.write8(b, 0x00); // low bytes
  for (const b of [ENEMY_VEL1_HI, ENEMY_VEL0_HI, ENEMY_VEL2_HI]) m.mem.write8(b, 0x00); // whole bytes (0x0000 -> step crosses zero)
  m.mem.write8(ENEMY_SLOT_FLAGS, 0x77); // dirty coord sentinel
}

test("CRAFTED: three saturating axes -- RAM equal and the slot coord clears to 0", () => {
  const o = new Machine(ROM, OPTS); seedSaturating(o);
  const c = new Machine(ROM, OPTS); seedSaturating(c);
  oracle(o); decayEnemyFreeFlightVelocity(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after step");
  assert.equal(c.mem.read8(ENEMY_SLOT_FLAGS), 0x00, "coord cleared on full saturation");
});

test("TEETH: a twin that skips the axis steps diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedSaturating(o);
  const c = new Machine(ROM, OPTS); seedSaturating(c);
  oracle(o);
  const brokenA721 = (_m) => { /* BUG: never steps any axis, never zeros the coord */ };
  brokenA721(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped steps");
});

// Distinct per-axis low != whole (non-saturating): makes the module-vs-oracle RAM compare a real
// marshalling check -- a swapped (low,whole) arg to stepVelocityTowardZero would diverge from the oracle here.
function seedDistinct(m) {
  m.regs.x = 0;
  m.mem.write8(ENEMY_VEL1_LO, 0x03); m.mem.write8(ENEMY_VEL1_HI, 0x41); // axis 0: low != whole, whole large -> no saturate
  m.mem.write8(ENEMY_VEL0_LO, 0x05); m.mem.write8(ENEMY_VEL0_HI, 0x42); // axis 1
  m.mem.write8(ENEMY_VEL2_LO, 0x07); m.mem.write8(ENEMY_VEL2_HI, 0x43); // axis 2
  m.mem.write8(ENEMY_SLOT_FLAGS, 0x77);
}

test("CRAFTED (marshalling): distinct low!=whole per axis -- decayEnemyFreeFlightVelocity == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedDistinct(o);
  const c = new Machine(ROM, OPTS); seedDistinct(c);
  oracle(o); decayEnemyFreeFlightVelocity(c);
  assert.equal(ramDiff(o, c), null, "RAM equal -- correct (low,whole) arg order to stepVelocityTowardZero");
});

test("TEETH (marshalling): a twin that swaps axis-0 (low,whole) args diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedDistinct(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedDistinct(c);
  const swappedTwin = (m, x = m.regs.x) => {
    const mem8 = m.mem8;
    mem8[loc_29] = 0xfd;
    // BUG: axis-0 args swapped (whole, low) instead of (low, whole)
    { const [low, whole] = stepVelocityTowardZero(m, mem8[u16(ENEMY_VEL1_HI + x)], mem8[u16(ENEMY_VEL1_LO + x)]);
      mem8[u16(ENEMY_VEL1_LO + x)] = low; mem8[u16(ENEMY_VEL1_HI + x)] = whole; }
    { const [low, whole] = stepVelocityTowardZero(m, mem8[u16(ENEMY_VEL0_LO + x)], mem8[u16(ENEMY_VEL0_HI + x)]);
      mem8[u16(ENEMY_VEL0_LO + x)] = low; mem8[u16(ENEMY_VEL0_HI + x)] = whole; }
    { const [low, whole] = stepVelocityTowardZero(m, mem8[u16(ENEMY_VEL2_LO + x)], mem8[u16(ENEMY_VEL2_HI + x)]);
      mem8[u16(ENEMY_VEL2_LO + x)] = low; mem8[u16(ENEMY_VEL2_HI + x)] = whole; }
    if (mem8[loc_29] !== 0) return;
    mem8[u16(ENEMY_SLOT_FLAGS + x)] = 0x00;
  };
  swappedTwin(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the swapped (low,whole) marshalling");
});

test("LIVE-OUT: returned Y equals the oracle's exit Y on BOTH RTS paths", () => {
  // Non-saturating (distinct): exits via the bne-skip RTS at 0xa75c. Exit Y = axis-2 stepped whole.
  {
    const o = new Machine(ROM, OPTS); seedDistinct(o); oracle(o);
    const c = new Machine(ROM, OPTS); seedDistinct(c); const ry = decayEnemyFreeFlightVelocity(c);
    assert.equal(ramDiff(o, c), null, "RAM still equal (non-saturating)");
    assert.equal(ry, o.regs.y, "returned Y must equal oracle exit Y (bne-skip path)");
  }
  // Saturating: exits via the fall-through RTS after `sta $0283,x`. All axes saturate -> exit Y = 0.
  {
    const o = new Machine(ROM, OPTS); seedSaturating(o); oracle(o);
    const c = new Machine(ROM, OPTS); seedSaturating(c); const ry = decayEnemyFreeFlightVelocity(c);
    assert.equal(ramDiff(o, c), null, "RAM still equal (saturating)");
    assert.equal(ry, o.regs.y, "returned Y must equal oracle exit Y (fall-through path)");
  }
});

test("TEETH (live-out): a twin returning the wrong axis's whole diverges from oracle exit Y", () => {
  const o = new Machine(ROM, OPTS); seedDistinct(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedDistinct(c);
  const wrongTwin = (m, x = m.regs.x) => {
    const { mem8 } = m;
    mem8[loc_29] = 0xfd;
    let whole0;
    { const [low, whole] = stepVelocityTowardZero(m, mem8[u16(ENEMY_VEL1_LO + x)], mem8[u16(ENEMY_VEL1_HI + x)]);
      mem8[u16(ENEMY_VEL1_LO + x)] = low; mem8[u16(ENEMY_VEL1_HI + x)] = whole; whole0 = whole; }
    { const [low, whole] = stepVelocityTowardZero(m, mem8[u16(ENEMY_VEL0_LO + x)], mem8[u16(ENEMY_VEL0_HI + x)]);
      mem8[u16(ENEMY_VEL0_LO + x)] = low; mem8[u16(ENEMY_VEL0_HI + x)] = whole; }
    { const [low, whole] = stepVelocityTowardZero(m, mem8[u16(ENEMY_VEL2_LO + x)], mem8[u16(ENEMY_VEL2_HI + x)]);
      mem8[u16(ENEMY_VEL2_LO + x)] = low; mem8[u16(ENEMY_VEL2_HI + x)] = whole; }
    // BUG: returns axis-0 whole (0x40) instead of the axis-2 exit whole (0x42).
    if (mem8[loc_29] !== 0) return whole0;
    mem8[u16(ENEMY_SLOT_FLAGS + x)] = 0x00;
    return whole0;
  };
  const ry = wrongTwin(c);
  assert.notEqual(ry, o.regs.y, "the live-out check FAILED to catch a wrong-axis return");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, decayEnemyFreeFlightVelocity, TARGET, m);
  assert.equal(r.placeable, true, `decayEnemyFreeFlightVelocity must be seam-placeable; got: ${r.error}`);
});
