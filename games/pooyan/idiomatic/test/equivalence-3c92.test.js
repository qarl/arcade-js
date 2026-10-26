// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for spawnFormationChildIntoFreeSlotOnTimer (ROM 0x3c92, Pooyan) — object state-7 handler that ticks
 * animation then periodically spawns a child, COMPOSING the dissolved caller-skip seedFormationChildIntoFreeSlotAndLaunchParent.
 *
 * spawnFormationChildIntoFreeSlotOnTimer advances the parent's animation (advanceObjectAnimationFrame), decrements the parent frame timer (+0x11)
 * and returns while it still holds. On elapse it walks the four formation records (stride 0x18 from
 * the formation table) calling seedFormationChildIntoFreeSlotAndLaunchParent per record; the helper returns false the moment it seats a
 * child, which aborts the scan (no timer reseed this frame). If all four slots were occupied it
 * reseeds the timer to 0x10. The oracle runs the TRANSLATED advanceObjectAnimationFrame/seedFormationChildIntoFreeSlotAndLaunchParent (whose pop-af skip
 * aborts the loop); the idiomatic module imports the IDIOMATIC seedFormationChildIntoFreeSlotAndLaunchParent and early-returns on false.
 * The two must land byte-identical in RAM(-stack).
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). Each case runs the oracle on one
 * FRESH clone and spawnFormationChildIntoFreeSlotOnTimer on another and compares RAM (dumpState, minus stack scratch below the entry SP). IX (the
 * parent) is the input; SP is seated in the dead stack. NO register live-out is declared — a
 * dispatched state handler whose effects are entirely in memory; pc/SP are not compared.
 *
 * The record fields are crafted per branch: the parent's advanceObjectAnimationFrame hold (+0x0e) is nonzero so the
 * animation step just decrements, the timer (+0x11) selects hold-vs-scan, and each formation
 * record's first byte marks it occupied or free.
 *
 * Jobs (one per branch), all seating the real idiomatic seedFormationChildIntoFreeSlotAndLaunchParent:
 *   1. EQUAL — timerHold (early ret), allOccupied (full scan + reseed), skipFirst and skipThird
 *      (a slot gets seated -> the scan aborts, no reseed) all agree in RAM(−stack).
 *   2. WRITE-SET — allOccupied reseeds the timer to 0x10; skipFirst leaves the timer at 0 and seats
 *      slot 0, linking its pointer into the parent.
 *   3. TEETH — a twin that reseeds the timer on the skip path (i.e. fails to abort) is caught; a
 *      wrong seated byte is caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3c92.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3c92 as oracle } from "../../translated/loc_3c92.js";
import { spawnFormationChildIntoFreeSlotOnTimer } from "../spawnFormationChildIntoFreeSlotOnTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, FORMATION_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PARENT = 0x8a80; // an actor record base, clear of the formation records and the dead stack
const STRIDE = 0x18; // formation-record stride
const TIMER = 0x11; // parent frame-timer field
const HOLD_4006 = 0x0e; // advanceObjectAnimationFrame's own frame-hold field (nonzero => just decremented)
const SP_START = 0x8ff8; // inside STACK_SCRATCH; leaves room for the oracle's push/pop/ret chain
const DIRT = 0xaa;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const rec = (i) => (FORMATION_TABLE + i * STRIDE) & 0xffff;
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_START);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/**
 * A fresh clone with IX=parent and SP in the dead stack. `timer` seeds the frame timer (+0x11),
 * `freeSlot` marks that formation record free (all others occupied), or -1 for all occupied. The
 * parent's advanceObjectAnimationFrame hold is nonzero so the animation step just decrements, and its coordinate
 * source fields are seeded so a seated child's copies are concrete.
 */
function craft({ timer, freeSlot }) {
  const m = BASE.clone();
  m.regs.sp = SP_START;
  m.regs.ix = PARENT;
  m.mem.write8(PARENT + HOLD_4006, 0x05);
  m.mem.write8(PARENT + TIMER, timer);
  m.mem.write8(PARENT + 0x03, 0x40);
  m.mem.write8(PARENT + 0x04, 0x80);
  m.mem.write8(PARENT + 0x05, 0x30);
  m.mem.write8(PARENT + 0x06, 0x50);
  for (let i = 0; i < 4; i++) {
    m.mem.write8(rec(i) + 0x00, i === freeSlot ? 0x00 : 0x01);
    m.mem.write8(rec(i) + 0x01, 0x00);
  }
  return m;
}

const BRANCHES = {
  timerHold: { timer: 0x05, freeSlot: -1 }, // dec -> 4, still holding: no scan
  allOccupied: { timer: 0x01, freeSlot: -1 }, // dec -> 0, scan all occupied, reseed timer
  skipFirst: { timer: 0x01, freeSlot: 0 }, // slot 0 free: seat + abort (skip taken first record)
  skipThird: { timer: 0x01, freeSlot: 2 }, // slots 0,1 occupied, slot 2 free: seat + abort mid-scan
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: spawnFormationChildIntoFreeSlotOnTimer == oracle in RAM (−stack) across all branches", () => {
  for (const [name, cfg] of Object.entries(BRANCHES)) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    spawnFormationChildIntoFreeSlotOnTimer(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: timerHold / allOccupied / skipFirst / skipThird identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: allOccupied reseeds the timer; skipFirst leaves it at 0 and seats slot 0", () => {
  const occ = craft(BRANCHES.allOccupied);
  oracle(occ);
  assert.equal(occ.mem.read8(PARENT + TIMER), 0x10, "all-occupied scan reseeds the timer to 0x10");
  assert.equal(occ.mem.read8(PARENT + HOLD_4006), 0x04, "advanceObjectAnimationFrame decremented the parent hold");

  const sk = craft(BRANCHES.skipFirst);
  oracle(sk);
  assert.equal(sk.mem.read8(PARENT + TIMER), 0x00, "skip path does NOT reseed the timer");
  assert.equal(sk.mem.read8(rec(0) + 0x01), 0x01, "slot 0 seated (active marker)");
  assert.equal(sk.mem.read8(PARENT + 0x14), rec(0) & 0xff, "child pointer low linked into parent");
  assert.equal(sk.mem.read8(PARENT + 0x15), rec(0) >> 8, "child pointer high linked into parent");
  console.log("  WRITE-SET: allOccupied timer=0x10; skipFirst timer=0, slot 0 seated + linked");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a timer reseed on the skip path (failure to abort) is CAUGHT", () => {
  const o = craft(BRANCHES.skipFirst);
  const c = craft(BRANCHES.skipFirst);
  oracle(o);
  spawnFormationChildIntoFreeSlotOnTimer(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(PARENT + TIMER, 0x10); // BUG: not aborting would reseed the timer
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing scan-abort — it is worthless");
  assert.equal(d.addr, (PARENT + TIMER) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/abort: a skip-path timer reseed caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong seated byte is CAUGHT by the RAM diff", () => {
  const o = craft(BRANCHES.skipThird);
  const c = craft(BRANCHES.skipThird);
  oracle(o);
  spawnFormationChildIntoFreeSlotOnTimer(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(rec(2) + 0x01, DIRT); // BUG: the seated slot-active marker must be 0x01
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seated byte — it is worthless");
  assert.equal(d.addr, (rec(2) + 0x01) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/seat: wrong slot-active byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
