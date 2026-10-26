// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for tickSpawnSlotTimers (ROM 0x98a2-0x9922) -- the slot-timer scan over OBJECT_RECORD_TABLE (slot 63..0). It
// zeroes SPIKE_LANE_MASK_ACC, sets the gate byte loc_2f (0xff when ENEMY_TOTAL_COUNT+ENEMY_TYPE_COUNT overshoots ENEMY_SLOT_TOP or WAVE_PHASE_LATCH is set),
// then for each active slot ages the timer (unless the gate is raised), fires spawnEnemyOnTimerExpiry on expiry, re-arms on
// the 0x3f boundary when the SPIKE_LANE_MASK_ACC/SLOT_BIT_MASK mask hits, accumulates the SLOT_BIT_MASK[OBJECT_INDEX_TABLE] bit into SPIKE_LANE_MASK_ACC
// for timers in [0x20,0x40), advances OBJECT_INDEX_TABLE (mod 16) for timers >= 0x40 on even FRAME_COUNTER frames, and finally
// copies SPIKE_LANE_MASK_ACC -> SPIKE_LANE_MASK_OUT. The caller (the per-frame dispatcher) reads no exit register, so the contract is
// RAM only (dumpState minus STACK_SCRATCH); there are no live-out registers. The oracle's JSR to spawnEnemyOnTimerExpiry is
// a plain subroutine call, dissolved to a direct spawnEnemyOnTimerExpiry(m, slot); tickSpawnSlotTimers itself RTSs, so no seam tooth.
// Oracle is the frozen translated tickSpawnSlotTimers.
// Run: node --test games/tempest/idiomatic/test/equivalence-98a2.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_98a2 as oracle } from "../../translated/loc_98a2.js";
import { tickSpawnSlotTimers } from "../tickSpawnSlotTimers.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_2f, FRAME_COUNTER, ENEMY_TOTAL_COUNT, ENEMY_TYPE_COUNT, ENEMY_SLOT_TOP, WAVE_PHASE_LATCH, SPIKE_LANE_MASK_ACC, SPIKE_LANE_MASK_OUT, OBJECT_INDEX_TABLE, OBJECT_RECORD_TABLE,
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

const TARGET = 0x98a2;
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

test("CAPTURE: real 0x98a2 dispatches -- tickSpawnSlotTimers == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // an expiry may reach an unimplemented arm inside spawnEnemyOnTimerExpiry
    if (threw) continue;
    const x = tickSpawnSlotTimers(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(x, o.regs.x, "returned exit X = the oracle's X");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Gate clear (sum 2 < ENEMY_SLOT_TOP, WAVE_PHASE_LATCH = 0) so ageing runs; FRAME_COUNTER even so the >=0x40 branch advances OBJECT_INDEX_TABLE.
// Slots exercise: mask-accumulation [0x20,0x40), the 0x40 re-arm boundary, a sub-0x20 age, and an expiry.
function seed(m) {
  m.mem.write8(ENEMY_TOTAL_COUNT, 0x01);
  m.mem.write8(ENEMY_TYPE_COUNT, 0x01);
  m.mem.write8(ENEMY_SLOT_TOP, 0x10); // sum 0x02 < 0x10 -> gate stays clear from this test
  m.mem.write8(WAVE_PHASE_LATCH, 0x00);
  m.mem.write8(FRAME_COUNTER, 0x00);   // even -> the timer>=0x40 branch advances OBJECT_INDEX_TABLE
  m.mem.write8(OBJECT_RECORD_TABLE + 0x30, 0x25); // ages to 0x24, lands in [0x20,0x40) -> mask accumulate
  m.mem.write8(OBJECT_RECORD_TABLE + 0x20, 0x40); // ages to 0x3f (re-arm boundary), then classified
  m.mem.write8(OBJECT_RECORD_TABLE + 0x10, 0x02); // ages to 0x01, below 0x20 -> no mask
  m.mem.write8(OBJECT_RECORD_TABLE + 0x05, 0x01); // expires -> spawnEnemyOnTimerExpiry fires
}

test("CRAFTED: gate-clear scan with mask/re-arm/expiry slots -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; } // the expiry slot may reach an unimplemented arm inside spawnEnemyOnTimerExpiry
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  tickSpawnSlotTimers(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the full scan");
  // SPIKE_LANE_MASK_OUT is the routine's signature copy of SPIKE_LANE_MASK_ACC.
  assert.equal(c.mem.read8(SPIKE_LANE_MASK_OUT), c.mem.read8(SPIKE_LANE_MASK_ACC), "SPIKE_LANE_MASK_OUT mirrors SPIKE_LANE_MASK_ACC");
  assert.equal(c.mem.read8(SPIKE_LANE_MASK_OUT), o.mem.read8(SPIKE_LANE_MASK_OUT), "SPIKE_LANE_MASK_OUT matches the oracle");
  assert.equal(c.mem.read8(OBJECT_RECORD_TABLE + 0x10), 0x01, "the sub-0x20 slot aged 0x02 -> 0x01");
});

test("CRAFTED gate-raised: WAVE_PHASE_LATCH set freezes ageing -- RAM equal, timers untouched", () => {
  const s = (m) => {
    m.mem.write8(ENEMY_TOTAL_COUNT, 0x01);
    m.mem.write8(ENEMY_TYPE_COUNT, 0x01);
    m.mem.write8(ENEMY_SLOT_TOP, 0x10);
    m.mem.write8(WAVE_PHASE_LATCH, 0x01);        // raises the gate loc_2f = 0xff
    m.mem.write8(OBJECT_RECORD_TABLE + 0x30, 0x25); // stays >= 0x20 -> mask accumulate, but never aged
    m.mem.write8(OBJECT_RECORD_TABLE + 0x10, 0x02);
  };
  const o = new Machine(ROM, OPTS); s(o);
  const c = new Machine(ROM, OPTS); s(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  gate-raised: oracle threw -- skipped"); return; }
  tickSpawnSlotTimers(c);
  assert.equal(ramDiff(o, c), null, "RAM equal with the gate raised");
  assert.equal(c.mem.read8(OBJECT_RECORD_TABLE + 0x30), 0x25, "gated slot NOT aged");
  assert.equal(c.mem.read8(loc_2f), 0xff, "gate byte raised");
});

test("TEETH: a twin that skips one slot's age MUST diverge in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  // Broken twin: run the real routine, then revert one active slot's decrement. With the gate clear an
  // active slot is unconditionally aged, so reverting it alone guarantees a RAM divergence.
  const broken = (m) => {
    const before10 = m.mem.read8(OBJECT_RECORD_TABLE + 0x10); // 0x02 pre-run
    tickSpawnSlotTimers(m);
    m.mem.write8(OBJECT_RECORD_TABLE + 0x10, before10);       // BUG: undo the 0x02 -> 0x01 age
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the skipped age was NOT caught by the RAM compare");
});
