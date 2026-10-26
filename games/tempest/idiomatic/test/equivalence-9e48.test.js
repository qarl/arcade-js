// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for fireHitOnPlayerCollision (ROM 0x9e48-0x9e5b) -- a collision test that calls $a343 only when a
// slot's coords match the player's ($02df,x==$0202 and $02b9,x==$0200). The idiomatic side dissolves the
// jsr $a343 into a direct insertObjectHeadTag9(m, x) call. Effect is memory-only, so each arm compares RAM (dumpState
// minus stack scratch below the entry SP); registers are not asserted (the dissolved callee leaves them per its own contract).
// Run: node --test games/tempest/idiomatic/test/equivalence-9e48.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9e48 } from "../../translated/loc_9e48.js";
import { fireHitOnPlayerCollision } from "../fireHitOnPlayerCollision.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { PLAYER_SEGMENT, PLAYER_SHOT_DEPTH, ENEMY_SEGMENT, ENEMY_DEPTH, OBJECT_ANIM_PHASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9e48;
const oracle = atEntry(loc_9e48);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9e48 dispatches -- fireHitOnPlayerCollision == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); fireHitOnPlayerCollision(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Both coords match on slot 0 -> jsr $a343 fires on both arms.
function seedMatch(m) {
  m.regs.x = 0; m.regs.y = 0;
  m.mem.write8(ENEMY_DEPTH, 0x55); m.mem.write8(PLAYER_SHOT_DEPTH, 0x55); // axis-one match (player hi coord)
  m.mem.write8(ENEMY_SEGMENT, 0x22); m.mem.write8(PLAYER_SEGMENT, 0x22); // axis-two match (segment)
  m.mem.write8(OBJECT_ANIM_PHASE, 0x00);                              // clear the tag cell the callee seeds
}

test("CRAFTED (call path): both coords matching -- fireHitOnPlayerCollision == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedMatch(o);
  const c = new Machine(ROM, OPTS); seedMatch(c);
  oracle(o); fireHitOnPlayerCollision(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the $a343 call");
  assert.equal(c.mem.read8(OBJECT_ANIM_PHASE), 0x09, "$a343 seeded $013b with its entry tag 0x09");
});

// Bail paths: axis-one mismatch, axis-two mismatch. No sub-call fires.
function seedMiss1(m) { seedMatch(m); m.mem.write8(PLAYER_SHOT_DEPTH, 0xaa); } // axis-one differs
function seedMiss2(m) { seedMatch(m); m.mem.write8(PLAYER_SEGMENT, 0xaa); } // axis-two differs

for (const [name, seed] of [["axis-one mismatch", seedMiss1], ["axis-two mismatch", seedMiss2]]) {
  test(`CRAFTED (bail): ${name} -- RAM equal, $013b untouched`, () => {
    const o = new Machine(ROM, OPTS); seed(o);
    const c = new Machine(ROM, OPTS); seed(c);
    const before = c.mem.read8(OBJECT_ANIM_PHASE);
    oracle(o); fireHitOnPlayerCollision(c);
    assert.equal(ramDiff(o, c), null, "RAM equal on the bail path");
    assert.equal(c.mem.read8(OBJECT_ANIM_PHASE), before, "$013b unchanged (no $a343)");
  });
}

test("TEETH: a twin that skips the call on a matching seed diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedMatch(o);
  const c = new Machine(ROM, OPTS); seedMatch(c);
  oracle(o); // calls $a343
  const brokenSkip = (_m) => { /* BUG: never calls $a343 */ };
  brokenSkip(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped $a343 call");
});

test("TEETH: a twin that calls $a343 on a mismatch seed diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedMiss1(o);
  const c = new Machine(ROM, OPTS); seedMiss1(c);
  oracle(o); // bails: leaves state untouched
  const brokenFire = (m) => { m.mem.write8(OBJECT_ANIM_PHASE, 0x09); }; // BUG: seeds the $a343 tag despite a mismatch
  brokenFire(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the unconditional call");
});

test("SP-TOOTH: the omitted-ret caller is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seedMiss1(m); // bail path keeps the tooth deterministic
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, fireHitOnPlayerCollision, TARGET, m);
  assert.equal(r.placeable, true, `fireHitOnPlayerCollision must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller placeable");
});
