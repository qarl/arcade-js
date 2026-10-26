// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearShotTableAndStateFlags (ROM 0x926f) -- zeros the 7-byte block $2df..$2e5 then clears the seven
// flag cells $108,$109,$145,$142,$144,$143,$146. Live-out is RAM only (A/X are loop scratch no caller
// reads), so every arm compares RAM (-stack). Pure leaf (no dispatch): the seam completes it by omitting
// the ROM ret. No POKEY reads. Seeds pre-dirty the cells so the clear (and its absence in the mutant) is
// observable.
// Run: node --test games/tempest/idiomatic/test/equivalence-926f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_926f } from "../../translated/loc_926f.js";
import { clearShotTableAndStateFlags } from "../clearShotTableAndStateFlags.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { ENEMY_TOTAL_COUNT, ENEMY_TYPE_COUNT, LANE_ENEMY_COUNT_3, LANE_ENEMY_COUNT_0, LANE_ENEMY_COUNT_2, LANE_ENEMY_COUNT_1, LANE_ENEMY_COUNT_4 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x926f;
const FLAGS = [ENEMY_TOTAL_COUNT, ENEMY_TYPE_COUNT, LANE_ENEMY_COUNT_3, LANE_ENEMY_COUNT_0, LANE_ENEMY_COUNT_2, LANE_ENEMY_COUNT_1, LANE_ENEMY_COUNT_4];
const oracle = atEntry(loc_926f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x926f dispatches -- clearShotTableAndStateFlags == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); clearShotTableAndStateFlags(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Pre-dirty every touched cell so the clear is a visible change on both arms.
function seedDirty(m) {
  for (let a = 0x02df; a <= 0x02e5; a++) m.mem8[a] = 0x5a;
  for (const a of FLAGS) m.mem8[a] = 0x99;
}

test("CRAFTED: array + all seven flag cells cleared to zero == oracle (RAM -stack)", () => {
  const o = new Machine(ROM, OPTS); seedDirty(o);
  const c = new Machine(ROM, OPTS); seedDirty(c);
  oracle(o); clearShotTableAndStateFlags(c);
  assert.equal(ramDiff(o, c), null, "cleared block + flags match oracle");
  // Independent confirmation the fields actually went to zero.
  for (let a = 0x02df; a <= 0x02e5; a++) assert.equal(c.mem8[a], 0x00, `array ${a.toString(16)} cleared`);
  for (const a of FLAGS) assert.equal(c.mem8[a], 0x00, `flag ${a.toString(16)} cleared`);
});

test("TEETH: a rewrite that skips clearing $146 diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedDirty(o); // $146 seeded 0x99 (non-default so the skip bites)
  const c = new Machine(ROM, OPTS); seedDirty(c);
  oracle(o);
  const brokenSkip146 = (m) => { // BUG: clears the array and six flags but leaves $146 dirty
    for (let x = 0x06; x >= 0; x--) m.mem8[(0x02df + x) & 0xffff] = 0x00;
    for (const a of [ENEMY_TOTAL_COUNT, ENEMY_TYPE_COUNT, LANE_ENEMY_COUNT_3, LANE_ENEMY_COUNT_0, LANE_ENEMY_COUNT_2, LANE_ENEMY_COUNT_1]) m.mem8[a] = 0x00;
  };
  brokenSkip146(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped $146 clear");
});
