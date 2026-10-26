// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for ageShotsAndAdvanceFrameClock (ROM 0xa504-0xa5ca) -- a sign-split routine: the positive arm bumps a
// slot timer and conditionally resets shot state (jsr $a5cb, jsr $928f); the negative arm ages the shot
// table, advances a clock/counter, and clamps a running total (jsr $928f). The idiomatic side dissolves
// every jsr into direct initWaveStateCountingSpikes / clearActiveShots calls. Live-out is RAM plus the exit [X, Y] it
// returns, so the CAPTURE, CRAFTED and EXIT-X arms compare RAM (dumpState minus stack scratch below the entry SP), and the CAPTURE and EXIT-X arms also the returned pair. Run: node --test games/tempest/idiomatic/test/equivalence-a504.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a504 } from "../../translated/loc_a504.js";
import { ageShotsAndAdvanceFrameClock } from "../ageShotsAndAdvanceFrameClock.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  GAME_MODE, loc_3d, SLOT_COUNTDOWN, ACTIVE_ENEMY_COUNT, SPIKE_ACTIVE_FLAG, ENEMY_TOTAL_COUNT, ENEMY_TYPE_COUNT,
  TIMED_OBJECT_COUNT, PLAYER_SHAPE_SUM, ENEMY_SLOT_TOP, ACTIVE_OBJECT_COUNT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH, ENEMY_DEPTH, FIRE_GATE, loc_455,
  loc_40, loc_42, INPUT_DEBOUNCED, STATUS_FLAGS, DSW1_SNAPSHOT,
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

