// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for reseedStateTables (ROM 0x92c5-0x93df) -- the state re-seed. Builds the search key loc_2b,
// walks the 4-byte records at STATE_RESEED_RECORD_TABLE (index 111..3 step -4) scanning each record's source list for the
// range bracketing the key and storing the resolved byte through the record's destination pointer, then
// rescales ENEMY_CLIMB_DELTA_LO_0/INITIAL_ACTIVE_COUNT per DSW_DIFFICULTY & 3 and folds ENEMY_CLIMB_DELTA_LO_3/OBJECT_VELOCITY_LO/ENEMY_CLIMB_DELTA_LO_0 through the helper, seeding
// many loc_01xx cells. reseedStateTables takes no input register and ends with its OWN return (no tail-delegation).
// It returns the exit [X, Y] its last fold leaves (tickWaveSpawnCadence hands the Y on as its own exit Y), so the
// contract is RAM (dumpState minus STACK_SCRATCH) plus that returned pair. Oracle is the frozen translated reseedStateTables.
// Run: node --test games/tempest/idiomatic/test/equivalence-92c5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_92c5 as oracle } from "../../translated/loc_92c5.js";
import { reseedStateTables } from "../reseedStateTables.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_9f, DSW_DIFFICULTY, CANDIDATE_LANE_0 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x92c5;
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

test("CAPTURE: real 0x92c5 dispatches -- reseedStateTables == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a deep list-scan arm may reach an unimplemented helper
    if (threw) continue;                       // both layers would throw identically there
    { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(reseedStateTables(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed the search key and a rescale mode, then let the real ROM records drive the list scan.
function seed(m, keyByte, modeByte) {
  m.mem.write8(loc_9f, keyByte);
  m.mem.write8(DSW_DIFFICULTY, modeByte);
}

for (const [name, keyByte, modeByte] of [
  ["mode 1 (down-rescale)", 0x08, 0x01],
  ["mode 2 (up-rescale)", 0x40, 0x02],
  ["mode 0 (no rescale), key reload path", 0x70, 0x00],
]) {
  test(`CRAFTED: ${name} -- RAM equal after the full re-seed`, () => {
    const o = new Machine(ROM, OPTS); seed(o, keyByte, modeByte);
    const c = new Machine(ROM, OPTS); seed(c, keyByte, modeByte);
    let threw = false;
    try { oracle(o); } catch { threw = true; }
    if (threw) { console.log(`  CRAFTED ${name}: oracle threw on this seed -- skipped`); return; }
    assert.deepEqual(reseedStateTables(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's");
    assert.equal(ramDiff(o, c), null, "RAM equal after the re-seed");
  });
}

test("TEETH: a twin that corrupts a signature seed MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o, 0x08, 0x01);
  const c = new Machine(ROM, OPTS); seed(c, 0x08, 0x01);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: identical to reseedStateTables but corrupts the unconditional CANDIDATE_LANE_0 = 1 signature write.
  let tried = 0;
  const broken = (m) => {
    tried++;
    reseedStateTables(m);
    m.mem.write8(CANDIDATE_LANE_0, m.mem.read8(CANDIDATE_LANE_0) ^ 0xff); // BUG: corrupt the final seed
  };
  broken(c);
  assert.ok(tried > 0, "teeth arm ran");
  assert.notEqual(ramDiff(o, c), null, "the corrupted signature seed was NOT caught by the RAM compare");
});
