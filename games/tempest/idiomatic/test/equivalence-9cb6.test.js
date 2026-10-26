// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for steerSlotCoordinate (ROM 0x9cb6-0x9d04) -- the per-slot(x) steering step keyed on the
// direction/flags cell ENEMY_SLOT_DIR,x bit7. bit7 set -> SUB-step (reverseEnemyLaneDepth) + maybe flip bit7; bit7 clear ->
// ADD-step (advanceEnemyLaneDepth); a common tail may seed an object via insertObjectHeadTag7. Output is RAM (dumpState minus the
// stack scratch below the entry SP); the slot register X is passed through, and A tracks the oracle's final compare
// operand on every tail exit EXCEPT the insertObjectHeadTag7 arm (there A is that callee's incidental leftover). Y
// IS a live-out into the insertObjectHeadTag7 seed arm -- the ADD step (advanceEnemyLaneDepth -> settleEnemyAtTargetDepth) leaves the scan index
// in Y and the seed stores it to SAVED_INDEX2 -- so the bit7-clear->settleEnemyAtTargetDepth->a347 path is exercised below.
// Oracle is the frozen translated/loc_9cb6.js. Reached only by indirect dispatch (no direct jsr/jmp in ROM).
// Run: node --test games/tempest/idiomatic/test/equivalence-9cb6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9cb6 } from "../../translated/loc_9cb6.js";
import { steerSlotCoordinate } from "../steerSlotCoordinate.js";
import { reverseEnemyLaneDepth, advanceEnemyLaneDepth } from "../stepEnemyDepthInLaneDirection.js";
import { insertObjectHeadTag7 } from "../insertObjectHeadTag9.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  SAVED_INDEX2, ENEMY_TOTAL_COUNT, ENEMY_TYPE_COUNT, OBJECT_ANIM_PHASE, OBJECT_ANIM_TIMER, ENEMY_ANIM_ACCUM, NEAR_DEPTH_THRESHOLD, ENEMY_CLIMB_DELTA_LO_0, ENEMY_CLIMB_DELTA_HI_0,
  PLAYER_SEGMENT, PLAYER_FINE_ANGLE, PLAYER_SHOT_DEPTH, ENEMY_SLOT_FLAGS, ENEMY_SLOT_DIR, ENEMY_SEGMENT, ENEMY_PHASE, ENEMY_DEPTH, FIRE_GATE,
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

const TARGET = 0x9cb6;
const oracle = atEntry(loc_9cb6);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0x9cb6 dispatches -- steerSlotCoordinate == oracle in RAM (-stack) and X", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) continue; // a dispatch whose deep callee the oracle can't resolve on this frame -- both would throw
    steerSlotCoordinate(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X (slot) passed through");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) checked`);
});

// --- CRAFTED arms (self-contained callee paths: reverseEnemyLaneDepth is a leaf; advanceEnemyLaneDepth seeded to its shallow
// return; insertObjectHeadTag7's chain resolves on a fresh Machine, per equivalence-a343.test.js) ---

function fresh(x) {
  const m = new Machine(ROM, OPTS);
  m.regs.x = x;
  return m;
}

test("CRAFTED: bit7 set -- FIRE_GATE==0 forces probe 0xff >= threshold -> eor #$80 flip of ENEMY_SLOT_DIR,x", () => {
  const setup = (m) => {
    m.mem.write8((ENEMY_SLOT_DIR + 0x00) & 0xffff, 0x80); // bit7 set -> SUB path
    m.mem.write8((ENEMY_DEPTH + 0x00) & 0xffff, 0x50); // hi coord; delta 0 -> reverseEnemyLaneDepth returns 0x50
    m.mem.write8((ENEMY_CLIMB_DELTA_LO_0 + 0x01) & 0xffff, 0x00);
    m.mem.write8((ENEMY_CLIMB_DELTA_HI_0 + 0x01) & 0xffff, 0x00);
    m.mem.write8(FIRE_GATE, 0x00);                    // ldy FIRE_GATE == 0 -> probe = 0xff
    m.mem.write8(NEAR_DEPTH_THRESHOLD, 0x40);                    // 0xff >= 0x40 -> flip
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x80);                    // tail bit7 set -> exit, A = 0x80
  };
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o); steerSlotCoordinate(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.x, o.regs.x, "X passed through");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8((ENEMY_SLOT_DIR + 0x00) & 0xffff), 0x00, "bit7 flipped: 0x80 ^ 0x80 = 0x00");
});