const TARGET = 0xa504;
const oracle = atEntry(loc_a504);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xa504 dispatches -- ageShotsAndAdvanceFrameClock == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { const ex = c.regs.x, ey = c.regs.y; c.regs.x ^= 0xff; c.regs.y ^= 0xff; // entry X/Y go in as arguments
      assert.deepEqual(ageShotsAndAdvanceFrameClock(c, ex, ey), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Negative arm, full path: age the shot table, take the $0202 counter branch past its ceiling, then
// run the tail (sets $00, jsr $928f, clamps the $03ab total).
function seedNegative(m) {
  m.mem.write8(PLAYER_FINE_ANGLE, 0x80);            // bit7 set -> negative arm
  m.mem.write8(ACTIVE_OBJECT_COUNT, 0x00);
  m.mem.write8(ACTIVE_ENEMY_COUNT, 0x00);
  m.mem.write8(TIMED_OBJECT_COUNT, 0x00);            // gate clear -> proceed to age loop
  m.mem.write8(ENEMY_SLOT_TOP, 0x02);            // age three shot entries
  m.mem.write8((ENEMY_DEPTH + 0) & 0xffff, 0x05);
  m.mem.write8((ENEMY_DEPTH + 1) & 0xffff, 0x00);
  m.mem.write8((ENEMY_DEPTH + 2) & 0xffff, 0xf5); // ceiling -> snaps to 0
  m.mem.write8(loc_3d, 0x00);
  m.mem.write8((SLOT_COUNTDOWN + 0) & 0xff, 0x00); // != 1 -> the $0202 branch
  m.mem.write8(PLAYER_SHOT_DEPTH, 0xf0);             // +0x0f crosses the ceiling -> proceed
  m.mem.write8(ENEMY_TOTAL_COUNT, 0x10);
  m.mem.write8(ENEMY_TYPE_COUNT, 0x10);
  m.mem.write8(FIRE_GATE, 0x05);
}

test("CRAFTED negative: age + counter + tail -- RAM equal, $0202 stepped, $03ab clamped", () => {
  const o = new Machine(ROM, OPTS); seedNegative(o);
  const c = new Machine(ROM, OPTS); seedNegative(c);
  oracle(o); ageShotsAndAdvanceFrameClock(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the negative arm");
  assert.equal(c.mem.read8(PLAYER_SHOT_DEPTH), 0xff, "$0202 advanced by 0x0f");
  assert.equal(c.mem.read8(GAME_MODE), 0x06, "tail seeded $00");
  assert.equal(c.mem.read8(FIRE_GATE), 0x25, "$03ab total clamped");
});

// Positive arm, reset path: gate clear, no shot past threshold -> initWaveStateCountingSpikes + clearActiveShots both run.
function seedPositive(m) {
  m.mem.write8(PLAYER_FINE_ANGLE, 0x00);   // bit7 clear -> positive arm
  m.mem.write8(loc_455, 0x00);
  m.mem.write8(PLAYER_SHAPE_SUM, 0x00); // gate byte
  m.mem.write8(SPIKE_ACTIVE_FLAG, 0x00);   // don't early-return
  m.mem.write8(FIRE_GATE, 0x00);
  m.mem.write8(TIMED_OBJECT_COUNT, 0x00);   // enter the reset scan
  m.mem.write8(ENEMY_SLOT_TOP, 0x02);
  for (let i = 0; i <= 2; i++) m.mem.write8((ENEMY_DEPTH + i) & 0xffff, 0x00); // nothing past threshold
}

test("CRAFTED positive: reset path dissolves initWaveStateCountingSpikes + clearActiveShots -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedPositive(o);
  const c = new Machine(ROM, OPTS); seedPositive(c);
  oracle(o); ageShotsAndAdvanceFrameClock(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the positive reset path");
});

// Positive arm with the timer bump live: X = loc_40 (5) unless a later call reloads it. No other arm reaches the
// bump with loc_40 != 0xff, so these pin each X load (bump, reset, tail) against a dropped one.
const EXIT_X_SEEDS = [
  { name: "bump then spike exit", cells: { [SPIKE_ACTIVE_FLAG]: 0x80 }, x: 0x05 },
  { name: "bump then reset path", cells: { [SPIKE_ACTIVE_FLAG]: 0x00, [FIRE_GATE]: 0x00, [TIMED_OBJECT_COUNT]: 0x00, [INPUT_DEBOUNCED]: 0x00 }, x: 0xff },
  { name: "bump then tail reseed", cells: { [SPIKE_ACTIVE_FLAG]: 0x00, [FIRE_GATE]: 0x01, [INPUT_DEBOUNCED]: 0x20, [STATUS_FLAGS]: 0x80, [DSW1_SNAPSHOT]: 0x40 }, x: 0xff },
];

test("EXIT-X: positive-arm timer bump -- returned [X, Y] and RAM equal on the spike, reset and tail exits", () => {
  for (const { name, cells, x } of EXIT_X_SEEDS) {
    const seed = (m) => {
      for (const [a, v] of [[PLAYER_FINE_ANGLE, 0x00], [loc_455, 0x01], [loc_42, 0x20], [loc_40, 0x05]]) m.mem.write8(a, v);
      for (const [a, v] of Object.entries(cells)) m.mem.write8(+a, v);
      m.regs.x = 0xff; m.regs.y = 0x4d;
    };
    const o = new Machine(ROM, OPTS); seed(o);
    const c = new Machine(ROM, OPTS); seed(c);
    oracle(o); c.regs.x = 0x33; c.regs.y = 0xcc;
    assert.equal(o.regs.x, x, `${name}: positive control -- the oracle's exit X`);
    const bumped = GAME_MODE + 5; // loc_40 = 5 indexes STATUS_FLAGS
    assert.equal(o.mem.read8(bumped), ((cells[bumped] ?? 0) + 1) & 0xff, `${name}: positive control -- the timer bump ran`);
    assert.deepEqual(ageShotsAndAdvanceFrameClock(c, 0xff, 0x4d), [o.regs.x, o.regs.y], `${name}: returned exit [X, Y]`);
    assert.equal(ramDiff(o, c), null, `${name}: RAM equal`);
  }
});

test("TEETH: a twin that skips the negative arm's work diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedNegative(o);
  const c = new Machine(ROM, OPTS); seedNegative(c);
  oracle(o);
  const brokenA504 = (_m) => { /* BUG: neither ages the table nor advances the counter/tail */ };
  brokenA504(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped work");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, ageShotsAndAdvanceFrameClock, TARGET, m);
  assert.equal(r.placeable, true, `ageShotsAndAdvanceFrameClock must be seam-placeable; got: ${r.error}`);
});
