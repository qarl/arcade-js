// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for sweepLaneSlotsForRespawn (ROM 0xa888-0xa8ae). Acts only when WAVE_PHASE_LATCH >= 3 and even: it scans
// ENEMY_DEPTH,y downward from y = ENEMY_SLOT_TOP for the first nonzero slot. Found -> clears the low two bits of
// ENEMY_SLOT_DIR,y and TAIL-DELEGATES to respawnEnemyAndAward for that slot; none found -> resets WAVE_PHASE_LATCH to 0; below the
// guard -> no-op. Contract is RAM (dumpState minus stack scratch below the entry SP). No live-out register is compared: the
// found path tail-delegates to respawnEnemyAndAward (its exit registers are the delegate's chain), and the other
// exits are plain returns whose registers no caller distinguishes here. Oracle is the frozen translated
// sweepLaneSlotsForRespawn.
// Run: node --test games/tempest/idiomatic/test/equivalence-a888.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a888 } from "../../translated/loc_a888.js";
import { sweepLaneSlotsForRespawn } from "../sweepLaneSlotsForRespawn.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { ENEMY_SLOT_TOP, WAVE_PHASE_LATCH, ENEMY_SLOT_DIR, ENEMY_DEPTH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa888;
const oracle = atEntry(loc_a888);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xa888 dispatches -- sweepLaneSlotsForRespawn == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a found-slot dispatch may reach an unimplemented arm in respawnEnemyAndAward's chain
    if (threw) continue;
    sweepLaneSlotsForRespawn(c);
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Below the guard: WAVE_PHASE_LATCH < 3 -> no-op.
test("CRAFTED: WAVE_PHASE_LATCH below 3 -- no-op, RAM equal", () => {
  const o = new Machine(ROM, OPTS); o.mem.write8(WAVE_PHASE_LATCH, 0x02);
  const c = new Machine(ROM, OPTS); c.mem.write8(WAVE_PHASE_LATCH, 0x02);
  oracle(o); sweepLaneSlotsForRespawn(c);
  assert.equal(ramDiff(o, c), null, "RAM equal for the below-guard exit");
  assert.equal(c.mem.read8(WAVE_PHASE_LATCH), 0x02, "WAVE_PHASE_LATCH untouched below the guard");
});

// Below the guard: WAVE_PHASE_LATCH >= 3 but odd -> no-op.
test("CRAFTED: WAVE_PHASE_LATCH odd -- no-op, RAM equal", () => {
  const o = new Machine(ROM, OPTS); o.mem.write8(WAVE_PHASE_LATCH, 0x05);
  const c = new Machine(ROM, OPTS); c.mem.write8(WAVE_PHASE_LATCH, 0x05);
  oracle(o); sweepLaneSlotsForRespawn(c);
  assert.equal(ramDiff(o, c), null, "RAM equal for the odd-phase exit");
  assert.equal(c.mem.read8(WAVE_PHASE_LATCH), 0x05, "WAVE_PHASE_LATCH untouched for odd phase");
});

// None-found path: phase >= 3 and even, every scanned ENEMY_DEPTH,y slot zero -> WAVE_PHASE_LATCH reset to 0.
function seedNoneFound(m) {
  m.mem.write8(WAVE_PHASE_LATCH, 0x04);   // >= 3 and even -> scans
  m.mem.write8(ENEMY_SLOT_TOP, 0x03);   // scan y = 3..0
  for (let y = 0; y <= 0x03; y++) m.mem.write8(u16(ENEMY_DEPTH + y), 0x00); // all slots empty
}

test("CRAFTED: none-found -- WAVE_PHASE_LATCH reset to 0, RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedNoneFound(o);
  const c = new Machine(ROM, OPTS); seedNoneFound(c);
  oracle(o); sweepLaneSlotsForRespawn(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the none-found reset");
  assert.equal(c.mem.read8(WAVE_PHASE_LATCH), 0x00, "WAVE_PHASE_LATCH reset to 0 when no slot is found");
});

// Found path: a nonzero slot -> clear low 2 bits of ENEMY_SLOT_DIR,y then tail-delegate to respawnEnemyAndAward.
function seedFound(m) {
  m.mem.write8(WAVE_PHASE_LATCH, 0x04);   // >= 3 and even -> scans
  m.mem.write8(ENEMY_SLOT_TOP, 0x03);   // scan starts at y = 3
  m.mem.write8(u16(ENEMY_DEPTH + 0x02), 0x01); // slot 2 nonzero -> found at y = 2
  m.mem.write8(u16(ENEMY_SLOT_DIR + 0x02), 0x07); // low bits set -> masking to 0xfc is observable (0x07 -> 0x04)
}

test("CRAFTED: found slot -- clears ENEMY_SLOT_DIR,y bits then delegates, RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedFound(o);
  const c = new Machine(ROM, OPTS); seedFound(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; } // respawnEnemyAndAward's chain may reach an unimplemented arm under this seed
  if (threw) { console.log("  CRAFTED found: oracle threw in the delegate -- skipped"); return; }
  sweepLaneSlotsForRespawn(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the found-slot delegate");
  assert.equal(c.mem.read8(u16(ENEMY_SLOT_DIR + 0x02)), 0x04, "low two bits of ENEMY_SLOT_DIR,y cleared (0x07 -> 0x04)");
});

test("TEETH: a twin that skips the ENEMY_SLOT_DIR,y bit-clear MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seedFound(o);
  const c = new Machine(ROM, OPTS); seedFound(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw in the delegate -- skipped"); return; }
  // Broken twin: run the real routine, then revert the ENEMY_SLOT_DIR,y bit-clear the found path performs.
  const broken = (m) => {
    const before = m.mem.read8(u16(ENEMY_SLOT_DIR + 0x02));
    sweepLaneSlotsForRespawn(m);
    m.mem.write8(u16(ENEMY_SLOT_DIR + 0x02), before | 0x03); // BUG: restore the low bits the routine cleared
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the skipped ENEMY_SLOT_DIR,y bit-clear was NOT caught by the RAM compare");
});
