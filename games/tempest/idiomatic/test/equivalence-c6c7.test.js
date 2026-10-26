// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitEnemySlotEntry (ROM 0xc6c7-0xc73b) -- a CALLER: it dissolves m.call into direct
// idiomatic calls (c453, c098, c73c, bd3e). Effect is memory only (cursor $a9 + vector RAM via ($74)),
// so each side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). The bit6-set
// (target-flag) branch is only reached in specific free-running states CAPTURE's cycle-driven run never hits,
// which hid a stale-cursor bug (it discarded appendNormalizedMantissaExponent's advanced offset, emitting a
// 2-byte-short record); CRAFTED now exercises BOTH the inactive branch and that bit6 branch.
// Run: node --test games/tempest/idiomatic/test/equivalence-c6c7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c6c7 } from "../../translated/loc_c6c7.js";
import { emitEnemySlotEntry } from "../emitEnemySlotEntry.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { TABLE_CURSOR, LANE_LIMIT, LANE_TARGET_FLAG, SEG_MID_X, SEG_MID_Y, DRAW_CURSOR_LO, DRAW_CURSOR_HI, DRAW_CURSOR_OFFSET } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc6c7;
const oracle = atEntry(loc_c6c7);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xc6c7 dispatches -- emitEnemySlotEntry == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitEnemySlotEntry(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Point the ($74) cursor at vector RAM (0x2000, RW + diffed) and start the write cursor at 0.
function seedCursor(m) {
  m.mem.write8(DRAW_CURSOR_LO, 0x00);
  m.mem.write8(DRAW_CURSOR_HI, 0x20);
  m.mem.write8(DRAW_CURSOR_OFFSET, 0x00);
}

test("CRAFTED: inactive slot ($03ac,x == 0) writes four 0x00/0x71 pairs and advances $a9", () => {
  const seed = (m) => {
    seedCursor(m);
    m.mem.write8(TABLE_CURSOR, 0x00);
    m.mem.write8((LANE_LIMIT + 0x00) & 0xffff, 0x00); // slot inactive
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); emitEnemySlotEntry(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after inactive-branch emit");
  for (let i = 0; i < 4; i++) {
    assert.equal(c.mem.read8(0x2000 + i * 2), 0x00, `pair ${i} lo`);
    assert.equal(c.mem.read8(0x2001 + i * 2), 0x71, `pair ${i} hi`);
  }
  assert.equal(c.mem.read8(DRAW_CURSOR_OFFSET), 0x08, "cursor advanced by 8");
});

test("CRAFTED: active slot, target-flag bit6 SET -- emitEnemySlotEntry == oracle (the branch that hid the stale-cursor bug)", () => {
  const seed = (m) => {
    seedCursor(m);
    m.mem.write8(TABLE_CURSOR, 0x00);
    m.mem.write8((LANE_LIMIT + 0x00) & 0xffff, 0x08);        // active slot (nonzero depth)
    m.mem.write8((LANE_TARGET_FLAG + 0x00) & 0xffff, 0x40);  // target flag bit6 -> the randomized-word branch
    m.mem.write8((SEG_MID_X + 0x00) & 0xffff, 0x40);         // seat the projection point (both sides run the same passes)
    m.mem.write8((SEG_MID_Y + 0x00) & 0xffff, 0x40);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); emitEnemySlotEntry(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the bit6 branch -- cursor $a9 + the appended record");
  // The record is a 4-byte append (mantissa, exponent, template LO, HI) after the delta-vector pair. The bug
  // advanced $a9 by only 2 and clobbered the mantissa/exponent, so the cursor + those bytes diverge; assert
  // the fixed idiomatic cursor matches the oracle's.
  assert.equal(c.mem.read8(DRAW_CURSOR_OFFSET), o.mem.read8(DRAW_CURSOR_OFFSET), "cursor $a9 matches the oracle");
});

test("TEETH: a twin that emits only three pairs (and skips the $a9 update) diverges from the oracle", () => {
  const seed = (m) => {
    seedCursor(m);
    m.mem.write8(TABLE_CURSOR, 0x00);
    m.mem.write8((LANE_LIMIT + 0x00) & 0xffff, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const base = m.mem.read8(DRAW_CURSOR_LO) | (m.mem.read8(DRAW_CURSOR_HI) << 8);
    let y = m.mem.read8(DRAW_CURSOR_OFFSET);
    for (let i = 0; i < 3; i++) { // BUG: three pairs, never writes the fourth or $a9
      m.mem.write8((base + y) & 0xffff, 0x00); y = (y + 1) & 0xff;
      m.mem.write8((base + y) & 0xffff, 0x71); y = (y + 1) & 0xff;
    }
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped pair + cursor");
});
