// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for retireEnemyAndSpawnSplit (ROM 0xa06f-0xa0f6) -- retires the enemy in slot Y: clears ENEMY_DEPTH,y,
// drops ENEMY_TYPE_COUNT (matched, lane != 4) or ENEMY_TOTAL_COUNT, drops the per-lane LANE_ENEMY_COUNT_0 counter (X parked in SAVED_INDEX
// and restored, so exit X == entry X), then on (ENEMY_SLOT_DIR,y & 3) != 0 seats loc_2b/loc_2a and spawns a
// replacement via setupEnemyCoordList + spawnClimberInFreeSlot (twice). Live-out is RAM (dumpState minus stack scratch below the entry SP) PLUS A, X,
// Y: both callees restore Y and X is saved/restored, so those match trivially; A is the anded gate value
// on the early return and otherwise whatever the final spawnClimberInFreeSlot leaves. Oracle is the frozen translated
// retireEnemyAndSpawnSplit. Run: node --test games/tempest/idiomatic/test/equivalence-a06f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a06f } from "../../translated/loc_a06f.js";
import { retireEnemyAndSpawnSplit } from "../retireEnemyAndSpawnSplit.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import {
  loc_29, SAVED_INDEX, loc_2a, loc_2b, COORD_LIST_PTR_HI, ENEMY_TOTAL_COUNT, ENEMY_TYPE_COUNT, SCRIPT_WALK_CONTINUE, SCRIPT_CURSOR,
  TUBE_GEOM_FLAG, PLAYER_SHOT_DEPTH, ENEMY_SLOT_FLAGS, ENEMY_SLOT_DIR, ENEMY_SEGMENT, ENEMY_DEPTH, LANE_ENEMY_COUNT_0,
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

const TARGET = 0xa06f;
const oracle = atEntry(loc_a06f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xa06f dispatches -- retireEnemyAndSpawnSplit == oracle in RAM (-stack), A/X/Y", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may route to an unimplemented list-setup arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    retireEnemyAndSpawnSplit(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
    assert.equal(c.regs.x, o.regs.x, "X live-out matches");
    assert.equal(c.regs.y, o.regs.y, "Y live-out matches");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed a slot Y and the gate cells. The lane index that reaches dispatchCoordListSetup (via setupEnemyCoordList when loc_29 >= 0x20)
// is kept to 0 -- gate 1 -> loc_2b = 0 -- so the oracle's dispatch resolves to seatDemoCoordListPointer (arms 1 and 4 throw).
function seedDraw(m, y) {
  m.regs.y = y; m.regs.x = 0x7a;
  m.mem.write8(u16(ENEMY_DEPTH + y), 0x30); // slotVal -> loc_29 = 0x30 (>= 0x20 -> setupEnemyCoordList dispatches dispatchCoordListSetup)
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x30);          // match -> take the ENEMY_TYPE_COUNT path (lane != 4 below)
  m.mem.write8(u16(ENEMY_SLOT_FLAGS + y), 0x02); // lane 2 (!= 4): decrement ENEMY_TYPE_COUNT, then LANE_ENEMY_COUNT_0[2]
  m.mem.write8(u16(ENEMY_SLOT_DIR + y), 0x01); // gate 1 -> loc_2b = 0 (a safe list-setup index)
  m.mem.write8(u16(ENEMY_SEGMENT + y), 0x05); // seat = (5 - 1) & 0x0f = 4
  m.mem.write8(TUBE_GEOM_FLAG, 0x00);          // bit7 clear -> no 0x0f snap
  m.mem.write8(COORD_LIST_PTR_HI, 0x07);           // SCRIPT_CURSOR = 7 - 1 = 6
  m.mem.write8(u16(LANE_ENEMY_COUNT_0 + 0x02), 0x05);
  m.mem.write8(ENEMY_TOTAL_COUNT, 0x40);
  m.mem.write8(ENEMY_TYPE_COUNT, 0x20);
}

