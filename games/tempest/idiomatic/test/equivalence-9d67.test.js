// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for faceEnemyTowardPlayerSegment (ROM 0x9d67-0x9d81) -- reads $02b9,x -> Y, dissolves the
// m.call($a7a6) into a direct signedSegmentDelta(m, $0200, Y) whose signed difference's top bit picks whether
// to clear (and #$bf) or set (ora #$40) bit6 of $0283,x. Live-out is memory ($0283,x and a7a6's
// $2a stash), so each side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-9d67.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9d67 } from "../../translated/loc_9d67.js";
import { faceEnemyTowardPlayerSegment } from "../faceEnemyTowardPlayerSegment.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { ENEMY_SEGMENT, PLAYER_SEGMENT, ENEMY_SLOT_FLAGS, TUBE_GEOM_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9d67;
const oracle = atEntry(loc_9d67);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9d67 dispatches -- faceEnemyTowardPlayerSegment == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); faceEnemyTowardPlayerSegment(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: both branches -- clear bit6 when diff negative, set bit6 when non-negative", () => {
  // signedSegmentDelta keeps the FULL A-Y difference only when $0111 bit7 is set; otherwise it masks to the
  // low nibble and sign-extends it, which flips the sign of small values. Seed $0111 bit7 so the
  // returned diff's sign is the plain A-Y sign, and both branches exercise their intended path.

  // A - Y negative (full byte bit7 set) -> asl carry set -> clear bit6
  const seedA = (m) => {
    m.regs.x = 2;
    m.mem.write8(TUBE_GEOM_FLAG, 0x80);                // $0111 bit7 -> keep full difference
    m.mem.write8((ENEMY_SEGMENT + 2) & 0xffff, 0x40); // Y
    m.mem.write8(PLAYER_SEGMENT, 0x10);                // A ; A - Y = 0xd0 (negative)
    m.mem.write8((ENEMY_SLOT_FLAGS + 2) & 0xffff, 0xff); // all flag bits set
  };
  let o = new Machine(ROM, OPTS); seedA(o);
  let c = new Machine(ROM, OPTS); seedA(c);
  oracle(o); faceEnemyTowardPlayerSegment(c);
  assert.equal(ramDiff(o, c), null, "clear-bit6 branch RAM equal");
  assert.equal((c.mem.read8((ENEMY_SLOT_FLAGS + 2) & 0xffff) & 0x40) !== 0, false, "bit6 cleared");

  // A - Y non-negative (full byte bit7 clear) -> asl carry clear -> set bit6
  const seedB = (m) => {
    m.regs.x = 5;
    m.mem.write8(TUBE_GEOM_FLAG, 0x80);                // $0111 bit7 -> keep full difference
    m.mem.write8((ENEMY_SEGMENT + 5) & 0xffff, 0x08); // Y
    m.mem.write8(PLAYER_SEGMENT, 0x20);                // A ; A - Y = 0x18 (positive)
    m.mem.write8((ENEMY_SLOT_FLAGS + 5) & 0xffff, 0x00); // all flag bits clear
  };
  o = new Machine(ROM, OPTS); seedB(o);
  c = new Machine(ROM, OPTS); seedB(c);
  oracle(o); faceEnemyTowardPlayerSegment(c);
  assert.equal(ramDiff(o, c), null, "set-bit6 branch RAM equal");
  assert.equal((c.mem.read8((ENEMY_SLOT_FLAGS + 5) & 0xffff) & 0x40) !== 0, true, "bit6 set");
});

test("TEETH: a twin that inverts the bit6 decision diverges from the oracle", () => {
  // Seed so the oracle SETS bit6 (full A-Y positive). Build the twin from a full oracle run so it
  // carries every side effect (a7a6's $2a stash included), then flip ONLY the bit6 decision -- the
  // RAM diff must then diverge on $0283,x specifically, not on some skipped side effect.
  const seed = (m) => {
    m.regs.x = 5;
    m.mem.write8(TUBE_GEOM_FLAG, 0x80);                // keep full difference
    m.mem.write8((ENEMY_SEGMENT + 5) & 0xffff, 0x08);
    m.mem.write8(PLAYER_SEGMENT, 0x40);                // A - Y = 0x38 (positive) -> oracle sets bit6
    m.mem.write8((ENEMY_SLOT_FLAGS + 5) & 0xffff, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  oracle(c); // c now identical to o (correct bit6 set + a7a6 $2a stash)
  const e = (ENEMY_SLOT_FLAGS + c.regs.x) & 0xffff;
  c.mem.write8(e, c.mem.read8(e) & 0xbf); // BUG: invert the decision -- clear the bit6 the oracle set
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the inverted decision");
});
