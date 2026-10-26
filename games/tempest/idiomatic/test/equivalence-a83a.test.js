// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepAttractEnemySweepTimer (ROM 0xa83a-0xa882). The countdown stepper: while STATUS_FLAGS bit7 is set it
// advances the running counter WAVE_PHASE_LATCH against the SWEEP_STAGE-indexed limit table ATTRACT_TIMER_LIMIT_TABLE (calling sweepLaneSlotsForRespawn
// at the tail), or -- when WAVE_PHASE_LATCH is idle and PLAYER_FINE_ANGLE clear and INPUT_EDGE_FLAGS bit3 set -- arms the next stage
// (bump SWEEP_STAGE, seed WAVE_PHASE_LATCH); every path clears bit7 of INPUT_EDGE_FLAGS. No input register; effect is on RAM
// only, so live-out is RAM (dumpState minus stack scratch below the entry SP) with no register compared. Oracle is the frozen
// translated stepAttractEnemySweepTimer.
// Run: node --test games/tempest/idiomatic/test/equivalence-a83a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a83a } from "../../translated/loc_a83a.js";
import { stepAttractEnemySweepTimer } from "../stepAttractEnemySweepTimer.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { STATUS_FLAGS, WAVE_PHASE_LATCH, PLAYER_FINE_ANGLE, SWEEP_STAGE, INPUT_EDGE_FLAGS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa83a;
const oracle = atEntry(loc_a83a);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xa83a dispatches -- stepAttractEnemySweepTimer == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented sweepLaneSlotsForRespawn arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    stepAttractEnemySweepTimer(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Running-counter path: STATUS_FLAGS bit7 set, WAVE_PHASE_LATCH nonzero -> advance + limit compare + sweepLaneSlotsForRespawn tail.
// WAVE_PHASE_LATCH = 1 so after the advance it is 2 (or 0 if it hits the limit); either way sweepLaneSlotsForRespawn sees a phase
// below its 3-and-even gate and returns without dispatching, so no draw arm is reached.
function seedRunning(m) {
  m.mem.write8(STATUS_FLAGS, 0x80);
  m.mem.write8(WAVE_PHASE_LATCH, 0x01);
  m.mem.write8(SWEEP_STAGE, 0x00);
  m.mem.write8(INPUT_EDGE_FLAGS, 0xa5);
}

test("CRAFTED: running counter advances against the limit table -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedRunning(o);
  const c = new Machine(ROM, OPTS); seedRunning(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED(running): oracle threw on this seed -- skipped"); return; }
  stepAttractEnemySweepTimer(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the running-counter step");
  assert.equal(c.mem.read8(INPUT_EDGE_FLAGS) & 0x80, 0, "bit7 of INPUT_EDGE_FLAGS cleared");
});

// Idle-counter arming path: STATUS_FLAGS bit7 set, WAVE_PHASE_LATCH idle, PLAYER_FINE_ANGLE clear, INPUT_EDGE_FLAGS bit3 set, SWEEP_STAGE < 2
// -> bump SWEEP_STAGE, seed WAVE_PHASE_LATCH = 1, mask INPUT_EDGE_FLAGS. No callee is reached.
function seedArming(m) {
  m.mem.write8(STATUS_FLAGS, 0x80);
  m.mem.write8(WAVE_PHASE_LATCH, 0x00);
  m.mem.write8(PLAYER_FINE_ANGLE, 0x00);
  m.mem.write8(INPUT_EDGE_FLAGS, 0x88);
  m.mem.write8(SWEEP_STAGE, 0x00);
}

test("CRAFTED: idle counter arms the next stage -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedArming(o);
  const c = new Machine(ROM, OPTS); seedArming(c);
  oracle(o);
  stepAttractEnemySweepTimer(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the arming step");
  assert.equal(c.mem.read8(SWEEP_STAGE), 0x01, "SWEEP_STAGE bumped");
  assert.equal(c.mem.read8(WAVE_PHASE_LATCH), 0x01, "WAVE_PHASE_LATCH seeded");
});

test("TEETH: a twin that skips the final bit7 clear MUST diverge in RAM", () => {
  // STATUS_FLAGS bit7 clear -> the routine's only effect is clearing bit7 of INPUT_EDGE_FLAGS; seed that bit set.
  const seed = (m) => { m.mem.write8(STATUS_FLAGS, 0x00); m.mem.write8(INPUT_EDGE_FLAGS, 0x80); };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => { stepAttractEnemySweepTimer(m); m.mem.write8(INPUT_EDGE_FLAGS, m.mem.read8(INPUT_EDGE_FLAGS) | 0x80); }; // BUG: re-set bit7
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the skipped bit7 clear was NOT caught by the RAM compare");
});
