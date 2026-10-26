// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for commitPromotedObjectsAndClearHelpScreenOnCountdown (Pooyan) — countdown-gated promoted-object commit.
 *
 * Decrements PENDING_OBJECT_COUNTDOWN and returns while it is still nonzero. On the tick it reaches
 * zero it walks the 11 stride-3 records at PROMOTED_OBJECT_LIST: each record whose pointer high byte
 * (offset 1) is nonzero stores its value byte (offset 2) six bytes past the little-endian pointer it
 * holds (offsets 0,1). Then it sets PLAY_STATE_INDEX := 4 and enqueues five help-clear display
 * commands 0x06ab..0x06af, the last of which tails into the sprite-display-list rebuild.
 *
 * The routine takes NO register inputs (the oracle seats iy/de/b/a from constants), so every case is
 * a memory poke. Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH so
 * the oracle's push/ret drop out of the diff. Ring slots are seated free so the enqueues write.
 *
 * Jobs: 1. EQUAL across the early-return, active-store, and inactive-skip branches; 2. WRITE-SET
 * (countdown / per-record target stores / play-state index / enqueued ring byte); 3. TEETH (a
 * corrupted target store is caught; the fire vs early-return branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6bb2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6bb2 as oracle } from "../../translated/loc_6bb2.js";
import { commitPromotedObjectsAndClearHelpScreenOnCountdown } from "../commitPromotedObjectsAndClearHelpScreenOnCountdown.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  PENDING_OBJECT_COUNTDOWN,
  PROMOTED_OBJECT_LIST,
  PLAY_STATE_INDEX,
  DISPLAY_CMD_RING_WRITE_PTR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; // inside STACK_SCRATCH
const STRIDE = 3;
const RING_PAGE = 0x8800;
const RING_SLOT_LOW = 0xc0;
const CMD_HI_SLOT = RING_PAGE + RING_SLOT_LOW; // where the first enqueue stores the command high byte

// Two active records point six bytes short of these observable RAM targets; the value byte lands there.
const T1 = 0x8e40;
const T2 = 0x8e58;
const V1 = 0x11;
const V2 = 0x22;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the countdown and the record table; record 0 and 2 active (to T1/T2), the rest inactive. */
function seat({ countdown = 0x01, rec0Active = true } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(PENDING_OBJECT_COUNTDOWN, countdown);

  // Clear the table, then plant records.
  for (let i = 0; i < 11; i++) {
    const rec = PROMOTED_OBJECT_LIST + i * STRIDE;
    m.mem.write8(rec, 0x00);
    m.mem.write8(rec + 1, 0x00); // hi == 0 -> inactive
    m.mem.write8(rec + 2, 0x00);
  }
  if (rec0Active) {
    const p1 = (T1 - 6) & 0xffff;
    m.mem.write8(PROMOTED_OBJECT_LIST + 0, p1 & 0xff);
    m.mem.write8(PROMOTED_OBJECT_LIST + 1, p1 >> 8);
    m.mem.write8(PROMOTED_OBJECT_LIST + 2, V1);
  }
  const p2 = (T2 - 6) & 0xffff;
  m.mem.write8(PROMOTED_OBJECT_LIST + 2 * STRIDE + 0, p2 & 0xff);
  m.mem.write8(PROMOTED_OBJECT_LIST + 2 * STRIDE + 1, p2 >> 8);
  m.mem.write8(PROMOTED_OBJECT_LIST + 2 * STRIDE + 2, V2);

  // Pre-dirty the store targets and the play-state cell so a store/clear is observable.
  m.mem.write8(T1, 0xee);
  m.mem.write8(T2, 0xee);
  m.mem.write8(PLAY_STATE_INDEX, 0x00);

  // Seat five free ring slots so all enqueues write.
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, RING_SLOT_LOW);
  for (let i = 0; i < 10; i += 2) m.mem.write8(RING_PAGE + RING_SLOT_LOW + i, 0x80);
  return m;
}

const CASES = [
  { name: "countdown still running -> early return", cfg: { countdown: 0x05 } },
  { name: "countdown hits zero -> full commit (rec0 active)", cfg: { countdown: 0x01, rec0Active: true } },
  { name: "countdown hits zero -> rec0 inactive (skip its store)", cfg: { countdown: 0x01, rec0Active: false } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: commitPromotedObjectsAndClearHelpScreenOnCountdown == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    commitPromotedObjectsAndClearHelpScreenOnCountdown(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack, incl. commit + enqueue + rebuild)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: countdown decremented; on zero, stores + play-state + ring enqueue", () => {
  // early return: only the countdown moves
  const early = seat({ countdown: 0x05 });
  oracle(early);
  assert.equal(early.mem.read8(PENDING_OBJECT_COUNTDOWN), 0x04, "countdown decremented");
  assert.equal(early.mem.read8(PLAY_STATE_INDEX), 0x00, "no play-state write while counting down");
  assert.equal(early.mem.read8(T1), 0xee, "no store while counting down");

  // full commit
  const full = seat({ countdown: 0x01, rec0Active: true });
  oracle(full);
  assert.equal(full.mem.read8(PENDING_OBJECT_COUNTDOWN), 0x00, "countdown underflows to zero");
  assert.equal(full.mem.read8(T1), V1, "active record 0 stores its value at ptr+6");
  assert.equal(full.mem.read8(T2), V2, "active record 2 stores its value at ptr+6");
  assert.equal(full.mem.read8(PLAY_STATE_INDEX), 0x04, "play-state index set to 4");
  assert.equal(full.mem.read8(CMD_HI_SLOT), 0x06, "first help-clear command high byte enqueued");

  // inactive record 0 leaves its target untouched
  const skip = seat({ countdown: 0x01, rec0Active: false });
  oracle(skip);
  assert.equal(skip.mem.read8(T1), 0xee, "inactive record 0 performs no store");
  assert.equal(skip.mem.read8(T2), V2, "active record 2 still stores");
  console.log("  WRITE-SET: countdown-- ; on zero: ptr+6 stores, PLAY_STATE:=4, ring enqueue");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted target store is CAUGHT; fire vs early-return branches differ", () => {
  const o = seat({ countdown: 0x01, rec0Active: true });
  const c = seat({ countdown: 0x01, rec0Active: true });
  oracle(o);
  commitPromotedObjectsAndClearHelpScreenOnCountdown(c);
  c.mem.write8(T1, (o.mem.read8(T1) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted target store");
  assert.equal(d.addr, T1, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // early-return vs full-commit must differ, or the countdown guard is dead
  const early = seat({ countdown: 0x05 });
  const fire = seat({ countdown: 0x01, rec0Active: true });
  oracle(early);
  oracle(fire);
  assert.notEqual(ramDiffMinusStack(early, fire), null, "early-return and full-commit branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; countdown guard load-bearing`);
});
