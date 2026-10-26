// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for runObjectMotionScripts -- when PLAYER_FINE_ANGLE>=0, walks slots SLOT_LOOP_INDEX=ENEMY_SLOT_TOP..0 running a per-entry motion
// pass through dispatchSlotMotionHandler (MOTION_SCRIPT_TABLE-indexed) and storing SCRIPT_CURSOR back to ENEMY_SCRIPT_CURSOR,x; then signed-accumulates
// ENEMY_ANIM_DELTA into ENEMY_ANIM_ACCUM (cd06/cd02 on a sign flip) and negates ENEMY_ANIM_DELTA when ENEMY_ANIM_ACCUM leaves [0x0f,0xc0].
// Contract: RAM (dumpState minus stack scratch below the entry SP). Oracle = frozen translated/loc_9b1e.js.
// Run: node --test games/tempest/idiomatic/test/equivalence-9b1e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9b1e } from "../../translated/loc_9b1e.js";
import { runObjectMotionScripts } from "../runObjectMotionScripts.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import {
  SLOT_LOOP_INDEX, SCRIPT_WALK_CONTINUE, SCRIPT_CURSOR, ENEMY_SLOT_TOP, LANE_ENEMY_COUNT_1, ENEMY_ANIM_DELTA, ENEMY_ANIM_ACCUM, PLAYER_FINE_ANGLE, ENEMY_SCRIPT_CURSOR, ENEMY_DEPTH, MOTION_SCRIPT_TABLE,
  STATUS_FLAGS, loc_31, loc_32,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9b1e;
const oracle = atEntry(loc_9b1e);
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9b1e dispatches -- runObjectMotionScripts == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a real dispatch may reach an unimplemented arm inside dispatchSlotMotionHandler
    const [x, y] = runObjectMotionScripts(c);
    assert.equal(ramDiff(o, c), null);
    assert.deepEqual([x, y], [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// PLAYER_FINE_ANGLE negative -> the outer walk is skipped, isolating the tail accumulate + clamp (no dispatchSlotMotionHandler).
test("CRAFTED (tail): accumulate ENEMY_ANIM_DELTA into ENEMY_ANIM_ACCUM + negate in-band -- RAM equal", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x80);  // negative -> skip the walk
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x10);
    m.mem.write8(ENEMY_ANIM_DELTA, 0x05);  // sum 0x15, both positive -> no sign flip; 0x15 in [0x0f,0xc0] -> negate
    m.mem.write8(LANE_ENEMY_COUNT_1, 0x00);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); runObjectMotionScripts(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the tail");
  assert.equal(c.mem.read8(ENEMY_ANIM_ACCUM), 0x15, "ENEMY_ANIM_ACCUM = 0x10 + 0x05");
  assert.equal(c.mem.read8(ENEMY_ANIM_DELTA), 0xfb, "ENEMY_ANIM_DELTA negated (0x05 -> 0xfb) since ENEMY_ANIM_ACCUM is in-band");
});

// ENEMY_ANIM_ACCUM out of band (< 0x0f) -> no negate.
test("CRAFTED (tail, out-of-band): ENEMY_ANIM_ACCUM < 0x0f leaves ENEMY_ANIM_DELTA unchanged -- RAM equal", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x80);
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x02);
    m.mem.write8(ENEMY_ANIM_DELTA, 0x05);  // sum 0x07 < 0x0f -> no negate
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); runObjectMotionScripts(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.mem.read8(ENEMY_ANIM_DELTA), 0x05, "ENEMY_ANIM_DELTA unchanged (ENEMY_ANIM_ACCUM 0x07 below the band)");
});

