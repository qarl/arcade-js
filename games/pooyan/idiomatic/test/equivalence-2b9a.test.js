// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickFormationSpawnAndScanSlots (ROM 0x2b9a) — "formation-spawn tick".
 *
 * tickFormationSpawnAndScanSlots is a CALLER: it invokes the dissolved caller-skip stageFormationReadyMarkersOrSkipTick (whose false return
 * abandons the tick), then services the spawn countdown, and on expiry falls into the spawn
 * scan scanFormationSlotsAndLaunchFree (which itself composes the dissolved skip launchFormationObjectIntoFreeSlot). This gate COMPOSES all the
 * real idiomatic pieces: the idiomatic tickFormationSpawnAndScanSlots imports the idiomatic stageFormationReadyMarkersOrSkipTick and scanFormationSlotsAndLaunchFree and
 * early-returns / tail-calls exactly where the oracle's skips aborted. The oracle side runs the
 * TRANSLATED tickFormationSpawnAndScanSlots, which m.call()s the translated helpers through the registry.
 *
 * Cycle-free / memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles/registers are NOT compared; tickFormationSpawnAndScanSlots takes no register input
 * (it reads 0x8903/0x8d30 and seats IX/DE itself) and no caller reads a register back. A case
 * pokes the memory cells (wave counter 0x8903, indicator cells, spawn countdown 0x8d30, and the
 * record table at 0x8c60) identically on both sides.
 *
 * Five states drive every branch:
 *   A. wave<2 & indicator present -> stageFormationReadyMarkersOrSkipTick skips -> tick abandoned, no writes.
 *   B. wave<2 & indicator absent  -> stageFormationReadyMarkersOrSkipTick blits+paints, then countdown (nonzero) decrements.
 *   C. wave>=2 & countdown nonzero -> helper skipped, countdown just decrements.
 *   D. wave>=2 & countdown zero, a free slot -> falls into the scan, seeds one record, aborts.
 *   E. wave>=2 & countdown zero, all slots busy -> full scan, no writes.
 *
 * Jobs: 1. EQUAL (the five states). 2. TEETH — a wrong seeded byte on state D is caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2b9a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b9a as oracle } from "../../translated/loc_2b9a.js";
import { tickFormationSpawnAndScanSlots } from "../tickFormationSpawnAndScanSlots.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import {
  STACK_SCRATCH, WAVE_ARRIVAL_COUNTER, FORMATION_SPAWN_TIMER, FORMATION_SPAWN_TABLE,
  FORMATION_READY_TILE_VRAM, READY_SPRITE_TILE_VRAM,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const MARKER = 0xba;
const STRIDE = 0xffe8;
const SLOTS = 0x11;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const recBase = (k) => u16(FORMATION_SPAWN_TABLE + k * STRIDE);

/** A fresh clone: sp seated, the driving cells poked, and the listed slots marked busy. */
function craft({ wave, timer = 0x00, cell877b = 0x00, cell87bb = 0x00, busy = [] } = {}) {
  const m = BASE.clone();
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  m.mem.write8(WAVE_ARRIVAL_COUNTER, wave);
  m.mem.write8(FORMATION_SPAWN_TIMER, timer);
  m.mem.write8(FORMATION_READY_TILE_VRAM, cell877b);
  m.mem.write8(READY_SPRITE_TILE_VRAM, cell87bb);
  for (const k of busy) m.mem.write8(recBase(k) + 0x00, 0x01);
  return m;
}

const allBusy = Array.from({ length: SLOTS }, (_, k) => k);

const CASES = [
  { name: "A wave<2 marker present -> abandon", args: { wave: 0x00, timer: 0x07, cell877b: MARKER } },
  { name: "B wave<2 marker absent -> blit+paint, countdown--", args: { wave: 0x00, timer: 0x05 } },
  { name: "C wave>=2 countdown-- ", args: { wave: 0x05, timer: 0x03 } },
  { name: "D wave>=2 countdown==0 free slot -> seed+abort", args: { wave: 0x05, timer: 0x00 } },
  { name: "E wave>=2 countdown==0 all busy -> full scan", args: { wave: 0x05, timer: 0x00, busy: allBusy } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: all five states agree in RAM (−stack)", () => {
  for (const { name, args } of CASES) {
    const o = craft(args);
    const c = craft(args);
    oracle(o);
    tickFormationSpawnAndScanSlots(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} ("${name}")`);
  }
  console.log(`  EQUAL: ${CASES.length} states identical (RAM −stack)`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte on the spawn path (state D) is CAUGHT", () => {
  const args = { wave: 0x05, timer: 0x00 };
  const o = craft(args);
  const c = craft(args);
  oracle(o);
  tickFormationSpawnAndScanSlots(c);
  const victim = recBase(0) + 0x02; // seeded state byte := 0x11
  c.mem.write8(victim, 0x00); // BUG

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded byte");
  assert.equal(d.addr, victim, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(victim)})`);
  console.log(`  TEETH: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
