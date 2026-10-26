// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepEnemyDepthInLaneDirection (ROM 0x9c58-0x9c62, the direction selector) -- reads the slot's segment
// (ENEMY_SLOT_FLAGS,x & 7), then delegates to the ADD path (advanceEnemyLaneDepth) when ENEMY_SLOT_DIR,x bit7 is clear or the
// SUBTRACT path (reverseEnemyLaneDepth) when it is set. Live-out is RAM (dumpState minus stack scratch below the entry SP) plus A/X.
// X is the slot index throughout (never rewritten). A is the delegate's result. The segment index is now
// threaded as an EXPLICIT arg (no register Y bridge); on the ADD path advanceEnemyLaneDepth returns [A, Y], so the
// Y live-out the seed tail reads is checked as that tuple element (settleEnemyAtTargetDepth/steerSlotCoordinate tests cover the
// deeper arms). On the advanceEnemyLaneDepth -> settleEnemyAtTargetDepth sub-path A is INCIDENTAL, so A is compared only on dispatches
// that did NOT enter settleEnemyAtTargetDepth. Oracle is the frozen translated stepEnemyDepthInLaneDirection.
// Run: node --test games/tempest/idiomatic/test/equivalence-9c58.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9c58 } from "../../translated/loc_9c58.js";
import { stepEnemyDepthInLaneDirection, reverseEnemyLaneDepth } from "../stepEnemyDepthInLaneDirection.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import {
  ENEMY_CLIMB_DELTA_LO_0, ENEMY_CLIMB_DELTA_HI_0, PLAYER_SHOT_DEPTH, ENEMY_SLOT_FLAGS, ENEMY_SLOT_DIR, ENEMY_DEPTH_LO, ENEMY_DEPTH,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9c58;
const oracle = atEntry(loc_9c58);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 4000) : [];

test("CAPTURE: real 0x9c58 dispatches -- stepEnemyDepthInLaneDirection == oracle in RAM (-stack), X always, A off the 9d06 sub-path", () => {
  let withA = 0, ram = 0, path9d06 = 0;
  for (const cap of CAPS) {
    // Run the oracle with a flag-wrapper on 0x9d06 so we can tell whether it entered that sub-call (where
    // A is incidental). The clone shares the routines Map -- copy before wrapping so we don't mutate it.
    const o = cap.clone();
    o.routines = new Map(o.routines);
    let hit9d06 = false;
    const orig = o.routines.get(0x9d06);
    if (orig) o.routines.set(0x9d06, (mm, ...a) => { hit9d06 = true; return orig(mm, ...a); });
    let threw = false;
    try { oracle(o); } catch { threw = true; } // both layers would throw identically; nothing to compare
    if (threw) continue;

    const c = cap.clone();
    stepEnemyDepthInLaneDirection(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.x, o.regs.x, "X live-out (the slot index) matches");
    ram++;
    if (hit9d06) { path9d06++; continue; } // A incidental through settleEnemyAtTargetDepth
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
    withA++;
  }
  console.log(`  CAPTURE: ${ram} RAM+X compared (${withA} also A, ${path9d06} 9d06-path RAM+X only), ${CAPS.length} total`);
});

// Seed a full stepEnemyDepthInLaneDirection entry: slot x=3, segment 2 (ENEMY_SLOT_FLAGS,x low bits), a +2 low delta. The DIRECTION comes
// from bit7 of ENEMY_SLOT_DIR,x. m.regs.y is dirtied to prove the segment index no longer flows through the
// register -- it is passed explicitly, and the add path returns it in advanceEnemyLaneDepth's [A, Y] tuple.
function seed(m, { dir }) {
  const X = 3, SEG = 2;
  m.regs.x = X; m.regs.y = 0x77;
  m.mem.write8(u16(ENEMY_SLOT_FLAGS + X), 0x02);                 // segment 2 (& 7)
  m.mem.write8(u16(ENEMY_SLOT_DIR + X), dir === "sub" ? 0x80 : 0x00); // bit7: sub vs add; low bits 0 (no a06f gate)
  m.mem.write8(u16(ENEMY_CLIMB_DELTA_LO_0 + SEG), 0x02);               // delta low
  m.mem.write8(u16(ENEMY_CLIMB_DELTA_HI_0 + SEG), 0x00);               // delta high
  m.mem.write8(u16(ENEMY_DEPTH_LO + X), 0x40);                 // coordinate low
  m.mem.write8(u16(ENEMY_DEPTH + X), 0x30);                 // coordinate high
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x05);                          // below the new hi (0x30) -> plain add path
}

test("CRAFTED: add direction (ENEMY_SLOT_DIR,x bit7 clear) takes advanceEnemyLaneDepth -- RAM, A/X, and the returned Y tuple equal", () => {
  const m = new Machine(ROM, OPTS); seed(m, { dir: "add" });
  const o = m.clone(), c = m.clone();
  oracle(o); const r = stepEnemyDepthInLaneDirection(c); // add path forwards advanceEnemyLaneDepth's [A, Y] tuple
  assert.equal(ramDiff(o, c), null, "RAM equal after the add path");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x30, "A is the new hi byte (plain-add exit)");
  assert.equal(c.regs.x, o.regs.x, "X preserved");
  assert.equal(c.regs.x, 3, "X is the slot index");
  assert.equal(r[1], o.regs.y, "returned Y (the seed-tail live-out) matches the oracle's Y");
  assert.equal(r[1], 2, "returned Y is the segment index threaded through");
  assert.equal(c.mem.read8(u16(ENEMY_DEPTH_LO + 3)), 0x42, "coordinate low moved UP by the delta (0x40 -> 0x42)");
});

test("CRAFTED: sub direction (ENEMY_SLOT_DIR,x bit7 set) takes reverseEnemyLaneDepth -- RAM and A/X equal", () => {
  const m = new Machine(ROM, OPTS); seed(m, { dir: "sub" });
  const o = m.clone(), c = m.clone();
  oracle(o); stepEnemyDepthInLaneDirection(c); // sub path forwards reverseEnemyLaneDepth's A; its Y is not a live-out (no consumer reads it)
  assert.equal(ramDiff(o, c), null, "RAM equal after the sub path");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.equal(c.regs.a, 0x30, "A is the new hi byte (no underflow floor)");
  assert.equal(c.regs.x, o.regs.x, "X preserved");
  assert.equal(c.mem.read8(u16(ENEMY_DEPTH_LO + 3)), 0x3e, "coordinate low moved DOWN by the delta (0x40 -> 0x3e)");
});

test("TEETH: a twin that takes the WRONG direction (sub on an add seed) MUST diverge in RAM", () => {
  const m = new Machine(ROM, OPTS); seed(m, { dir: "add" });
  const o = m.clone(), c = m.clone();
  oracle(o);                 // add: coordinate low 0x40 -> 0x42
  reverseEnemyLaneDepth(c, 3, 2);         // wrong direction: 0x40 -> 0x3e
  assert.notEqual(ramDiff(o, c), null, "the wrong-direction twin was NOT caught by the RAM compare");
});