// The outer walk: one slot with ENEMY_DEPTH,x nonzero drives dispatchSlotMotionHandler via the MOTION_SCRIPT_TABLE table. Skip-on-throw
// if dispatchSlotMotionHandler reaches an unimplemented arm on this seed.
test("CRAFTED (walk): one active slot runs the dispatchSlotMotionHandler pass -- RAM equal (skip on oracle throw)", () => {
  const seed = (m) => {
    m.mem.write8(PLAYER_FINE_ANGLE, 0x00);                 // >= 0 -> walk runs
    m.mem.write8(ENEMY_SLOT_TOP, 0x00);                 // one slot (SLOT_LOOP_INDEX = 0)
    m.mem.write8(u16(ENEMY_DEPTH + 0x00), 0x40);     // slot 0 active
    m.mem.write8(u16(ENEMY_SCRIPT_CURSOR + 0x00), 0x00);     // cursor start
    m.mem.write8(u16(MOTION_SCRIPT_TABLE + 0x00), 0x00);    // table entry -> dispatchSlotMotionHandler index 0 (a benign handler)
    m.mem.write8(ENEMY_ANIM_DELTA, 0x00);                 // no accumulate delta
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x20);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED (walk): oracle hit an unimplemented dispatchSlotMotionHandler arm -- skipped"); return; }
  runObjectMotionScripts(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the walk + tail");
});

// R37: each tail sound cue reaches the loader, which stashes X/Y in loc_31/loc_32. With sound enabled, the
// walk running over empty slots (X left at 0) and both sign flips, the port must hand the loader the ROM's
// X (the walk's last index) and Y (the sum), never the register file: poison m.regs on the idiomatic side.
test("STALE-REGS: both tail cues stash the oracle's X/Y with m.regs poisoned on the idiomatic side", () => {
  for (const [acc, delta, lanes, cue] of [[0x08, 0x7c, 0x00, "cueSpikeCollisionSound"], [0xf8, 0x10, 0x01, "requestMotionFlipSound"]]) {
    const seed = (m) => {
      m.mem.write8(STATUS_FLAGS, 0x80);       // sound enabled
      m.mem.write8(PLAYER_FINE_ANGLE, 0x00);  // the walk runs
      m.mem.write8(ENEMY_SLOT_TOP, 0x04);
      for (let i = 0; i <= 4; i++) m.mem.write8((ENEMY_DEPTH + i) & 0xffff, 0x00); // no occupied slot
      m.mem.write8(ENEMY_ANIM_ACCUM, acc);
      m.mem.write8(ENEMY_ANIM_DELTA, delta);
      m.mem.write8(LANE_ENEMY_COUNT_1, lanes);
      m.mem.write8(loc_31, 0x11); m.mem.write8(loc_32, 0x22);
      m.regs.x = 0x3c; m.regs.y = 0x4d;
    };
    const o = new Machine(ROM, OPTS); seed(o);
    const c = new Machine(ROM, OPTS); seed(c);
    c.regs.x = 0xa5; c.regs.y = 0x5a;
    oracle(o); const [x, y] = runObjectMotionScripts(c, 0x3c);
    assert.equal(ramDiff(o, c), null, `${cue}: RAM equal with m.regs poisoned`);
    assert.notEqual(o.mem.read8(loc_32), 0x22, `${cue}: positive control -- the oracle's loader stashed Y`);
    assert.deepEqual([x, y], [o.regs.x, o.regs.y], `${cue}: returned exit [X, Y] = the oracle's`);
  }
});

test("TEETH: a twin that skips the ENEMY_ANIM_ACCUM accumulate MUST diverge in RAM", () => {
  const seed = (m) => { m.mem.write8(PLAYER_FINE_ANGLE, 0x80); m.mem.write8(ENEMY_ANIM_ACCUM, 0x10); m.mem.write8(ENEMY_ANIM_DELTA, 0x05); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  // Broken twin: everything except it leaves ENEMY_ANIM_ACCUM unchanged (never adds ENEMY_ANIM_DELTA).
  const before148 = c.mem.read8(ENEMY_ANIM_ACCUM);
  runObjectMotionScripts(c);
  c.mem.write8(ENEMY_ANIM_ACCUM, before148); // BUG: revert the accumulate
  assert.notEqual(ramDiff(o, c), null, "the dropped ENEMY_ANIM_ACCUM accumulate was NOT caught");
});
