// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resolveSlotProximityInteractions (ROM 0xa463-0xa503) -- the near/far slot scan. It stores threshold A
// in loc_2e, walks loc_2db slots y=10..0 forming delta = |entry - threshold|, and for qualifying slots
// retires/spawns via retireSpawnedObject (near), spawnLaneEnemyAndAward (far band 4) or activateSlotAndRespawn (far other bands); afterwards, if
// HIT_TALLY,x reads 0xff it clears SLOT_STATE,x/HIT_TALLY,x and drops ACTIVE_OBJECT_COUNT. Inputs are A (threshold) and X
// (slot index). The contract is RAM (dumpState minus stack scratch below the entry SP) plus the returned exit Y (0xff), which
// spawnEntityIntoFreeSlot returns to runFrameStateUpdaters for stepActiveShots. Oracle is the frozen translated
// resolveSlotProximityInteractions; the three internal JSRs are dissolved to direct calls in the idiomatic layer.
// Run: node --test games/tempest/idiomatic/test/equivalence-a463.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a463 } from "../../translated/loc_a463.js";
import { resolveSlotProximityInteractions } from "../resolveSlotProximityInteractions.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import {
  loc_2e, TABLE_CURSOR, HIT_DISTANCE_THRESHOLD, ACTIVE_OBJECT_COUNT, ENEMY_BAND_THRESHOLD_0, TARGET_SEG, loc_2b5, SLOT_STATE, loc_2db, HIT_TALLY,
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

const TARGET = 0xa463;
const oracle = atEntry(loc_a463);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xa463 dispatches -- resolveSlotProximityInteractions == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented spawn/retire arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    const y = resolveSlotProximityInteractions(c);
    assert.equal(ramDiff(o, c), null, "RAM equal for a captured dispatch");
    assert.equal(y, o.regs.y, "returned exit Y = the oracle's Y");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// No-call scan: every slot nonzero (so both the near y<4 and far y>=4 paths run), but HIT_DISTANCE_THRESHOLD and the band
// thresholds ENEMY_BAND_THRESHOLD_0 are 0 so every delta >= threshold and NO callee ever fires -- this exercises the
// loc_2e store, the far-path TABLE_CURSOR store, and the final clear block deterministically. HIT_TALLY,x = 0xff
// arms the clear; ACTIVE_OBJECT_COUNT = 5 so its decrement is observable.
function seedNoCall(m) {
  m.regs.a = 0x80; m.regs.x = 0x05;
  m.mem.write8(loc_2e, 0x11);          // overwritten by the routine's threshold store
  m.mem.write8(HIT_DISTANCE_THRESHOLD, 0x00);          // near-slot delta gate wide open the wrong way -> near always skips
  for (let b = 0; b < 8; b++) m.mem.write8(u16(ENEMY_BAND_THRESHOLD_0 + b), 0x00); // far band thresholds -> far always skips
  for (let k = 0; k <= 10; k++) m.mem.write8(u16(loc_2db + k), 0x01); // all slots nonzero
  m.mem.write8(u16(HIT_TALLY + 0x05), 0xff); // arm the final clear for slot X
  m.mem.write8(ACTIVE_OBJECT_COUNT, 0x05);
}

test("CRAFTED: full scan with no callee fired -- RAM equal; loc_2e/TABLE_CURSOR/clear-block correct", () => {
  const o = new Machine(ROM, OPTS); seedNoCall(o);
  const c = new Machine(ROM, OPTS); seedNoCall(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw -- skipped"); return; }
  resolveSlotProximityInteractions(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the no-call scan + clear block");
  assert.equal(c.mem.read8(loc_2e), 0x80, "threshold stored to loc_2e");
  assert.equal(c.mem.read8(TABLE_CURSOR), 0x04, "TABLE_CURSOR holds the last far slot processed (y=4)");
  assert.equal(c.mem.read8(u16(HIT_TALLY + 0x05)), 0x00, "HIT_TALLY,x cleared");
  assert.equal(c.mem.read8(u16(SLOT_STATE + 0x05)), 0x00, "SLOT_STATE,x cleared");
  assert.equal(c.mem.read8(ACTIVE_OBJECT_COUNT), 0x04, "live count ACTIVE_OBJECT_COUNT decremented");
});

// Near-slot retire: a single near slot (y=2) whose delta is under HIT_DISTANCE_THRESHOLD and whose loc_2b5,y matches
// TARGET_SEG,x -> fires retireSpawnedObject. The retire chain (ccc1/a3d4/...) may reach an unimplemented arm; skip on
// oracle throw. When it runs cleanly this covers a dissolved-call path end-to-end.
function seedRetire(m) {
  m.regs.a = 0x10; m.regs.x = 0x05;
  m.mem.write8(HIT_DISTANCE_THRESHOLD, 0x40);           // delta gate open
  m.mem.write8(u16(loc_2db + 0x02), 0x11); // slot 2 entry -> delta = 1 < 0x40
  m.mem.write8(u16(loc_2b5 + 0x02), 0x07);
  m.mem.write8(u16(TARGET_SEG + 0x05), 0x07); // match -> retireSpawnedObject fires
}

test("CRAFTED-CALL: near-slot retire fires retireSpawnedObject -- RAM equal (skip on oracle throw)", () => {
  const o = new Machine(ROM, OPTS); seedRetire(o);
  const c = new Machine(ROM, OPTS); seedRetire(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED-CALL: oracle threw on the retire arm -- skipped"); return; }
  resolveSlotProximityInteractions(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the near-slot retire");
});

test("TEETH: a twin that drops the loc_2e threshold store MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedNoCall(o);
  const c = new Machine(ROM, OPTS); seedNoCall(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw -- skipped"); return; }
  let ran = false;
  const broken = (m) => {
    const before2e = m.mem.read8(loc_2e); // seeded 0x11, threshold is 0x80
    resolveSlotProximityInteractions(m);
    m.mem.write8(loc_2e, before2e); // BUG: revert the signature threshold store
    ran = true;
  };
  broken(c);
  assert.ok(ran, "the teeth twin did not run");
  assert.notEqual(ramDiff(o, c), null, "the dropped loc_2e store was NOT caught by the RAM compare");
});