test("CRAFTED: bit7 set -- FIRE_GATE!=0, probe = reverseEnemyLaneDepth return < threshold -> bcc, no flip", () => {
  const setup = (m) => {
    m.mem.write8((ENEMY_SLOT_DIR + 0x00) & 0xffff, 0x80);
    m.mem.write8((ENEMY_DEPTH + 0x00) & 0xffff, 0x05); // reverseEnemyLaneDepth returns 0x05
    m.mem.write8((ENEMY_CLIMB_DELTA_LO_0 + 0x01) & 0xffff, 0x00);
    m.mem.write8((ENEMY_CLIMB_DELTA_HI_0 + 0x01) & 0xffff, 0x00);
    m.mem.write8(FIRE_GATE, 0x01);                    // ldy FIRE_GATE != 0 -> probe = stepped (0x05)
    m.mem.write8(NEAR_DEPTH_THRESHOLD, 0x40);                    // 0x05 < 0x40 -> bcc -> no flip
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x80);                    // tail bit7 set -> exit, A = 0x80
  };
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o); steerSlotCoordinate(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8((ENEMY_SLOT_DIR + 0x00) & 0xffff), 0x80, "no flip (bcc taken)");
});

test("CRAFTED: bit7 clear -- coord < threshold picks Y=1 -> advanceEnemyLaneDepth reads delta[1]", () => {
  const setup = (m) => {
    m.mem.write8((ENEMY_SLOT_DIR + 0x00) & 0xffff, 0x00); // bit7 clear -> ADD path
    m.mem.write8((ENEMY_DEPTH + 0x00) & 0xffff, 0x25); // 0x25 < 0x40 -> Y stays 1
    m.mem.write8(NEAR_DEPTH_THRESHOLD, 0x40);
    m.mem.write8(PLAYER_SHOT_DEPTH, 0x00);                    // floor 0 -> advanceEnemyLaneDepth hi > floor, skips settleEnemyAtTargetDepth
    m.mem.write8((ENEMY_CLIMB_DELTA_LO_0 + 0x01) & 0xffff, 0x00);
    m.mem.write8((ENEMY_CLIMB_DELTA_HI_0 + 0x01) & 0xffff, 0x02); // delta[1] hi +2
    m.mem.write8((ENEMY_CLIMB_DELTA_LO_0 + 0x00) & 0xffff, 0x00);
    m.mem.write8((ENEMY_CLIMB_DELTA_HI_0 + 0x00) & 0xffff, 0x10); // delta[0] differs -> a wrong Y would diverge in RAM
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x80);                    // tail bit7 set -> exit, A = 0x80
  };
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o); steerSlotCoordinate(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8((ENEMY_DEPTH + 0x00) & 0xffff), 0x27, "hi stepped by delta[1]: 0x25 + 0x02");
});

test("CRAFTED: bit7 clear -- coord >= threshold picks Y=0 -> advanceEnemyLaneDepth reads delta[0]", () => {
  const setup = (m) => {
    m.mem.write8((ENEMY_SLOT_DIR + 0x00) & 0xffff, 0x00);
    m.mem.write8((ENEMY_DEPTH + 0x00) & 0xffff, 0x50); // 0x50 >= 0x40 -> ldy #0 -> Y=0
    m.mem.write8(NEAR_DEPTH_THRESHOLD, 0x40);
    m.mem.write8(PLAYER_SHOT_DEPTH, 0x00);
    m.mem.write8((ENEMY_CLIMB_DELTA_LO_0 + 0x00) & 0xffff, 0x00);
    m.mem.write8((ENEMY_CLIMB_DELTA_HI_0 + 0x00) & 0xffff, 0x01); // delta[0] hi +1
    m.mem.write8((ENEMY_CLIMB_DELTA_LO_0 + 0x01) & 0xffff, 0x00);
    m.mem.write8((ENEMY_CLIMB_DELTA_HI_0 + 0x01) & 0xffff, 0x02); // delta[1] differs
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x80);                    // tail bit7 set -> exit, A = 0x80
  };
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o); steerSlotCoordinate(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.mem.read8((ENEMY_DEPTH + 0x00) & 0xffff), 0x51, "hi stepped by delta[0]: 0x50 + 0x01");
});

