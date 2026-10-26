// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for sweepTargetSlotsForGrab (ROM 0x5e11) — the B-slot proximity sweep, COMPOSING the
 * dissolved caller-skip testTargetSlotGrabAndCatchObject. The idiomatic caller imports the idiomatic testTargetSlotGrabAndCatchObject and, on a
 * grab (false), early-returns to abort the sweep — reproducing the oracle skip whose `pop af; ret`
 * unwound past this routine. The oracle caller runs the TRANSLATED testTargetSlotGrabAndCatchObject internally (its pop-af
 * aborts it); the idiomatic caller runs the idiomatic testTargetSlotGrabAndCatchObject + early-returns. The two must land
 * byte-identical in RAM (−stack).
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP). There is NO register live-out — the
 * sweep is a tail delegate and its caller reloads registers before reading any — so the advanced
 * IY/HL/B and pc/SP are not compared.
 *
 * The registers are seeded exactly as the caller gateAndRunProjectileTargetSweep seeds them (IX=source list, IY=target
 * slots, HL=record table, B=3), sp inside STACK_SCRATCH. Two families of scenario are composed:
 * skip-NOT-taken (all records inert -> full sweep, no writes) and skip-taken at slot 0/1/2 (a hit
 * that must abort after writing exactly that slot). The hit at slot 1/2 also proves the idiomatic
 * loop advances IY/HL identically before it composes the skip.
 *
 * Jobs:
 *   1. EQUAL — over the no-hit sweep and a hit at each slot, oracle == sweepTargetSlotsForGrab in RAM (−stack).
 *   2. TEETH — a twin that ignores the abort (keeps sweeping) writes an extra slot the diff catches;
 *      a wrong written byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5e11.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5e11 as oracle } from "../../translated/loc_5e11.js";
import { sweepTargetSlotsForGrab } from "../sweepTargetSlotsForGrab.js";
import { testTargetSlotGrabAndCatchObject } from "../testTargetSlotGrabAndCatchObject.js";
import { Machine } from "../../machine.js";
import { u16 } from "../../../../core/int.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SPRITE_DISPLAY_LIST,
  SPRITE_TARGET_SLOTS,
  PROJECTILE_TABLE,
  GRAB_ACTIVE_FLAG,
  FLIP_SCREEN_FLAG,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT_STRIDE_REC = 0x18; // HL advances one record per slot
const SLOT_STRIDE_TGT = 0x04; // IY advances one target per slot
const hx = (v) => "0x" + (v & 0xffff).toString(16);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

const SP_SEAT = 0x8fe0; // inside STACK_SCRATCH
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SEAT);

/** A fresh clone seeded exactly as gateAndRunProjectileTargetSweep seeds the sweep, with all three records inert (state 0). */
function craft() {
  const m = BASE.clone();
  m.regs.ix = SPRITE_DISPLAY_LIST; // source coordinate list (fixed across slots)
  m.regs.iy = SPRITE_TARGET_SLOTS; // target slots (advanced +4 per slot)
  m.regs.hl = PROJECTILE_TABLE; // record table (advanced +0x18 per slot)
  m.regs.b = 0x03;
  m.regs.sp = SP_SEAT;
  // Grand-caller return slot the oracle's `pop af; ret` lands on when a hit unwinds past the sweep;
  // it must differ from the per-slot return 0x5e14 so the oracle recognises the skip and aborts.
  m.mem8[SP_SEAT] = 0xcd;
  m.mem8[SP_SEAT + 1] = 0xab;
  m.mem8[GRAB_ACTIVE_FLAG] = 0x00;
  m.mem8[GAME_ACTIVE_FLAG] = 0x00; // deterministic sound-append footprint on a hit
  m.mem8[PLAY_MODE_LATCH] = 0x00;
  m.mem8[FLIP_SCREEN_FLAG] = 0x00;
  for (let i = 0; i < 3; i++) m.mem8[PROJECTILE_TABLE + i * SLOT_STRIDE_REC] = 0x00;
  return m;
}