test("CRAFTED: draw path (gate != 0) spawns via setupEnemyCoordList + spawnClimberInFreeSlot -- RAM and A/X/Y equal", () => {
  const Y = 0x02;
  const o = new Machine(ROM, OPTS); seedDraw(o, Y);
  const c = new Machine(ROM, OPTS); seedDraw(c, Y);
  oracle(o); retireEnemyAndSpawnSplit(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the draw path");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.x, o.regs.x, "X restored to the entry index");
  assert.equal(c.regs.x, 0x7a, "X is the saved caller index");
  assert.equal(c.regs.y, o.regs.y, "Y preserved across the callees");
  assert.equal(c.regs.y, Y, "Y is the entry slot index");
  assert.equal(c.mem.read8(u16(ENEMY_DEPTH + Y)), 0x00, "the slot was cleared");
});

// Seed the cleared/decrement path: gate 0 -> return after clearing the slot and dropping the counters.
function seedClear(m, y) {
  m.regs.y = y; m.regs.x = 0x7a;
  m.mem.write8(u16(ENEMY_DEPTH + y), 0x10);
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x10);          // match
  m.mem.write8(u16(ENEMY_SLOT_FLAGS + y), 0x03); // lane 3 (!= 4) -> ENEMY_TYPE_COUNT path, then LANE_ENEMY_COUNT_0[3]
  m.mem.write8(u16(ENEMY_SLOT_DIR + y), 0x04); // (0x04 & 3) == 0 -> gate 0, early return
  m.mem.write8(ENEMY_TOTAL_COUNT, 0x40);
  m.mem.write8(ENEMY_TYPE_COUNT, 0x20);
  m.mem.write8(u16(LANE_ENEMY_COUNT_0 + 0x03), 0x05);
}

test("CRAFTED: cleared path (gate == 0) drops ENEMY_TYPE_COUNT/LANE_ENEMY_COUNT_0 and returns A=0 -- RAM and A/X/Y equal", () => {
  const Y = 0x02;
  const o = new Machine(ROM, OPTS); seedClear(o, Y);
  const c = new Machine(ROM, OPTS); seedClear(c, Y);
  oracle(o); retireEnemyAndSpawnSplit(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the cleared path");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x00, "A is the anded gate value (0)");
  assert.equal(c.regs.x, o.regs.x, "X restored");
  assert.equal(c.regs.y, o.regs.y, "Y preserved");
  assert.equal(c.mem.read8(u16(ENEMY_DEPTH + Y)), 0x00, "the slot was cleared");
  assert.equal(c.mem.read8(ENEMY_TYPE_COUNT), 0x1f, "ENEMY_TYPE_COUNT was decremented (matched, lane != 4)");
  assert.equal(c.mem.read8(ENEMY_TOTAL_COUNT), 0x40, "ENEMY_TOTAL_COUNT untouched on the ENEMY_TYPE_COUNT path");
});

test("TEETH: a twin that drops the LANE_ENEMY_COUNT_0,x decrement MUST diverge in RAM", () => {
  const Y = 0x02;
  const o = new Machine(ROM, OPTS); seedClear(o, Y);
  const c = new Machine(ROM, OPTS); seedClear(c, Y);
  oracle(o);
  const broken = (m, y = m.regs.y) => {
    const { mem8 } = m;
    const slotVal = mem8[u16(ENEMY_DEPTH + y)];
    mem8[loc_29] = slotVal;
    let decTotal = true;
    if (slotVal === mem8[PLAYER_SHOT_DEPTH] && (mem8[u16(ENEMY_SLOT_FLAGS + y)] & 0x07) !== 0x04) {
      mem8[ENEMY_TYPE_COUNT] = mem8[ENEMY_TYPE_COUNT] - 1;
      decTotal = false;
    }
    if (decTotal) mem8[ENEMY_TOTAL_COUNT] = mem8[ENEMY_TOTAL_COUNT] - 1;
    mem8[u16(ENEMY_DEPTH + y)] = 0x00;
    mem8[SAVED_INDEX] = m.regs.x;
    // BUG: drops `mem8[u16(LANE_ENEMY_COUNT_0 + lane)] = mem8[u16(LANE_ENEMY_COUNT_0 + lane)] - 1;`
    const gate = mem8[u16(ENEMY_SLOT_DIR + y)] & 0x03;
    return (m.regs.a = gate); // gate == 0 on this seed
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped LANE_ENEMY_COUNT_0 decrement was NOT caught by the RAM compare");
  assert.equal(c.regs.a, o.regs.a, "the twin still matches in A (the defect is RAM-only)");
});
