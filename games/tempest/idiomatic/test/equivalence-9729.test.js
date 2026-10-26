// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for runFrameStateUpdaters (ROM 0x9729-0x9748) -- the per-frame update chain. It clears bit7 of
// SPIKED_SEGMENT_COUNT, runs the five state updaters rotateBlasterAroundRim/advanceMovingSpike/ageTimedObjects/spawnEntityIntoFreeSlot/stepActiveShots in order, then when
// PLAYER_FINE_ANGLE is negative (bit7 set) runs ageShotsAndAdvanceFrameClock. It is a plain call-and-return routine (no computed
// dispatch, no tail delegate) that returns the exit [X, Y] the ROM leaves (the frame dispatcher hands it to
// seedFramePhaseAndTick), so the contract is RAM (dumpState minus STACK_SCRATCH) plus that pair; there is no
// seam tooth. Oracle is the frozen translated runFrameStateUpdaters.
// Run: node --test games/tempest/idiomatic/test/equivalence-9729.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9729 as oracle } from "../../translated/loc_9729.js";
import { runFrameStateUpdaters } from "../runFrameStateUpdaters.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH, SPIKED_SEGMENT_COUNT, PLAYER_FINE_ANGLE, STATUS_FLAGS, SPINNER_ACCUM, RIM_ROT_OFFSET, PLAYER_SEGMENT, TUBE_GEOM_FLAG,
  SPIKE_ACTIVE_FLAG, PLAYER_SHOT_DEPTH, TIMED_OBJECT_COUNT, SHAPE_ACTIVE, SHAPE_ID, INPUT_DEBOUNCED, SLOT_STATE, TARGET_SEG,
  loc_31, loc_32, SAVED_INDEX, SAVED_INDEX2, SOUND_VOICE_TABLE,
  ENEMY_SLOT_TOP, ENEMY_DEPTH, ENEMY_SEGMENT, ACTIVE_ENEMY_COUNT, OBJECT_VELOCITY_LO, OBJECT_VELOCITY_HI,
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

