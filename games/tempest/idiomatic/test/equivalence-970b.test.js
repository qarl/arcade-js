// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for runPerFrameUpdates -- the per-frame update driver: runs nine per-frame passes in order then
// tail-delegates to ageShotsAndAdvanceFrameClock. Contract: RAM (dumpState minus stack scratch below the entry SP), plus the exit [X, Y]
// it returns (the tail pass's) where an arm compares it. Oracle = frozen translated.
// Run: node --test games/tempest/idiomatic/test/equivalence-970b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_970b } from "../../translated/loc_970b.js";
import { runPerFrameUpdates } from "../runPerFrameUpdates.js";
import { rotateBlasterAroundRim } from "../rotateBlasterAroundRim.js";
import { spawnEntityIntoFreeSlot } from "../spawnEntityIntoFreeSlot.js";
import { stepAttractEnemySweepTimer } from "../stepAttractEnemySweepTimer.js";
import { tickSpawnSlotTimers } from "../tickSpawnSlotTimers.js";
import { stepActiveShots } from "../stepActiveShots.js";
import { spawnClimbersFromSourceSlots } from "../spawnClimbersFromSourceSlots.js";
import { scanAllSlotsForProximity } from "../scanAllSlotsForProximity.js";
import { ageTimedObjects } from "../ageTimedObjects.js";
import { ageShotsAndAdvanceFrameClock } from "../ageShotsAndAdvanceFrameClock.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  STATUS_FLAGS, PLAYER_FINE_ANGLE, ENEMY_ANIM_ACCUM, ENEMY_ANIM_DELTA, ENEMY_SLOT_TOP, ENEMY_DEPTH, SLOT_STATE,
  PLAYER_SHOT_DEPTH, OBJECT_VELOCITY_LO, OBJECT_VELOCITY_HI, ACTIVE_ENEMY_COUNT, TARGET_SEG, PLAYER_SEGMENT, INPUT_DEBOUNCED, loc_31, loc_32,
  ACTIVE_OBJECT_COUNT,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x970b;
const oracle = atEntry(loc_970b);
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(12, 3000) : [];

test("CAPTURE: real 0x970b dispatches -- runPerFrameUpdates == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a real per-frame dispatch may reach an unimplemented draw arm in a sub
    { const ex = c.regs.x, ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry X/Y go in as arguments
      assert.deepEqual(runPerFrameUpdates(c, ey, ex), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

test("CRAFTED: a fresh-machine frame -- runPerFrameUpdates == oracle in RAM (skip on oracle throw)", () => {
  const o = new Machine(ROM, OPTS);
  const c = new Machine(ROM, OPTS);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle hit an unimplemented arm on a fresh frame -- skipped"); return; }
  runPerFrameUpdates(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the full per-frame pass");
});

test("TEETH: a twin that DROPS the runObjectMotionScripts pass MUST diverge from the oracle in RAM", () => {
  // Seed ENEMY_ANIM_ACCUM/ENEMY_ANIM_DELTA so runObjectMotionScripts's accumulate is observable (a fresh frame leaves it inert).
  const seed = (m) => { m.mem.write8(0x0148, 0x10); m.mem.write8(0x0147, 0x05); };
  const o = new Machine(ROM, OPTS); seed(o);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle hit an unimplemented arm -- skipped"); return; }
  const c = new Machine(ROM, OPTS); seed(c);
  // Broken twin: the same driver but SKIPPING runObjectMotionScripts (the 5th pass). If runObjectMotionScripts has any RAM effect on
  // a fresh frame, the ordered-call contract is violated and the RAM diff must catch it.
  let brokeThrew = false;
  try {
    rotateBlasterAroundRim(c); spawnEntityIntoFreeSlot(c); stepAttractEnemySweepTimer(c); tickSpawnSlotTimers(c); /* runObjectMotionScripts(c) DROPPED */
    stepActiveShots(c); spawnClimbersFromSourceSlots(c); scanAllSlotsForProximity(c); ageTimedObjects(c); ageShotsAndAdvanceFrameClock(c);
  } catch { brokeThrew = true; }
  if (brokeThrew) { console.log("  TEETH: broken twin hit an unimplemented arm -- skipped"); return; }
  assert.notEqual(ramDiff(o, c), null, "dropping runObjectMotionScripts was NOT caught by the RAM compare");
});

// STALE-REGS: the driver must hand each pass the ROM's X/Y, not whatever m.regs holds. The idiomatic side
// starts with poisoned regs; the oracle runs from the same seed. Each seed asserts the sound loader's
// loc_31/loc_32 stash took the expected value on the oracle (positive control), then RAM equality.
const ENTRY_Y = 0x4d;
const STALE = {
  // Walk skipped (fine angle bit7); the sum goes negative -> spike cue stashes X = 0xff into loc_31.
  walkSkippedCue: { cell: loc_31, want: 0xff, seed: (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80); m.mem.write8(PLAYER_FINE_ANGLE, 0x80);
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x7c); m.mem.write8(ENEMY_ANIM_DELTA, 0x10);
  } },
  // Walk over empty slots leaves the sum (0x08) in Y; a shot retires on a target match -> loc_32 = 0x08.
  shotRetirePrime: { cell: loc_32, want: 0x08, seed: (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80); m.mem.write8(PLAYER_FINE_ANGLE, 0x00); m.mem.write8(ENEMY_SLOT_TOP, 0x02);
    for (let i = 0; i <= 2; i++) m.mem.write8(ENEMY_DEPTH + i, 0);
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x05); m.mem.write8(ENEMY_ANIM_DELTA, 0x03); m.mem.write8(SLOT_STATE + 0x0b, 0x10);
    m.mem.write8(PLAYER_SHOT_DEPTH, 0x80); m.mem.write8(OBJECT_VELOCITY_LO, 0); m.mem.write8(OBJECT_VELOCITY_HI, 0);
    m.mem.write8(ACTIVE_ENEMY_COUNT, 1); m.mem.write8(TARGET_SEG + 0x0b, m.mem.read8(PLAYER_SEGMENT));
  } },
  // Manual play with the fire bit: a spawn into slot 7 -> its sound stashes the entry Y into loc_32.
  manualSpawn: { cell: loc_32, want: ENTRY_Y, also: [loc_31, 0x07], seed: (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80); m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
    m.mem.write8(INPUT_DEBOUNCED, 0x10); m.mem.write8(PLAYER_SHOT_DEPTH, 0x10);
  } },
};

