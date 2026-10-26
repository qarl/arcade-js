// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for scanFormationSlotsAndLaunchFree (ROM 0x2bb3) — "formation spawn scan": walk up to 0x11
 * records stepping the pointer back one record each pass, launching the first free slot.
 *
 * scanFormationSlotsAndLaunchFree is the CALLER of the dissolved caller-skip launchFormationObjectIntoFreeSlot. This gate COMPOSES the real
 * idiomatic skip: the idiomatic scanFormationSlotsAndLaunchFree imports the idiomatic launchFormationObjectIntoFreeSlot and early-returns when
 * it reports false (launched), exactly where the oracle's pop-af/ret aborted the loop. The
 * oracle side runs the TRANSLATED scanFormationSlotsAndLaunchFree, which internally m.call()s the translated launchFormationObjectIntoFreeSlot
 * (and its anim helper) through the registry.
 *
 * Cycle-free / memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles/registers are NOT compared. Inputs are the record-table pointer
 * (IX) and the step (DE), bridged via the register defaults, plus the record bytes and the two
 * shared cells (0x8903 wave counter, 0x8d30 spawn countdown) poked identically on both sides.
 *
 * Two required states plus a mid-loop one:
 *   - skip NOT taken: all 0x11 slots busy -> the full loop runs, nothing is written.
 *   - skip taken on pass 1: the first slot is free -> launchFormationObjectIntoFreeSlot seeds it and aborts immediately.
 *   - skip taken on pass 3: two busy slots then a free one -> the pointer steps twice, then the
 *     third record is seeded and the loop aborts (proves the stepping + abort target).
 *
 * Jobs: 1. EQUAL (the three states). 2. TEETH — a wrong seeded byte on the abort case is caught
 * by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2bb3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2bb3 as oracle } from "../../translated/loc_2bb3.js";
import { scanFormationSlotsAndLaunchFree } from "../scanFormationSlotsAndLaunchFree.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, WAVE_ARRIVAL_COUNTER, FORMATION_SPAWN_TIMER, FORMATION_SPAWN_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BASE_REC = FORMATION_SPAWN_TABLE; // 0x8c60
const STRIDE = 0xffe8; // -0x18, one record back per pass
const SLOTS = 0x11;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const recBase = (k) => u16(BASE_REC + k * STRIDE); // record base scanned on pass k (0-based)

/** A fresh clone: IX/DE seated, the two shared cells poked, and the listed slots marked busy. */
function craft(busyIndices, { wave = 0x05, timer = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.ix = BASE_REC;
  m.regs.de = STRIDE;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  m.mem.write8(WAVE_ARRIVAL_COUNTER, wave);
  m.mem.write8(FORMATION_SPAWN_TIMER, timer);
  for (const k of busyIndices) m.mem.write8(recBase(k) + 0x00, 0x01); // bit0 set -> busy
  return m;
}

const allBusy = Array.from({ length: SLOTS }, (_, k) => k);

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: all slots busy — full loop, no writes", () => {
  const o = craft(allBusy);
  const c = craft(allBusy);
  oracle(o);
  scanFormationSlotsAndLaunchFree(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log("  EQUAL/all-busy: 17-pass loop, RAM identical (no writes)");
});

test("EQUAL: first slot free — seed pass 1 then abort", () => {
  const o = craft([]); // nothing busy -> pass 1 slot is free
  const c = craft([]);
  oracle(o);
  scanFormationSlotsAndLaunchFree(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log(`  EQUAL/abort-1: seeded ${hx(recBase(0))}, RAM identical`);
});

test("EQUAL: two busy then free — step twice, seed pass 3, abort", () => {
  const o = craft([0, 1]); // slots 0,1 busy; slot 2 free
  const c = craft([0, 1]);
  oracle(o);
  scanFormationSlotsAndLaunchFree(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log(`  EQUAL/abort-3: seeded ${hx(recBase(2))}, RAM identical`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte on the abort case is CAUGHT by the RAM diff", () => {
  const o = craft([0, 1]);
  const c = craft([0, 1]);
  oracle(o);
  scanFormationSlotsAndLaunchFree(c);
  c.mem.write8(recBase(2) + 0x02, 0x00); // BUG: seeded state must be 0x11

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seeded byte");
  assert.equal(d.addr, recBase(2) + 0x02, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(recBase(2) + 0x02)})`);
  console.log(`  TEETH: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
