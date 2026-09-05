// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0c20 — equivalent to the frozen sprite-record builder at ROM 0x0c20.
 * Builds a 4-byte hardware sprite record at IY (in work RAM) from the object struct at IX, reading the
 * Y bias from register C. The only live-out is the sprite record (work RAM, in the state dump): A is
 * scratch and IX/IY/C are unchanged, so a pure ramDiff has full teeth here. Three paths are covered:
 *   - ACTIVE (+0 bit0 set): sprite#, position, and the angle folded into the attr. Swept over ALL 256
 *     angle values so every fold bucket and both loop directions are exercised.
 *   - SECONDARY (+0 clear, +1 set): fixed sprite# 7 and the record's fixed attr.
 *   - PARKED (both clear): X and Y forced off-screen (0xf8).
 * Positive controls: the oracle really rewrites the pre-dirtied record. Teeth: a no-op twin plus a
 * per-cell perturbation of each of the four record bytes, all caught by the RAM diff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_0c20 as cand } from "../loc_0c20.js";
import { loc_0c20 as oracle } from "../../translated/loc_0c20.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const OBJ = 0x4280;  // object struct (fields to +0x16), work RAM, clear of the record and the stack
const SPR = 0x4060;  // hardware sprite record (4 bytes), work RAM, in the state dump
const YOFF = 0x0c;   // register C: Y bias
const X_SRC = 0x50, Y_SRC = 0x40, ATTR_BASE = 0x10, ALT_ATTR = 0x23, SPRITE_NO = 0x05;
const SENTINEL = 0xaa; // pre-dirtied into the record so every oracle write is observable

// A crafted active-path entry with a given angle; the record is pre-dirtied and a ret laid.
function activeEntry(angle) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.ix = OBJ; m.regs.iy = SPR; m.regs.c = YOFF;
    mem8[OBJ + 0x00] = 0x01; mem8[OBJ + 0x01] = 0x00;
    mem8[OBJ + 0x03] = X_SRC; mem8[OBJ + 0x04] = Y_SRC; mem8[OBJ + 0x05] = angle;
    mem8[OBJ + 0x0f] = ATTR_BASE; mem8[OBJ + 0x12] = ALT_ATTR; mem8[OBJ + 0x16] = SPRITE_NO;
    for (let i = 0; i < 4; i++) mem8[SPR + i] = SENTINEL;
  });
}

function secondaryEntry() {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.ix = OBJ; m.regs.iy = SPR; m.regs.c = YOFF;
    mem8[OBJ + 0x00] = 0x00; mem8[OBJ + 0x01] = 0x01;
    mem8[OBJ + 0x03] = X_SRC; mem8[OBJ + 0x04] = Y_SRC; mem8[OBJ + 0x12] = ALT_ATTR;
    for (let i = 0; i < 4; i++) mem8[SPR + i] = SENTINEL;
  });
}

function parkedEntry() {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.ix = OBJ; m.regs.iy = SPR; m.regs.c = YOFF;
    mem8[OBJ + 0x00] = 0x00; mem8[OBJ + 0x01] = 0x00;
    for (let i = 0; i < 4; i++) mem8[SPR + i] = SENTINEL;
  });
}

// Runs the oracle from `entry` and returns the four record bytes.
function record(entry) {
  const a = entry.clone(); a.routines = STUBS; oracle(a);
  return [a.mem8[SPR], a.mem8[SPR + 1], a.mem8[SPR + 2], a.mem8[SPR + 3]];
}

test("EQUAL: loc_0c20 == oracle on the active path across all 256 angles", { skip }, () => {
  for (let angle = 0; angle < 256; angle++) {
    assert.equal(ramDiff(oracle, cand, activeEntry(angle)), null,
      `active path diverged at angle 0x${angle.toString(16)}`);
  }
  // Non-vacuous: the oracle rewrote every sentinel byte of the record for a representative angle.
  assert.ok(record(activeEntry(0x03)).every((b) => b !== SENTINEL), "oracle left a record byte unwritten");
  console.log("  EQUAL: loc_0c20 == oracle (RAM), active path over all 256 angles");
});

test("EQUAL: loc_0c20 == oracle on the secondary-active path", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, secondaryEntry()), null, "secondary path diverged");
  const r = record(secondaryEntry());
  assert.equal(r[2], 0x07, "positive control: oracle set sprite# 7");
  assert.equal(r[1], ALT_ATTR, "positive control: oracle set the fixed attr");
  console.log("  EQUAL: loc_0c20 == oracle (RAM), secondary-active path");
});

test("EQUAL: loc_0c20 == oracle on the parked path", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, parkedEntry()), null, "parked path diverged");
  const r = record(parkedEntry());
  assert.equal(r[0], 0xf8, "positive control: oracle parked Y off-screen");
  assert.equal(r[3], 0xf8, "positive control: oracle parked X off-screen");
  console.log("  EQUAL: loc_0c20 == oracle (RAM), parked off-screen");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const badY = (m) => { cand(m); m.mem8[SPR + 0] = m.mem8[SPR + 0] ^ 0xff; };
  const badAttr = (m) => { cand(m); m.mem8[SPR + 1] = m.mem8[SPR + 1] ^ 0xff; };
  const badNo = (m) => { cand(m); m.mem8[SPR + 2] = m.mem8[SPR + 2] ^ 0xff; };
  const badX = (m) => { cand(m); m.mem8[SPR + 3] = m.mem8[SPR + 3] ^ 0xff; };
  assert.ok(ramDiff(oracle, noOp, activeEntry(0x03)), "no-op twin escaped");
  assert.ok(ramDiff(oracle, badY, activeEntry(0x08)), "wrong-Y twin escaped");
  assert.ok(ramDiff(oracle, badAttr, activeEntry(0xf6)), "wrong-attr twin escaped");
  assert.ok(ramDiff(oracle, badNo, secondaryEntry()), "wrong-sprite# twin escaped");
  assert.ok(ramDiff(oracle, badX, parkedEntry()), "wrong-X twin escaped");
  console.log("  TEETH: no-op + per-cell Y/attr/#/X perturbations all caught (RAM)");
});