// The common tail with all four conditions true -> jsr insertObjectHeadTag7. Reached via the bit7-set path so no
// deep advanceEnemyLaneDepth dispatch is involved; Y at the a347 site = FIRE_GATE's value (0x01), which insertTimedObject writes.
function seedTailA347(m) {
  m.mem.write8((ENEMY_SLOT_DIR + 0x00) & 0xffff, 0x80);   // bit7 set
  m.mem.write8((ENEMY_DEPTH + 0x00) & 0xffff, 0x20);   // reverseEnemyLaneDepth returns/writes 0x20
  m.mem.write8((ENEMY_CLIMB_DELTA_LO_0 + 0x01) & 0xffff, 0x00);
  m.mem.write8((ENEMY_CLIMB_DELTA_HI_0 + 0x01) & 0xffff, 0x00);
  m.mem.write8(FIRE_GATE, 0x01);                      // probe = 0x20 (< thr) -> no flip; Y = 0x01
  m.mem.write8(NEAR_DEPTH_THRESHOLD, 0x40);                      // cond2: ENEMY_DEPTH,x (0x20) < 0x40
  m.mem.write8(ENEMY_ANIM_ACCUM, 0x00);                      // cond1: bit7 clear -> continue
  m.mem.write8(PLAYER_SEGMENT, 0x88); m.mem.write8((ENEMY_SEGMENT + 0x00) & 0xffff, 0x88); // cond3 equal
  m.mem.write8(PLAYER_FINE_ANGLE, 0x33); m.mem.write8((ENEMY_PHASE + 0x00) & 0xffff, 0x33); // cond4 equal
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x77);                      // insertObjectAndSignalReady copies PLAYER_SHOT_DEPTH
}

test("CRAFTED: common tail all four conditions match -> insertObjectHeadTag7 seeds the object (RAM + X; A dropped)", () => {
  const o = fresh(0x00); seedTailA347(o);
  const c = fresh(0x00); seedTailA347(c);
  oracle(o); steerSlotCoordinate(c);
  assert.equal(ramDiff(o, c), null, "RAM equal (incl. insertObjectHeadTag7's insert)");
  assert.equal(c.regs.x, o.regs.x, "X passed through");
  // A is NOT compared here: on the insertObjectHeadTag7 arm A is that callee-chain's incidental leftover, not a
  // reproduced live-out (insertObjectAndSignalReady ends on a mem store, leaving A as insertTimedObject/gateSound5f's last value).
  assert.equal(c.mem.read8(OBJECT_ANIM_PHASE), 0x07, "insertObjectHeadTag7 stamped the head flag 0x07");
  assert.equal(c.mem.read8(OBJECT_ANIM_TIMER), 0x01, "insertObjectHeadTag7 raised the ready flag");
  assert.equal(c.mem.read8(PLAYER_FINE_ANGLE), 0x81, "insertObjectAndSignalReady set PLAYER_FINE_ANGLE = 0x81");
});

test("CRAFTED: common tail with one condition false (PLAYER_SEGMENT != ENEMY_SEGMENT,x) -> no insertObjectHeadTag7, A = PLAYER_SEGMENT", () => {
  const setup = (m) => { seedTailA347(m); m.mem.write8((ENEMY_SEGMENT + 0x00) & 0xffff, 0x99); }; // break cond3
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o); steerSlotCoordinate(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x88, "A = PLAYER_SEGMENT (bne exit before insertObjectHeadTag7)");
  assert.equal(c.mem.read8(OBJECT_ANIM_TIMER), 0x00, "insertObjectHeadTag7 did NOT run (ready flag untouched)");
  assert.equal(c.mem.read8(PLAYER_FINE_ANGLE), 0x33, "PLAYER_FINE_ANGLE untouched (still 0x33)");
});

test("TEETH: a twin that skips the eor #$80 flip diverges from the oracle in RAM", () => {
  const setup = (m) => {
    m.mem.write8((ENEMY_SLOT_DIR + 0x00) & 0xffff, 0x80);
    m.mem.write8((ENEMY_DEPTH + 0x00) & 0xffff, 0x50);
    m.mem.write8((ENEMY_CLIMB_DELTA_LO_0 + 0x01) & 0xffff, 0x00);
    m.mem.write8((ENEMY_CLIMB_DELTA_HI_0 + 0x01) & 0xffff, 0x00);
    m.mem.write8(FIRE_GATE, 0x00);                    // probe = 0xff >= threshold -> oracle flips
    m.mem.write8(NEAR_DEPTH_THRESHOLD, 0x40);
    m.mem.write8(ENEMY_ANIM_ACCUM, 0x80);                    // tail exits immediately (no tail RAM writes)
  };
  const o = fresh(0x00); setup(o);
  const c = fresh(0x00); setup(c);
  oracle(o);
  const broken = (m, x = m.regs.x) => { reverseEnemyLaneDepth(m, x, 1); /* BUG: never performs the eor #$80 flip */ };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped bit7 flip");
});