const TARGET = 0x9729;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9729 dispatches -- runFrameStateUpdaters == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented draw arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    const ex = c.regs.x, ey = c.regs.y;
    c.regs.x ^= 0xff; c.regs.y ^= 0xff; // the entry registers go in as arguments, never through the file
    const exit = runFrameStateUpdaters(c, ey, ex);
    assert.equal(ramDiff(o, c), null);
    assert.deepEqual(exit, [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// PLAYER_FINE_ANGLE negative -> the two flag-guarded updaters (rotateBlasterAroundRim, advanceMovingSpike) early-return and the extra
// updater ageShotsAndAdvanceFrameClock runs; SPIKED_SEGMENT_COUNT has bit7 set so the signature clear is observable.
function seedExtra(m) {
  m.mem.write8(SPIKED_SEGMENT_COUNT, 0xff); // bit7 set -> the clear must land
  m.mem.write8(PLAYER_FINE_ANGLE, 0x80); // negative -> ageShotsAndAdvanceFrameClock runs, rotateBlasterAroundRim/advanceMovingSpike skip
  m.regs.x = 0x00; m.regs.y = 0x00;
}

// PLAYER_FINE_ANGLE positive -> rotateBlasterAroundRim/advanceMovingSpike run their bodies and ageShotsAndAdvanceFrameClock is skipped.
function seedBodies(m) {
  m.mem.write8(SPIKED_SEGMENT_COUNT, 0xc4); // bit7 set -> clear observable, low bits survive
  m.mem.write8(PLAYER_FINE_ANGLE, 0x00); // positive -> updaters run, ageShotsAndAdvanceFrameClock skipped
  m.regs.x = 0x00; m.regs.y = 0x00;
}

test("CRAFTED: PLAYER_FINE_ANGLE negative -- chain runs, ageShotsAndAdvanceFrameClock fires, RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedExtra(o);
  const c = new Machine(ROM, OPTS); seedExtra(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(extra): oracle threw on this seed -- skipped"); return; }
  assert.deepEqual(runFrameStateUpdaters(c, 0x00, 0x00), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's");
  assert.equal(ramDiff(o, c), null, "RAM equal after the chain + ageShotsAndAdvanceFrameClock");
  assert.equal(c.mem.read8(SPIKED_SEGMENT_COUNT), o.mem.read8(SPIKED_SEGMENT_COUNT), "SPIKED_SEGMENT_COUNT matches the oracle");
  assert.equal(c.mem.read8(SPIKED_SEGMENT_COUNT) & 0x80, 0, "bit7 of SPIKED_SEGMENT_COUNT cleared");
});

test("CRAFTED: PLAYER_FINE_ANGLE positive -- updaters run, ageShotsAndAdvanceFrameClock skipped, RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedBodies(o);
  const c = new Machine(ROM, OPTS); seedBodies(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(bodies): oracle threw on this seed -- skipped"); return; }
  assert.deepEqual(runFrameStateUpdaters(c, 0x00, 0x00), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's");
  assert.equal(ramDiff(o, c), null, "RAM equal after the update chain");
  assert.equal(c.mem.read8(SPIKED_SEGMENT_COUNT) & 0x80, 0, "bit7 of SPIKED_SEGMENT_COUNT cleared");
});

// R37: four passes reach the sound loader (loc_31/loc_32 stash X/Y) and one reaches the object insert
// (loc_35/loc_36 stash X/Y), so each must be handed the ROM's X/Y. Those cells are overwritten by the later
// stashes, so log every stash on both sides (the same write-write signature in the oracle and the port).
function logStashes(m) {
  const log = [], w = m.mem.write8.bind(m.mem);
  let pend = null;
  m.mem.write8 = (a, v) => {
    if (pend && a === pend.hi) log.push([pend.lo, pend.v, v & 0xff]);
    pend = a === loc_31 || a === SAVED_INDEX ? { lo: a, hi: a + 1, v: v & 0xff } : null;
    return w(a, v);
  };
  return log;
}
// Play state, lane crossing (rim sound), spike at its trigger height (start sound), one live timed object
// (type 2 -> Y), one free shot slot (spawn sound), and a high slot falling past the floor on the player's
// lane (prime sound + object insert).
function seedStashes(m) {
  const w = (a, v) => m.mem.write8(a, v);
  w(SPIKED_SEGMENT_COUNT, 0xc4); w(PLAYER_FINE_ANGLE, 0x00); w(STATUS_FLAGS, 0x80);
  w(SPINNER_ACCUM, 0x10); w(RIM_ROT_OFFSET, 0x40); w(PLAYER_SEGMENT, 0x0f); w(TUBE_GEOM_FLAG, 0x00);
  w(SPIKE_ACTIVE_FLAG, 0x80); w(PLAYER_SHOT_DEPTH, 0x10);
  w(TIMED_OBJECT_COUNT, 0x01); w(SHAPE_ACTIVE + 3, 0x01); w(SHAPE_ID + 3, 0x02);
  w(INPUT_DEBOUNCED, 0x10);
  for (let i = 0; i < 12; i++) w(SLOT_STATE + i, i === 7 ? 0x00 : 0x01);
  w(SLOT_STATE + 8, 0x05); w(TARGET_SEG + 8, 0x03);
  m.regs.x = 0x3c; m.regs.y = 0x4d;
}

test("STALE-REGS: every X/Y stash matches the oracle with Y passed explicitly and m.regs poisoned", () => {
  const o = new Machine(ROM, OPTS); seedStashes(o);
  const c = new Machine(ROM, OPTS); seedStashes(c);
  const ol = logStashes(o), cl = logStashes(c);
  c.regs.x = 0xa5; c.regs.y = 0x5a;
  oracle(o); const exit = runFrameStateUpdaters(c, 0x4d, 0x3c);
  assert.equal(ramDiff(o, c), null, "RAM equal with m.regs poisoned");
  assert.deepEqual(exit, [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's");
  assert.deepEqual(cl, ol, "the same X/Y reach every loader and insert stash, in order");
  assert.ok(ol.filter(([a]) => a === loc_31).length >= 4 && ol.some(([a]) => a === SAVED_INDEX), `positive control: ${JSON.stringify(ol)}`);
});

test("TEETH: a twin that skips the bit7 clear of SPIKED_SEGMENT_COUNT MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedExtra(o);
  const c = new Machine(ROM, OPTS); seedExtra(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to runFrameStateUpdaters but restores SPIKED_SEGMENT_COUNT's original value, dropping the signature
  // clear. SPIKED_SEGMENT_COUNT was seeded with bit7 set, so the dropped clear guarantees a RAM divergence.
  const broken = (m) => {
    const before123 = m.mem.read8(SPIKED_SEGMENT_COUNT);
    runFrameStateUpdaters(m);
    m.mem.write8(SPIKED_SEGMENT_COUNT, before123); // BUG: revert the bit7 clear
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped bit7 clear was NOT caught by the RAM compare");
});

// Aim mode ($05 bit7 clear): the rotation's auto-aim moves Y to its segment delta, and its own rim cue is muted, so
// that Y reaches RAM only further down the chain. No timed object is live and every low slot is taken (no spawn),
// so it reaches stepActiveShots unchanged, where a high slot retiring on the player's lane runs the object insert,
// which stashes Y in SAVED_INDEX2 ($36) whatever $05 holds. "rim" is the rim review's seed, "frame" the frame
// review's (the latter also proves the spawn pass hands back the entry Y when no slot is free).
const AIM = {
  rim: { want: 0x02, seed: (w) => {
    w(RIM_ROT_OFFSET, 0x12); w(ENEMY_SEGMENT + 2, 0x06); w(PLAYER_SHOT_DEPTH, 0x80);
    w(ACTIVE_ENEMY_COUNT, 0x01); w(SLOT_STATE + 0x0b, 0x10); w(TARGET_SEG + 0x0b, 0x01);
  } },
  frame: { want: 0x04, seed: (w) => {
    w(RIM_ROT_OFFSET, 0x40); w(ENEMY_SEGMENT + 2, 0x08); w(PLAYER_SHOT_DEPTH, 0x20);
    w(ACTIVE_ENEMY_COUNT, 0x02); w(SLOT_STATE + 8, 0x05); w(TARGET_SEG + 8, 0x04);
  } },
};
function seedAim(m, which) {
  const w = (a, v) => m.mem.write8(a, v);
  w(STATUS_FLAGS, 0x00); w(PLAYER_FINE_ANGLE, 0x00); w(TUBE_GEOM_FLAG, 0x00); w(PLAYER_SEGMENT, 0x04);
  w(ENEMY_SLOT_TOP, 0x04);
  for (let i = 0; i <= 4; i++) w(ENEMY_DEPTH + i, i === 2 ? 0x03 : 0x00);
  w(TIMED_OBJECT_COUNT, 0x00); w(SPIKE_ACTIVE_FLAG, 0x00);
  for (let i = 0; i < 8; i++) w(SLOT_STATE + i, 0x20);
  w(OBJECT_VELOCITY_LO, 0x00); w(OBJECT_VELOCITY_HI, 0x00);
  AIM[which].seed(w);
  w(SAVED_INDEX, 0x11); w(SAVED_INDEX2, 0x11);
  m.regs.x = 0x20; m.regs.y = 0x4d;
}
test("AIM-INSERT: the rotation's exit Y reaches the object insert's SAVED_INDEX2 stash (m.regs poisoned)", () => {
  for (const which of Object.keys(AIM)) {
    const o = new Machine(ROM, OPTS); seedAim(o, which);
    const c = new Machine(ROM, OPTS); seedAim(c, which); c.regs.x = 0xa5; c.regs.y = 0xa5;
    oracle(o);
    const stash = o.mem.read8(SAVED_INDEX2);
    assert.notEqual(stash, 0x11, `${which}: positive control: the oracle's insert never ran`);
    assert.notEqual(stash, 0x4d, `${which}: positive control: the oracle's rotation did not move Y`);
    assert.equal(stash, AIM[which].want, `${which}: positive control: the stash is the aim delta`);
    const exit = runFrameStateUpdaters(c, 0x4d, 0x20);
    assert.equal(ramDiff(o, c), null, `${which}: RAM equal`);
    assert.deepEqual(exit, [o.regs.x, o.regs.y], `${which}: returned exit [X, Y] = the oracle's`);
  }
});
