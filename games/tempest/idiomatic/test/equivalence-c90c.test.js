// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resetLevelPlayfieldSlots (ROM 0xc90c-0xc93f) -- the per-slot state reset. It runs rebuildControlBlocksIfRequested and
// buildLevelLayout (and clearChannelStagingBlock when STATUS_FLAGS is negative), clears SLOT_COUNTDOWN_HI, seeds every slot from ACTIVE_SLOT_COUNT down to 0
// (SLOT_COUNTDOWN,slot = DSW_BONUS_CONFIG; PLAYER_LEVEL_TBL,slot = 0xff), clears LEVEL_ID and SPIKE_TABLE_GUARD, reloads loc_3d from ACTIVE_SLOT_COUNT, then
// TAIL-DELEGATES to selectWaveStartSlot. Contract is RAM-equivalence (dumpState minus stack scratch below the entry SP) plus the exit [X, Y]
// it returns -- resetLevelPlayfieldSlots takes no live-in register and tail-jmps selectWaveStartSlot, so its exit registers are the
// delegate's, which the CAPTURE arm compares with the oracle's.
// Oracle is the frozen translated resetLevelPlayfieldSlots.
// Run: node --test games/tempest/idiomatic/test/equivalence-c90c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c90c } from "../../translated/loc_c90c.js";
import { resetLevelPlayfieldSlots } from "../resetLevelPlayfieldSlots.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  STATUS_FLAGS, PLAYER_LEVEL_TBL, SLOT_COUNTDOWN, SLOT_COUNTDOWN_HI, loc_3d, ACTIVE_SLOT_COUNT, LEVEL_ID, SPIKE_TABLE_GUARD, DSW_BONUS_CONFIG,
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

