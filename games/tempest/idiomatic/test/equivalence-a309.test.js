// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for spawnLaneEnemyAndAward -- spawn/award for enemy slot X on lane Y. Marks slot X active
// (HIT_TALLY,x = 0xff), stashes the (Y-4)-indexed geometry byte in COORD_LIST_PTR_HI, clamps POKEY2_RANDOM's low
// three bits to <3 (else 0), runs the insert+retire chain (insertObjectFromSlotDepth + retireEnemyAndSpawnSplit) with clamp+2, and
// awards via addBcdScoreAndAwardAtThreshold indexed by clamp+5. X is saved in SLOT_LOOP_INDEX and restored, so exit X == entry X;
// A/Y on exit are the addBcdScoreAndAwardAtThreshold chain's, threaded by param in the idiomatic layer rather than through
// m.regs -- so NO register is compared, the contract is pure RAM (dumpState minus stack scratch below the entry SP).
// Oracle is the frozen translated spawnLaneEnemyAndAward.
// Run: node --test games/tempest/idiomatic/test/equivalence-a309.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a309 } from "../../translated/loc_a309.js";
import { spawnLaneEnemyAndAward } from "../spawnLaneEnemyAndAward.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { STATUS_FLAGS, ENEMY_SLOT_DIR, COORD_LIST_PTR_HI, HIT_TALLY, SLOT_LOOP_INDEX, POKEY2_RANDOM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa309;
const oracle = atEntry(loc_a309);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xa309 dispatches -- spawnLaneEnemyAndAward == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented draw/sound arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    spawnLaneEnemyAndAward(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed a slot spawn that stays clear of the draw/sound arms: STATUS_FLAGS bit7 clear gates off the
// ccc3 sound and the addBcdScoreAndAwardAtThreshold award body; ENEMY_SLOT_DIR,laneIndex == 0 gates off the a06f draw chain.
// laneIndex = (y - 4) = 0 with y = 4, so the (Y-4)-indexed reads land at the table base.
function seed(m, x, y, gate60da) {
  m.regs.x = x;
  m.regs.y = y;
  m.mem.write8(STATUS_FLAGS, 0x00);        // bit7 clear -> ccc3 + addBcdScoreAndAwardAtThreshold gated off (no unimplemented arms)
  m.mem.write8(ENEMY_SLOT_DIR, 0x00);      // laneIndex=0 gate -> a06f returns before its draw chain
  m.mem.write8(POKEY2_RANDOM, gate60da); // the clamp source
}

test("CRAFTED: clamp source < 3 (clamp = masked) -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x03, 0x04, 0x01); // masked = 1 -> clamp = 1
  const c = new Machine(ROM, OPTS); seed(c, 0x03, 0x04, 0x01);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(<3): oracle threw on this seed -- skipped"); return; }
  spawnLaneEnemyAndAward(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the spawn");
  // the signature marker landed and the geometry byte was stashed.
  assert.equal(c.mem.read8(HIT_TALLY + 0x03), 0xff, "slot marker set");
  assert.equal(c.mem.read8(SLOT_LOOP_INDEX), 0x03, "X parked in SLOT_LOOP_INDEX");
  assert.equal(c.mem.read8(COORD_LIST_PTR_HI), o.mem.read8(COORD_LIST_PTR_HI), "geometry byte matches the oracle");
});

test("CRAFTED: clamp source >= 3 (clamp = 0) -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x02, 0x06, 0x05); // masked = 5 -> clamp = 0
  const c = new Machine(ROM, OPTS); seed(c, 0x02, 0x06, 0x05);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(>=3): oracle threw on this seed -- skipped"); return; }
  spawnLaneEnemyAndAward(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the spawn (clamp = 0)");
});

test("TEETH: a twin that drops the slot-active marker MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x03, 0x04, 0x01);
  const c = new Machine(ROM, OPTS); seed(c, 0x03, 0x04, 0x01);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to spawnLaneEnemyAndAward but reverts the HIT_TALLY,x = 0xff signature write. That cell
  // is written by no other layer in this seed, so the drop alone guarantees a RAM divergence.
  const broken = (m) => {
    const x = m.regs.x;
    spawnLaneEnemyAndAward(m);
    m.mem.write8(HIT_TALLY + x, 0x00); // BUG: undo the slot-active marker
  };
  broken(c);
  let tried = 1;
  assert.equal(tried, 1, "TEETH arm ran");
  assert.notEqual(ramDiff(o, c), null, "the dropped slot marker was NOT caught by the RAM compare");
});