test("STALE-REGS: runPerFrameUpdates threads the ROM's X/Y to each pass, not stale m.regs", () => {
  for (const [name, { cell, want, also, seed }] of Object.entries(STALE)) {
    const prep = (m) => { seed(m); for (const a of [0x31, 0x32, 0x35, 0x36]) m.mem.write8(a, 0x11); };
    const o = new Machine(ROM, OPTS); prep(o); o.regs.x = 0x3c; o.regs.y = ENTRY_Y;
    const c = new Machine(ROM, OPTS); prep(c); c.regs.x = 0xa5; c.regs.y = 0xb6;
    oracle(o);
    assert.equal(o.mem.read8(cell), want, `${name}: positive control -- oracle did not take the intended path`);
    if (also) assert.equal(o.mem.read8(also[0]), also[1], `${name}: positive control (second cell)`);
    const exit = runPerFrameUpdates(c, ENTRY_Y, 0x3c);
    assert.equal(ramDiff(o, c), null, `${name}: RAM differs from the oracle`);
    assert.deepEqual(exit, [o.regs.x, o.regs.y], `${name}: returned exit [X, Y] differs from the oracle's`);
  }
});

// The register bridge: entered with no Y argument (as a frozen caller would), runPerFrameUpdates must read the
// Y the register file holds, which is the oracle's entry Y here, and hand it to the spawn sound's loader.
test("DEFAULT-Y: with no Y argument the bridge default reads m.regs.y, which reaches the spawn stash", () => {
  const prep = (m) => { STALE.manualSpawn.seed(m); for (const a of [0x31, 0x32, 0x35, 0x36]) m.mem.write8(a, 0x11); };
  const o = new Machine(ROM, OPTS); prep(o); o.regs.x = 0x3c; o.regs.y = ENTRY_Y;
  const c = new Machine(ROM, OPTS); prep(c); c.regs.x = 0xa5; c.regs.y = ENTRY_Y;
  oracle(o);
  assert.equal(o.mem.read8(loc_32), ENTRY_Y, "positive control: the oracle's spawn sound stashed the entry Y");
  runPerFrameUpdates(c);
  assert.equal(ramDiff(o, c), null, "RAM equal with the Y taken from the register bridge");
});

// A low shot that retires inside stepActiveShots: its lane-hit pass loads Y with the shot's target segment, and
// with the rotation locked and every later pass skipping its Y load (no climber walk, no live slot for the
// proximity scan, no timed object, the shot ager's negative arm) that Y is the routine's exit Y.
test("SHOT-RETIRE-Y: stepActiveShots' exit Y carries to the routine's exit (m.regs poisoned)", () => {
  const seed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x80); m.mem.write8(PLAYER_FINE_ANGLE, 0x80);
    m.mem.write8(SLOT_STATE + 0, 0xe8); m.mem.write8(TARGET_SEG + 0, 0x05); m.mem.write8(ACTIVE_OBJECT_COUNT, 0x01);
    m.regs.x = 0x3c; m.regs.y = ENTRY_Y;
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c); c.regs.x = 0xa5; c.regs.y = 0xa5;
  oracle(o);
  assert.equal(o.mem.read8(SLOT_STATE + 0), 0x00, "positive control: the oracle retired the shot");
  assert.equal(o.regs.y, 0x05, "positive control: the oracle's exit Y is the shot's target segment");
  const exit = runPerFrameUpdates(c, ENTRY_Y, 0x3c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.deepEqual(exit, [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's");
});