/** Seat a grab hit at slot `slot`: inert records before it, in-range coords at it (source fixed). */
function seatHit(m, slot) {
  m.mem8[SPRITE_DISPLAY_LIST + 0x00] = 0x09; // source x -> tx = 0x00 with flip clear
  m.mem8[SPRITE_DISPLAY_LIST + 0x02] = 0x00; // source y -> ty = 0x10
  m.mem8[PROJECTILE_TABLE + slot * SLOT_STRIDE_REC] = 0x02; // record state: not 0/5
  m.mem8[SPRITE_TARGET_SLOTS + slot * SLOT_STRIDE_TGT + 0x00] = 0x00; // target x -> dx = 0
  m.mem8[SPRITE_TARGET_SLOTS + slot * SLOT_STRIDE_TGT + 0x02] = 0x08; // target y -> dy = 0
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: no-hit full sweep — sweepTargetSlotsForGrab == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  sweepTargetSlotsForGrab(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(o.mem8[GRAB_ACTIVE_FLAG], 0x00, "no grab latched on the inert sweep");
  console.log("  EQUAL: 3-slot inert sweep identical (RAM −stack), no writes");
});

test("EQUAL: grab hit at each slot — sweepTargetSlotsForGrab == oracle in RAM (−stack), sweep aborts", () => {
  for (let slot = 0; slot < 3; slot++) {
    const o = craft();
    const c = craft();
    seatHit(o, slot);
    seatHit(c, slot);
    oracle(o);
    sweepTargetSlotsForGrab(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (hit slot ${slot})`);
    assert.equal(o.mem8[GRAB_ACTIVE_FLAG], 0x01, `grab latched on the hit at slot ${slot}`);
    // The aborted record is the one at this slot; later slots are never touched.
    const rec = PROJECTILE_TABLE + slot * SLOT_STRIDE_REC;
    assert.equal(o.mem8[rec + 0x11], 0x0a, `hit record field written at slot ${slot}`);
  }
  console.log("  EQUAL: grab hit at slot 0/1/2 identical (RAM −stack); abort + advancement match");
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a twin that ignores the abort writes an extra slot — CAUGHT by the RAM diff", () => {
  // A caller that composes the real skip but drops the early-return: it keeps sweeping past a hit.
  function nonAborting(m, rec = m.regs.hl, source = m.regs.ix, target = m.regs.iy, count = m.regs.b) {
    for (let i = 0; i < count; i++) {
      testTargetSlotGrabAndCatchObject(m, rec, source, target); // BUG: abort signal ignored
      target = u16(target + SLOT_STRIDE_TGT);
      rec = u16(rec + SLOT_STRIDE_REC);
    }
  }
  const o = craft();
  const c = craft();
  // Two consecutive hittable slots: correct aborts after slot 0, the twin continues into slot 1.
  seatHit(o, 0);
  seatHit(o, 1);
  seatHit(c, 0);
  seatHit(c, 1);
  oracle(o);
  nonAborting(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-aborting sweep — it is worthless");
  const rec1 = PROJECTILE_TABLE + 1 * SLOT_STRIDE_REC;
  assert.ok(d.addr >= rec1 && d.addr < rec1 + 0x18, `expected the extra write in slot-1's record (${hx(rec1)}), got ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/ABORT: non-aborting twin's extra slot-1 write caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong written byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  seatHit(o, 0);
  seatHit(c, 0);
  oracle(o);
  sweepTargetSlotsForGrab(c);
  const rec = PROJECTILE_TABLE; // slot-0 record
  c.mem8[rec + 0x11] = 0x00; // BUG: this record field must hold 0x0a
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record byte — it is worthless");
  assert.equal(d.addr, rec + 0x11, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(rec + 0x11)})`);
  console.log(`  TEETH/RAM: wrong record byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