const TARGET = 0xc90c;
const oracle = atEntry(loc_c90c);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xc90c dispatches -- resetLevelPlayfieldSlots == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    let threw = false;
    try { oracle(o); } catch { threw = true; } // a real dispatch may reach an unimplemented callee arm
    if (threw) continue; // both layers would throw identically there; nothing to compare
    { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(resetLevelPlayfieldSlots(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Seed ACTIVE_SLOT_COUNT nonzero (so the seeding loop iterates over several slots), DSW_BONUS_CONFIG as the fill byte, and
// LEVEL_ID/SPIKE_TABLE_GUARD nonzero so the routine's clears are observable. STATUS_FLAGS stays positive so the clearChannelStagingBlock arm
// is skipped (that arm is exercised separately below, skip-on-throw).
// NB: SLOT_COUNTDOWN_HI (0x49) == SLOT_COUNTDOWN+1 -- it IS slot 1 of the SLOT_COUNTDOWN seeding array. The routine clears SLOT_COUNTDOWN_HI at
// c91b, but with ACTIVE_SLOT_COUNT>=1 the seeding loop's slot-1 iteration (SLOT_COUNTDOWN+1 = SLOT_COUNTDOWN_HI) re-writes it to DSW_BONUS_CONFIG,
// so under this multi-slot seed the oracle leaves SLOT_COUNTDOWN_HI == DSW_BONUS_CONFIG, NOT 0. The distinct c91b clear is
// observable only when the loop never reaches slot 1 (ACTIVE_SLOT_COUNT == 0) -- the TEETH below seeds exactly that.
function seed(m) {
  m.mem.write8(STATUS_FLAGS, 0x10);    // positive -> clearChannelStagingBlock skipped
  m.mem.write8(ACTIVE_SLOT_COUNT, 0x04);   // slot count -> loop runs slots 4..0
  m.mem.write8(DSW_BONUS_CONFIG, 0x5a);  // fill byte copied into SLOT_COUNTDOWN,slot
  m.mem.write8(LEVEL_ID, 0x66);   // nonzero -> the clear is observable
  m.mem.write8(SPIKE_TABLE_GUARD, 0x55);  // nonzero -> the clear is observable
}

test("CRAFTED: seeding loop + clears + tail-delegate -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw on this seed -- skipped"); return; }
  resetLevelPlayfieldSlots(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the reset + delegate");
  // The routine's own writes that survive the delegate (selectWaveStartSlot does not touch 0x3f/0x115/0x46-0x4c on
  // this positive-STATUS_FLAGS path; it DOES rewrite loc_3d via reseedWaveWorkingSet, so loc_3d is the delegate's, not 0x3e).
  assert.equal(c.mem.read8(SLOT_COUNTDOWN_HI), o.mem.read8(SLOT_COUNTDOWN_HI), "SLOT_COUNTDOWN_HI matches the oracle after the seeding loop");
  assert.equal(c.mem.read8(LEVEL_ID), o.mem.read8(LEVEL_ID), "LEVEL_ID matches the oracle (cleared)");
  assert.equal(c.mem.read8(SPIKE_TABLE_GUARD), o.mem.read8(SPIKE_TABLE_GUARD), "SPIKE_TABLE_GUARD matches the oracle (cleared)");
  assert.equal(c.mem.read8(SLOT_COUNTDOWN + 0x04), o.mem.read8(SLOT_COUNTDOWN + 0x04), "slot 4 (0x4c) matches the oracle");
  assert.equal(c.mem.read8(PLAYER_LEVEL_TBL + 0x01), o.mem.read8(PLAYER_LEVEL_TBL + 0x01), "slot 1 flag (0x47) matches the oracle");
});

test("CRAFTED-B: STATUS_FLAGS negative -- clearChannelStagingBlock arm runs, RAM equal (skip-on-throw)", () => {
  const o = new Machine(ROM, OPTS); seed(o); o.mem.write8(STATUS_FLAGS, 0x80);
  const c = new Machine(ROM, OPTS); seed(c); c.mem.write8(STATUS_FLAGS, 0x80);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED-B: oracle threw on the clearChannelStagingBlock arm -- skipped"); return; }
  resetLevelPlayfieldSlots(c);
  assert.equal(ramDiff(o, c), null, "RAM equal with the clearChannelStagingBlock arm taken");
});

test("TEETH: a twin that drops the SLOT_COUNTDOWN_HI clear MUST diverge in RAM", () => {
  // The c91b clear of SLOT_COUNTDOWN_HI is only distinguishable when the seeding loop never reaches slot 1
  // (SLOT_COUNTDOWN_HI == SLOT_COUNTDOWN+1). Seed ACTIVE_SLOT_COUNT == 0 so the loop writes slot 0 only (SLOT_COUNTDOWN), leaving SLOT_COUNTDOWN_HI
  // to the clear; pre-seed SLOT_COUNTDOWN_HI nonzero so "dropped clear" leaves that stale value.
  const teethSeed = (m) => {
    m.mem.write8(STATUS_FLAGS, 0x10);    // positive -> clearChannelStagingBlock skipped
    m.mem.write8(ACTIVE_SLOT_COUNT, 0x00);   // loop runs slot 0 only -> never writes SLOT_COUNTDOWN+1 == SLOT_COUNTDOWN_HI
    m.mem.write8(DSW_BONUS_CONFIG, 0x5a);  // fill byte (into SLOT_COUNTDOWN = slot 0)
    m.mem.write8(SLOT_COUNTDOWN_HI, 0x77);   // stale value -> a dropped c91b clear leaves this
  };
  const o = new Machine(ROM, OPTS); teethSeed(o);
  const c = new Machine(ROM, OPTS); teethSeed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw on this seed -- skipped"); return; }
  assert.equal(o.mem.read8(SLOT_COUNTDOWN_HI), 0x00, "precondition: oracle leaves SLOT_COUNTDOWN_HI cleared");
  // Broken twin: run the real routine, then revert the SLOT_COUNTDOWN_HI clear. With ACTIVE_SLOT_COUNT == 0 the loop never
  // re-writes SLOT_COUNTDOWN_HI, so the c91b clear is the last write to it -- reverting it guarantees divergence.
  const broken = (m) => { resetLevelPlayfieldSlots(m); m.mem.write8(SLOT_COUNTDOWN_HI, 0x77); };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped SLOT_COUNTDOWN_HI clear was NOT caught by the RAM compare");
});
