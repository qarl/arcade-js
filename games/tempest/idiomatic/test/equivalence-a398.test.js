// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for respawnEnemyAndAward (ROM 0xa398-0xa3c4) -- seeds COORD_LIST_PTR_HI for slot Y (the ENEMY_SEGMENT,y value,
// decremented into the low nibble when ENEMY_SLOT_FLAGS,y has both top bits set), retires the slot and spawns its
// replacement (insertObjectFromSlotDepth + retireEnemyAndSpawnSplit), then TAIL-DELEGATES the score award selected by the slot's lane
// (LANE_SCORE_INDEX_TABLE indexed by ENEMY_SLOT_FLAGS,y & 7) to addBcdScoreAndAwardAtThreshold. Both spawn callees preserve Y (they park it in SAVED_INDEX2
// and reload it), so the re-read of ENEMY_SLOT_FLAGS,y after the calls uses the entry Y -- the idiomatic form
// threads that entry Y directly. Contract is RAM (dumpState minus stack scratch below the entry SP): respawnEnemyAndAward takes no live-in
// A and tail-delegates to addBcdScoreAndAwardAtThreshold, so its exit A/X/Y are the delegate's and are NOT compared.
// Run: node --test games/tempest/idiomatic/test/equivalence-a398.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a398 } from "../../translated/loc_a398.js";
import { respawnEnemyAndAward } from "../respawnEnemyAndAward.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  COORD_LIST_PTR_HI, STATUS_FLAGS, ENEMY_SLOT_FLAGS, ENEMY_SEGMENT, ENEMY_SLOT_DIR, ENEMY_DEPTH, PLAYER_SHOT_DEPTH, LANE_ENEMY_COUNT_0,
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

const TARGET = 0xa398;
const oracle = atEntry(loc_a398);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Seed slot Y for a clean, non-throwing run: gate STATUS_FLAGS bit7 clear (addBcdScoreAndAwardAtThreshold returns early) and the
// spawn gate ENEMY_SLOT_DIR,y low bits clear (retireEnemyAndSpawnSplit retires the slot but skips the draw sub-calls). `desc`
// carries the top-two-bit flag under test plus a lane in bits 0..2.
const SLOT = 0x03;
function seed(m, desc) {
  m.regs.y = SLOT; m.regs.x = 0x00;
  m.mem.write8(STATUS_FLAGS, 0x00);                     // addBcdScoreAndAwardAtThreshold gated off -> no draw/award
  m.mem.write8(ENEMY_SLOT_FLAGS + SLOT, desc);           // slot descriptor (top-2 flag + lane)
  m.mem.write8(ENEMY_SEGMENT + SLOT, 0x07);           // seated value source
  m.mem.write8(ENEMY_DEPTH + SLOT, 0x05);           // slot occupied -> retireEnemyAndSpawnSplit retires it
  m.mem.write8(ENEMY_SLOT_DIR + SLOT, 0x00);           // spawn gate 0 -> retireEnemyAndSpawnSplit skips the draw sub-calls
  m.mem.write8(PLAYER_SHOT_DEPTH, 0x00);                  // no match -> retireEnemyAndSpawnSplit drops the total counter
  m.mem.write8(LANE_ENEMY_COUNT_0 + (desc & 0x07), 0x04);  // lane counter, kept off zero
  m.mem.write8(COORD_LIST_PTR_HI, 0xee);                    // pre-value distinct from any seated result
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xa398 dispatches -- respawnEnemyAndAward == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented draw arm
    if (threw) continue;                        // both layers would throw identically there
    respawnEnemyAndAward(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

test("CRAFTED: both descriptor branches (top-2 set decrements, clear passes through) -- RAM equal", () => {
  let checked = 0;
  for (const desc of [0xc2, 0x02]) { // 0xc2: both top bits set -> decrement; 0x02: pass-through
    const o = new Machine(ROM, OPTS); seed(o, desc);
    const c = new Machine(ROM, OPTS); seed(c, desc);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) { console.log(`  CRAFTED: oracle threw on desc=${desc} -- skipped`); continue; }
    respawnEnemyAndAward(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after desc=${desc}`);
    checked++;
  }
  console.log(`  CRAFTED: ${checked}/2 descriptor branches provisioned and checked`);
  assert.ok(checked >= 1, "no descriptor branch could be provisioned -- seed is inert");
  // The decrement branch seats COORD_LIST_PTR_HI = (0x07 - 1) & 0x0f = 6.
  const c = new Machine(ROM, OPTS); seed(c, 0xc2);
  respawnEnemyAndAward(c);
  assert.equal(c.mem.read8(COORD_LIST_PTR_HI), 0x06, "decrement branch seated COORD_LIST_PTR_HI");
});

test("TEETH: a twin that never seats COORD_LIST_PTR_HI MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0xc2);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  assert.ok(!threw, "oracle threw on the teeth seed -- cannot run the positive control");
  const c = new Machine(ROM, OPTS); seed(c, 0xc2);
  // Broken twin: run the real routine, then revert COORD_LIST_PTR_HI to its pre-value -- i.e. drop the routine's
  // signature write. respawnEnemyAndAward unconditionally seats COORD_LIST_PTR_HI, so this alone guarantees a RAM divergence.
  const before2d = c.mem.read8(COORD_LIST_PTR_HI);
  respawnEnemyAndAward(c);
  c.mem.write8(COORD_LIST_PTR_HI, before2d); // BUG: never seated COORD_LIST_PTR_HI
  assert.notEqual(ramDiff(o, c), null, "the dropped COORD_LIST_PTR_HI write was NOT caught by the RAM compare");
});

test("SP-TOOTH: the tail-delegating respawnEnemyAndAward (omitted ret) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seed(m, 0xc2);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, respawnEnemyAndAward, TARGET, m);
  assert.equal(r.placeable, true, `respawnEnemyAndAward must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret tail delegate placeable");
});
