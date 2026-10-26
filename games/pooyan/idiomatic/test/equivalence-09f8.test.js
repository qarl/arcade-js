// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceFourObjectAnimsAndRebuildList (ROM 0x09f8, Pooyan) — "step four object records'
 * animations, then rebuild the sprite display list".
 *
 * The routine sets IX to the object-record table base, walks four records one 0x18 stride
 * apart advancing each one's animation sequence (advanceObjectAnimationFrame), then tail-calls the per-frame
 * display-list rebuild (rebuildSpriteDisplayList). It takes no register inputs and leaves NO register
 * live-out — both stages are void per-frame workers whose whole effect is in RAM.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). Each case runs the oracle on
 * one FRESH clone and advanceFourObjectAnimsAndRebuildList on another and compares:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * No register live-out is declared or compared (the caller reads none). pc/SP/cycles are NOT
 * compared — the oracle drives them through the dropped call/stack ABI, so SP is seated in the
 * dead stack where its push/call/ret framing lands. The oracle dispatches its m.call sub-routines
 * through the TRANSLATED registry; advanceFourObjectAnimsAndRebuildList imports the idiomatic ones — so the gate compares the
 * translated composition against the idiomatic composition of the same four-then-rebuild shape.
 *
 * Jobs:
 *   1. EQUAL — plain (booted records) and seeded (each record's hold field armed so advanceObjectAnimationFrame
 *      just decrements it, marking a distinct cell per record) both agree in RAM(−stack).
 *   2. WRITE-SET — the seeded run decrements all four hold fields by one and writes the sprite
 *      display list (rebuildSpriteDisplayList ran); documents the four-record coverage + the rebuild delegation.
 *   3. TEETH — a twin that leaves the FOURTH record's hold undecremented is caught by the RAM
 *      diff (proves the loop covers all four records); a twin with a wrong display-list byte is
 *      caught too (proves the rebuild's output is observed).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-09f8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_09f8 as oracle } from "../../translated/loc_09f8.js";
import { advanceFourObjectAnimsAndRebuildList } from "../advanceFourObjectAnimsAndRebuildList.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPRITE_OBJECT_TABLE, SPRITE_DISPLAY_LIST } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RECORD_STRIDE = 0x18;
const RECORD_COUNT = 4;
const HOLD_OFF = 0x0e; // advanceObjectAnimationFrame's frame-hold field within a record
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** The hold-field cell of the i-th stepped record. */
const holdCell = (i) => (SPRITE_OBJECT_TABLE + i * RECORD_STRIDE + HOLD_OFF) & 0xffff;

/** A fresh clone with SP in the dead stack; when `seed`, arm each record's hold field. */
function craft(seed) {
  const m = BASE.clone();
  m.regs.sp = STACK_SCRATCH.hi; // push/call/ret framing lands in [lo,hi)
  if (seed) for (let i = 0; i < RECORD_COUNT; i++) m.mem.write8(holdCell(i), 0x05 + i);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceFourObjectAnimsAndRebuildList == oracle in RAM (−stack), booted and seeded records", () => {
  for (const seed of [false, true]) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    advanceFourObjectAnimsAndRebuildList(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `seed=${seed}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: booted + seeded records identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: all four hold fields drop by exactly one (the loop covers all four records)", () => {
  const before = craft(true);
  const after = craft(true);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  // Each of the four stepped records' hold field is decremented by exactly one.
  for (let i = 0; i < RECORD_COUNT; i++) {
    assert.equal(after.mem.read8(holdCell(i)), (0x05 + i - 1) & 0xff, `record ${i} hold not stepped`);
  }
  // Count the (non-stack) footprint for the log; the rebuild's per-cell output is checked by EQUAL
  // and by the display-list teeth, not enumerated here (its value-for-value contract is rebuildSpriteDisplayList's).
  let changed = 0;
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off] && !inDeadStack(after.stateOffsetToAddr(off))) changed++;
  }
  console.log(`  WRITE-SET: 4 hold cells stepped; ${changed} cells changed overall (rebuild delegated)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: an undecremented FOURTH record is CAUGHT by the RAM diff", () => {
  const o = craft(true);
  const c = craft(true);
  oracle(o);
  advanceFourObjectAnimsAndRebuildList(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  const last = holdCell(RECORD_COUNT - 1);
  c.mem.write8(last, 0x08); // BUG: 4th record left at its pre-step value (loop stopped one short)
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing fourth-record step — it is worthless");
  assert.equal(d.addr, last, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(last)})`);
  console.log(`  TEETH/loop: missing 4th-record step caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong display-list byte is CAUGHT by the RAM diff", () => {
  const o = craft(true);
  const c = craft(true);
  oracle(o);
  advanceFourObjectAnimsAndRebuildList(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(SPRITE_DISPLAY_LIST, (o.mem.read8(SPRITE_DISPLAY_LIST) ^ 0xff) & 0xff); // BUG: wrong sprite byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong display-list byte — it is worthless");
  assert.equal(d.addr, SPRITE_DISPLAY_LIST, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/rebuild: wrong display-list byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
