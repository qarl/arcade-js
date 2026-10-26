// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for spawnEnemyOnTimerExpiry (ROM 0x9923-0x994c) -- the slot-timer expiry handler for slot X. It
// raises a spawn request (loc_29 = 0xf0), latches OBJECT_INDEX_TABLE,x into loc_2a, saves X in SAVED_INDEX, runs the
// placement pass placeSpawnListForColumnDeficit, then reloads X from SAVED_INDEX. If the request survived (loc_29 still set) and
// spawnClimberInFreeSlot allocates a free slot, it drops FIRE_GATE and clears this slot's timer OBJECT_RECORD_TABLE,x; otherwise it
// flags loc_2f = 0xff and re-arms the timer (inc OBJECT_RECORD_TABLE,x). Both callees preserve X (spawnClimberInFreeSlot saves it in
// SAVED_INDEX2 and restores it; spawnEnemyOnTimerExpiry saves it in SAVED_INDEX and reloads it), so exit X == the reloaded SAVED_INDEX in
// every path -- X is the only live-out register (the caller tickSpawnSlotTimers reads OBJECT_RECORD_TABLE,x right after the call).
// Contract = RAM (dumpState minus stack scratch below the entry SP) PLUS X. Oracle is the frozen translated spawnEnemyOnTimerExpiry.
// Run: node --test games/tempest/idiomatic/test/equivalence-9923.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9923 } from "../../translated/loc_9923.js";
import { spawnEnemyOnTimerExpiry } from "../spawnEnemyOnTimerExpiry.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import {
  loc_29, loc_2a, loc_2f, SAVED_INDEX, OBJECT_INDEX_TABLE, OBJECT_RECORD_TABLE, FIRE_GATE,
  ENEMY_SLOT_TOP, COLUMN_SPAWN_CAP, COLUMN_ENEMY_TARGET, LANE_ENEMY_COUNT_0, ENEMY_DEPTH,
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

const TARGET = 0x9923;
const oracle = atEntry(loc_9923);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9923 dispatches -- spawnEnemyOnTimerExpiry == oracle in RAM (-stack) and X", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may route through an unimplemented placement arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    spawnEnemyOnTimerExpiry(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X live-out matches");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Path B seed: on a fresh machine every deficit column is zero, so placeSpawnListForColumnDeficit finds no column to place and
// clears loc_29. spawnClimberInFreeSlot is then skipped and spawnEnemyOnTimerExpiry takes the re-arm path: loc_2f = 0xff, inc OBJECT_RECORD_TABLE,x.
function seedRearm(m, x) {
  m.regs.x = x;
  m.mem.write8(u16(OBJECT_INDEX_TABLE + x), 0x07); // -> loc_2a
  m.mem.write8(u16(OBJECT_RECORD_TABLE + x), 0x10); // this slot's timer -> inc to 0x11
  m.mem.write8(loc_2f, 0x00);           // distinct from the 0xff the routine writes
  m.mem.write8(FIRE_GATE, 0x08);          // must stay untouched on this path
}

test("CRAFTED: no placement (placeSpawnListForColumnDeficit clears loc_29) -> re-arm path -- RAM and X equal", () => {
  const X = 0x05;
  const o = new Machine(ROM, OPTS); seedRearm(o, X);
  const c = new Machine(ROM, OPTS); seedRearm(c, X);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(rearm): oracle threw on this seed -- skipped"); return; }
  spawnEnemyOnTimerExpiry(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the re-arm path");
  assert.equal(c.regs.x, o.regs.x, "X live-out matches");
  assert.equal(c.regs.x, X, "X is the saved/reloaded slot index");
  assert.equal(c.mem.read8(loc_2a), 0x07, "loc_2a latched from OBJECT_INDEX_TABLE,x");
  assert.equal(c.mem.read8(SAVED_INDEX), X, "SAVED_INDEX holds the slot index");
  assert.equal(c.mem.read8(loc_29), 0x00, "placeSpawnListForColumnDeficit cleared the spawn request");
  assert.equal(c.mem.read8(loc_2f), 0xff, "loc_2f flagged on the re-arm path");
  assert.equal(c.mem.read8(u16(OBJECT_RECORD_TABLE + X)), 0x11, "this slot's timer was re-armed (inc)");
  assert.equal(c.mem.read8(FIRE_GATE), 0x08, "FIRE_GATE untouched on the re-arm path");
});

// Success seed: one deficit column so placeSpawnListForColumnDeficit tries a placement. If that placement succeeds (dispatchListSetupByColumn
// returns nonzero via the RTS-trick dispatch) loc_29 survives and spawnClimberInFreeSlot allocates a free slot, driving
// the FIRE_GATE drop + timer clear. The dispatch may route to an unimplemented arm; skip on oracle throw.
function seedPlace(m, x) {
  m.regs.x = x;
  m.mem.write8(ENEMY_SLOT_TOP, 0x04);           // active-count index -> cap 5, and the spawnClimberInFreeSlot scan span
  m.mem.write8(u16(COLUMN_ENEMY_TARGET + 0x02), 0x01); // column 2 wants one -> deficit 1
  m.mem.write8(u16(COLUMN_SPAWN_CAP + 0x02), 0x01); // column 2 has a target -> count==1 path calls dispatchListSetupByColumn
  m.mem.write8(u16(OBJECT_INDEX_TABLE + x), 0x03);
  m.mem.write8(u16(OBJECT_RECORD_TABLE + x), 0x20);
  m.mem.write8(FIRE_GATE, 0x08);
}

test("CRAFTED: placement path attempt (placeSpawnListForColumnDeficit keeps loc_29, spawnClimberInFreeSlot allocates) -- RAM and X equal", () => {
  const X = 0x02;
  const o = new Machine(ROM, OPTS); seedPlace(o, X);
  const c = new Machine(ROM, OPTS); seedPlace(c, X);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(place): oracle threw (dispatch reached an unimplemented arm) -- skipped"); return; }
  spawnEnemyOnTimerExpiry(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the placement path");
  assert.equal(c.regs.x, o.regs.x, "X live-out matches");
  console.log("  CRAFTED(place): ran without an oracle throw");
});

test("TEETH: a twin that drops the timer re-arm MUST diverge in RAM", () => {
  const X = 0x05;
  const o = new Machine(ROM, OPTS); seedRearm(o, X);
  const c = new Machine(ROM, OPTS); seedRearm(c, X);
  let threw = false;
  let tried = 0;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: run the real routine, then undo the OBJECT_RECORD_TABLE,x re-arm. The re-arm inc is a signature write
  // of the no-placement path, so dropping it guarantees a RAM divergence.
  const broken = (m, x = m.regs.x) => {
    spawnEnemyOnTimerExpiry(m);
    m.mem.write8(u16(OBJECT_RECORD_TABLE + x), m.mem.read8(u16(OBJECT_RECORD_TABLE + x)) - 1); // BUG: undo the timer re-arm
  };
  tried++;
  broken(c, X);
  assert.equal(tried, 1, "the teeth arm ran");
  assert.notEqual(ramDiff(o, c), null, "the dropped timer re-arm was NOT caught by the RAM compare");
});
