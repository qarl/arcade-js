// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armInteriorBandOrMarkActorActive (ROM 0x3473, Pooyan) — the interior-entry arm for the shared
 * movement tail. When the anim-armed latch is already set it marks the record (IX+1) active-1 and
 * returns. Otherwise it clears (IX+1), and — while the phase snapshot is below the cap — steps the
 * phase, looks it up in a ROM row table to seed the turn-column limit, stamps the 2x2 interior sprite
 * band, raises the anim-armed latch, and falls into the shared despawn/movement tail (despawnActorAndRenderStageCountdown). At
 * or above the cap it skips straight to that tail.
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles are NOT compared, and there is NO register/flag live-out — every exit
 * is either the render-only tail or a bare return of a record-dispatch handler. The oracle's
 * rst-0x20 lookup and tail call/push/ret land inside STACK_SCRATCH.
 *
 * Jobs:
 *   1. EQUAL (crafted) — latch-already-set (exit A), capped (exit B, straight to the tail), and
 *      below-cap (exit C, table lookup + band + latch + tail) cases: oracle == armInteriorBandOrMarkActorActive in RAM (−stack).
 *   2. WRITE-SET — the latch-set exit's ONLY write is (IX+1) := 1 (its exact footprint).
 *   3. TEETH — a wrong sprite-band tile (exit C) and a wrong (IX+1) byte (exit A) are each caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3473.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3473 as oracle } from "../../translated/loc_3473.js";
import { armInteriorBandOrMarkActorActive } from "../armInteriorBandOrMarkActorActive.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ANIM_ARMED_LATCH,
  SPAWN_PHASE_SNAPSHOT,
  TURN_COLUMN_LIMIT,
  SPRITE_BAND_86E3,
  ACTIVE_ENEMY_COUNT,
  STAGE_COUNTDOWN,
  PLAY_STATE_INDEX,
  PLAY_MODE_LATCH,
  SPAWN_PHASE_COUNTER,
  HUD_STAGE_DIGIT_LO,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX_BASE = 0x8b00; //   work-RAM record base (its band-blank stays clear of the seeded cells)
const REC_ACTIVE = 0x01; //  (IX+1) offset for the active flag
const ROW_STRIDE = 0x20; //  band row pitch
const DIRT = 0xaa; //        sentinel so every real write is observable

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const BAND_CELLS = [
  SPRITE_BAND_86E3,
  (SPRITE_BAND_86E3 + 1) & 0xffff,
  (SPRITE_BAND_86E3 + ROW_STRIDE) & 0xffff,
  (SPRITE_BAND_86E3 + ROW_STRIDE + 1) & 0xffff,
];

/** A fresh clone: latch + phase snapshot seated, IX record cleared, tail inputs + band pre-dirtied. */
function craft(latch, phase) {
  const m = BASE.clone();
  m.mem.write8(ANIM_ARMED_LATCH, latch & 0xff);
  m.mem.write8(SPAWN_PHASE_SNAPSHOT, phase & 0xff);
  m.mem.write8((IX_BASE + REC_ACTIVE) & 0xffff, DIRT);
  m.mem.write8(TURN_COLUMN_LIMIT, DIRT);
  for (const cell of BAND_CELLS) m.mem.write8(cell, DIRT);
  // shared-tail (despawnActorAndRenderStageCountdown) inputs, seated identically on both sides
  m.mem.write8(ACTIVE_ENEMY_COUNT, 0x05);
  m.mem.write8(STAGE_COUNTDOWN, 0x05);
  m.mem.write8(PLAY_STATE_INDEX, 0x00);
  m.mem.write8(PLAY_MODE_LATCH, 0x00);
  m.mem.write8(SPAWN_PHASE_COUNTER, 0x02);
  m.mem.write8(HUD_STAGE_DIGIT_LO, DIRT);
  m.mem.write8((HUD_STAGE_DIGIT_LO + ROW_STRIDE) & 0xffff, DIRT);
  m.regs.ix = IX_BASE;
  m.regs.sp = 0x8fe0; // deep in STACK_SCRATCH: the rst-0x20 lookup + tail call/push/ret stay inside
  return m;
}

// [latch, phase, label]
const CASES = [
  [0x01, 0x00, "exit A: latch already set -> mark (IX+1)=1, return"],
  [0x07, 0x05, "exit A: latch nonzero (7) short-circuits regardless of phase"],
  [0x00, 0x07, "exit B: latch clear, phase at cap -> straight to the tail"],
  [0x00, 0x0c, "exit B: latch clear, phase above cap"],
  [0x00, 0x03, "exit C: latch clear, phase below cap -> lookup + band + latch + tail"],
  [0x00, 0x00, "exit C: phase 0 -> inc to 1, lookup index 1"],
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted latch/phase cases — armInteriorBandOrMarkActorActive == oracle in RAM (−stack)", () => {
  for (const [latch, phase, label] of CASES) {
    const o = craft(latch, phase);
    const c = craft(latch, phase);
    oracle(o);
    armInteriorBandOrMarkActorActive(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the latch-set exit writes exactly (IX+1) := 1", () => {
  const cell = (IX_BASE + REC_ACTIVE) & 0xffff;
  const before = craft(0x01, 0x00);
  const after = craft(0x01, 0x00);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push({ addr, to: a1[off] });
    }
  }
  assert.equal(changed.length, 1, `expected exactly 1 written cell, got ${changed.length}`);
  assert.equal(changed[0].addr, cell, `write must be at ${hx(cell)}`);
  assert.equal(changed[0].to, REC_ACTIVE, "(IX+1) must be set to 1");
  console.log(`  WRITE-SET: latch-set exit writes only ${hx(cell)} := 1`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong sprite-band tile (exit C) is CAUGHT by the RAM diff", () => {
  const o = craft(0x00, 0x03);
  const c = craft(0x00, 0x03);
  oracle(o);
  armInteriorBandOrMarkActorActive(c);
  c.mem.write8(SPRITE_BAND_86E3, (c.mem.read8(SPRITE_BAND_86E3) ^ 0x01) & 0xff); // BUG
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong band tile — it is worthless");
  assert.equal(d.addr, SPRITE_BAND_86E3, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/band: wrong band tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong (IX+1) byte (exit A) is CAUGHT by the RAM diff", () => {
  const cell = (IX_BASE + REC_ACTIVE) & 0xffff;
  const o = craft(0x01, 0x00);
  const c = craft(0x01, 0x00);
  oracle(o);
  armInteriorBandOrMarkActorActive(c);
  c.mem.write8(cell, 0x00); // BUG: the latch-set exit must leave (IX+1) = 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong (IX+1) byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/rec: wrong (IX+1) byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