// The wrong-Y bug path (the reason 9cb6 was deferred): bit7-CLEAR -> advanceEnemyLaneDepth enters settleEnemyAtTargetDepth because
// the stepped hi <= PLAYER_SHOT_DEPTH; settleEnemyAtTargetDepth's scan arm leaves the SCAN INDEX in Y; the common tail then seeds
// via insertObjectHeadTag7, whose chain (insertObjectAndSignalReady -> spawnClimberInFreeSlot -> insertTimedObject) stores that Y to SAVED_INDEX2. The pre-fix
// idiomatic handed a347 the pre-call steering y instead. Drive it and require SAVED_INDEX2 = the scan index.
function seedClear9d06ToA347(m) {
  m.mem.write8((ENEMY_SLOT_DIR + 0x00) & 0xffff, 0x00);   // bit7 clear -> ADD path
  m.mem.write8((ENEMY_DEPTH + 0x00) & 0xffff, 0x05);   // < NEAR_DEPTH_THRESHOLD -> steering y = 1; also the add base
  m.mem.write8(NEAR_DEPTH_THRESHOLD, 0x40);
  m.mem.write8((ENEMY_CLIMB_DELTA_LO_0 + 0x01) & 0xffff, 0x00);
  m.mem.write8((ENEMY_CLIMB_DELTA_HI_0 + 0x01) & 0xffff, 0x00);   // delta[1] = 0 -> stepped hi = 0x05
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x10);                      // hi 0x05 <= 0x10 -> enter settleEnemyAtTargetDepth; 0x10 < NEAR_DEPTH_THRESHOLD -> tail passes
  m.mem.write8(ENEMY_TYPE_COUNT, 0x01);                      // settleEnemyAtTargetDepth scan arm
  m.mem.write8(ENEMY_TOTAL_COUNT, 0x05);
  m.mem.write8((ENEMY_SLOT_FLAGS + 0x00) & 0xffff, 0x00);   // kind 0 (not 1, not negative) -> scan
  m.mem.write8((ENEMY_DEPTH + 0x06) & 0xffff, 0x10);   // slot 6 stash == shared(PLAYER_SHOT_DEPTH) -> scan matches at y = 6
  m.mem.write8((ENEMY_SLOT_FLAGS + 0x06) & 0xffff, 0x00);
  m.mem.write8(ENEMY_ANIM_ACCUM, 0x00);                      // tail cond1: bit7 clear
  m.mem.write8(PLAYER_SEGMENT, 0x88); m.mem.write8((ENEMY_SEGMENT + 0x00) & 0xffff, 0x88); // cond3 equal
  m.mem.write8(PLAYER_FINE_ANGLE, 0x33); m.mem.write8((ENEMY_PHASE + 0x00) & 0xffff, 0x33); // cond4 equal
}

test("CRAFTED (wrong-Y path): bit7-clear -> settleEnemyAtTargetDepth scan -> a347 stores the scan index to SAVED_INDEX2", () => {
  const o = fresh(0x00); seedClear9d06ToA347(o);
  const c = fresh(0x00); seedClear9d06ToA347(c);
  oracle(o); steerSlotCoordinate(c);
  assert.equal(ramDiff(o, c), null, "RAM equal incl. SAVED_INDEX2 (the a347 Y-store)");
  assert.equal(c.regs.x, o.regs.x, "X passed through");
  assert.equal(c.mem.read8(SAVED_INDEX2), o.mem.read8(SAVED_INDEX2), "SAVED_INDEX2 = the scan index Y (not the steering y)");
  assert.equal(o.mem.read8(SAVED_INDEX2), 0x06, "the oracle stored the scan index 0x06 to SAVED_INDEX2");
});

test("TEETH (wrong-Y): a twin passing the pre-call steering y to the seed diverges at SAVED_INDEX2", () => {
  const o = fresh(0x00); seedClear9d06ToA347(o);
  const c = fresh(0x00); seedClear9d06ToA347(c);
  oracle(o);
  // Broken twin = the pre-fix behaviour: run the same delegate (advanceEnemyLaneDepth -> settleEnemyAtTargetDepth), then seed with the
  // STEERING y (1) instead of the Y advanceEnemyLaneDepth left (the scan index 6). Must diverge at SAVED_INDEX2.
  const broken = (m, x = 0x00) => { advanceEnemyLaneDepth(m, x, 1); return insertObjectHeadTag7(m, x, 1); };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the wrong Y into a347 was NOT caught at SAVED_INDEX2");
});
