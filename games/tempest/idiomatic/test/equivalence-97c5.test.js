// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for aimSpinnerAtNearestEnemy (ROM 0x97c5-0x97f7) -- scans $02df,x (count from $011c) for the
// smallest nonzero entry, keeping value in $29 and index in $2a. If none is found it returns the last
// entry seen. Otherwise it dissolves the m.call($a7a6) into a direct signedSegmentDelta(m, $02b9,idx, $0200)
// and returns A = 0 (zero) / 0x09 (negative) / 0xf7 (positive), leaving the delta in Y. Live-out is A (the
// returned code), Y (returned too; undefined = untouched) plus memory ($29/$2a and a7a6's $2a stash), so arms
// compare RAM (dumpState, minus stack scratch below the entry SP) AND the oracle's A and Y.
// Run: node --test games/tempest/idiomatic/test/equivalence-97c5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_97c5 } from "../../translated/loc_97c5.js";
import { aimSpinnerAtNearestEnemy } from "../aimSpinnerAtNearestEnemy.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, loc_2a, ENEMY_SLOT_TOP, ENEMY_DEPTH, ENEMY_SEGMENT, PLAYER_SEGMENT, TUBE_GEOM_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x97c5;
const oracle = atEntry(loc_97c5);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x97c5 dispatches -- aimSpinnerAtNearestEnemy == oracle in RAM (-stack) and in A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const [a, y] = aimSpinnerAtNearestEnemy(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(a, o.regs.a, "return code A matches");
    assert.equal(y ?? c.regs.y, o.regs.y, "exit Y matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: found -> A code by sign; none-found -> last entry seen", () => {
  // found: smallest nonzero at index 2; a7a6 derives the sign-coded return
  const seedFound = (m) => {
    m.mem.write8(ENEMY_SLOT_TOP, 0x04);
    for (let i = 0; i <= 4; i++) m.mem.write8((ENEMY_DEPTH + i) & 0xffff, 0x00);
    m.mem.write8((ENEMY_DEPTH + 2) & 0xffff, 0x03);
    m.mem.write8((ENEMY_SEGMENT + 2) & 0xffff, 0x10);
    m.mem.write8(PLAYER_SEGMENT, 0x40);
  };
  let o = new Machine(ROM, OPTS); seedFound(o);
  let c = new Machine(ROM, OPTS); seedFound(c);
  oracle(o); let [a, y] = aimSpinnerAtNearestEnemy(c);
  assert.equal(ramDiff(o, c), null, "found branch RAM equal");
  assert.equal(a, o.regs.a, "found branch A equal");
  assert.equal(y, o.regs.y, "found branch Y = the segment delta");
  assert.equal(c.mem.read8(loc_29), 0x03, "min value kept");

  // none found: every entry 0x00 -> $2a stays 0xff -> return last entry (0x00)
  const seedNone = (m) => {
    m.mem.write8(ENEMY_SLOT_TOP, 0x04);
    for (let i = 0; i <= 4; i++) m.mem.write8((ENEMY_DEPTH + i) & 0xffff, 0x00);
  };
  o = new Machine(ROM, OPTS); seedNone(o);
  c = new Machine(ROM, OPTS); seedNone(c);
  c.regs.y = o.regs.y = 0x5c; // an incoming Y the none-found branch must leave alone
  oracle(o); [a, y] = aimSpinnerAtNearestEnemy(c);
  assert.equal(ramDiff(o, c), null, "none-found branch RAM equal");
  assert.equal(a, o.regs.a, "none-found branch A equal");
  assert.equal(y, undefined, "none-found branch leaves Y untouched");
  assert.equal(o.regs.y, 0x5c, "oracle none-found branch leaves Y untouched");
  assert.equal(c.mem.read8(loc_2a), 0xff, "$2a stays 0xff");
});

function seedSigned(m, enemySeg, playerSeg) {
  m.mem.write8(TUBE_GEOM_FLAG, 0x00);
  m.mem.write8(ENEMY_SLOT_TOP, 0x04);
  for (let i = 0; i <= 4; i++) m.mem.write8((ENEMY_DEPTH + i) & 0xffff, 0x00);
  m.mem.write8((ENEMY_DEPTH + 2) & 0xffff, 0x03);
  m.mem.write8((ENEMY_SEGMENT + 2) & 0xffff, enemySeg);
  m.mem.write8(PLAYER_SEGMENT, playerSeg);
  m.regs.y = 0x5c; // a preset Y the found branch must overwrite with the delta
}

test("CRAFTED-NEG: found, negative delta -> A = 0x09 and exit Y = the delta", () => {
  const o = new Machine(ROM, OPTS); seedSigned(o, 0x04, 0x06);
  const c = new Machine(ROM, OPTS); seedSigned(c, 0x04, 0x06);
  oracle(o); const [a, y] = aimSpinnerAtNearestEnemy(c);
  assert.equal(o.regs.a, 0x09, "positive control: the oracle took the negative (0x09) exit");
  assert.notEqual(o.regs.y, 0x5c, "positive control: the oracle reloaded Y");
  assert.equal(ramDiff(o, c), null, "negative branch RAM equal");
  assert.equal(a, o.regs.a, "negative branch A equal");
  assert.equal(y, o.regs.y, "negative branch Y = the segment delta");
});

test("CRAFTED-POS: found, positive delta -> A = 0xf7 and exit Y = the delta", () => {
  const o = new Machine(ROM, OPTS); seedSigned(o, 0x06, 0x04);
  const c = new Machine(ROM, OPTS); seedSigned(c, 0x06, 0x04);
  oracle(o); const [a, y] = aimSpinnerAtNearestEnemy(c);
  assert.equal(o.regs.a, 0xf7, "positive control: the oracle took the positive (0xf7) exit");
  assert.notEqual(o.regs.y, 0x5c, "positive control: the oracle reloaded Y");
  assert.equal(ramDiff(o, c), null, "positive branch RAM equal");
  assert.equal(a, o.regs.a, "positive branch A equal");
  assert.equal(y, o.regs.y, "positive branch Y = the segment delta");
});

test("TEETH: a twin that returns the wrong code (or mis-scans) diverges from the oracle", () => {
  const seed = (m) => {
    m.mem.write8(ENEMY_SLOT_TOP, 0x04);
    for (let i = 0; i <= 4; i++) m.mem.write8((ENEMY_DEPTH + i) & 0xffff, 0x00);
    m.mem.write8((ENEMY_DEPTH + 2) & 0xffff, 0x03);
    m.mem.write8((ENEMY_SEGMENT + 2) & 0xffff, 0x10);
    m.mem.write8(PLAYER_SEGMENT, 0x40);
  };
  // A live-out arm: same memory effect, but a wrong return code must be caught.
  let o = new Machine(ROM, OPTS); seed(o);
  let c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const [code] = aimSpinnerAtNearestEnemy(c);
  const corrupt = (code ^ 0xff) & 0xff; // BUG: corrupt the return code
  assert.notEqual(corrupt, o.regs.a, "A comparison FAILED to catch a corrupted return code");

  // Memory arm: a twin that never records the smallest index diverges in RAM.
  o = new Machine(ROM, OPTS); seed(o);
  c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => { m.mem.write8(loc_29, 0xff); m.mem.write8(loc_2a, 0xff); }; // BUG: never scans
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped scan");
});
