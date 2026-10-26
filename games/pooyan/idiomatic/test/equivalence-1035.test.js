// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceObjectsAndRebuildSprites (Pooyan) — the main-loop post-handler tail.
 *
 * advanceObjectsAndRebuildSprites is a pure sequencer: it runs four per-frame passes in order and returns —
 * step the active target actor records, sweep the per-object state dispatch, run the
 * formation object-state dispatcher, then rebuild the sprite display list. It reads no
 * registers and returns none; LIVE-OUT is memory only (whatever the four passes write).
 *
 * Compared on RAM (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH so the
 * oracle's push/ret traffic falls out of the diff. EQUAL is checked on a boot clone and on a
 * clone with a target record armed (bit0), which drives the first pass's per-object stepper.
 *
 * Jobs:
 *   1. EQUAL — module == oracle in RAM (−stack) across both states.
 *   2. WRITE-SET — the routine mutates memory: the step counter (first pass) and the sprite
 *      display list (last pass) both differ from the untouched base.
 *   3. TEETH — a corrupted display-list byte is caught; and the sequence is load-bearing:
 *      dropping the first pass changes the step counter, dropping the last changes the list.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1035.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1035 as oracle } from "../../translated/loc_1035.js";
import { advanceObjectsAndRebuildSprites } from "../advanceObjectsAndRebuildSprites.js";
import { stepActiveTargetActorRecords } from "../stepActiveTargetActorRecords.js";
import { stepEnemyActorStates } from "../stepEnemyActorStates.js";
import { dispatchFormationObjectStates } from "../dispatchFormationObjectStates.js";
import { rebuildSpriteDisplayList } from "../rebuildSpriteDisplayList.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TARGET_SCAN_COUNTER, SPRITE_DISPLAY_LIST, ENEMY_TARGET_REC0 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; // inside STACK_SCRATCH
const LIST_PROBE = SPRITE_DISPLAY_LIST + 0x58; // a display-list byte the last pass always rewrites

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Clone the base machine, park SP in the dead-stack region, apply an optional seed. */
function seat(seed) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  if (seed) seed(m);
  return m;
}

const CASES = [
  { name: "boot clone", seed: null },
  { name: "target record armed (bit0)", seed: (m) => m.mem.write8(ENEMY_TARGET_REC0, m.mem.read8(ENEMY_TARGET_REC0) | 0x01) },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceObjectsAndRebuildSprites == oracle in RAM (−stack)", () => {
  for (const { name, seed } of CASES) {
    const o = seat(seed);
    const c = seat(seed);
    oracle(o);
    advanceObjectsAndRebuildSprites(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} states identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the routine mutates memory (first + last pass observable)", () => {
  const before = seat(null);
  const after = seat(null);
  advanceObjectsAndRebuildSprites(after);
  assert.notEqual(
    after.mem.read8(TARGET_SCAN_COUNTER),
    before.mem.read8(TARGET_SCAN_COUNTER),
    "first pass must touch the step counter",
  );
  assert.notEqual(
    after.mem.read8(LIST_PROBE),
    before.mem.read8(LIST_PROBE),
    "last pass must rebuild the display list",
  );
  console.log("  WRITE-SET: step counter + display list both written");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: corruption is CAUGHT; the four-pass sequence is load-bearing", () => {
  // A corrupted display-list byte in the module output is caught by the RAM diff.
  const o = seat(null);
  const c = seat(null);
  oracle(o);
  advanceObjectsAndRebuildSprites(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: full sequence equals oracle");
  c.mem.write8(LIST_PROBE, (o.mem.read8(LIST_PROBE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the diff FAILED to catch a corrupted display-list byte");
  assert.equal(d.addr, LIST_PROBE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // Load-bearing: rebuild the sequence from the imported passes, then drop one and show the
  // dropped output diverges from the full run — proving each dropped call contributes.
  const full = seat(null);
  advanceObjectsAndRebuildSprites(full);

  const dropFirst = seat(null); // omit stepActiveTargetActorRecords
  stepEnemyActorStates(dropFirst);
  dispatchFormationObjectStates(dropFirst);
  rebuildSpriteDisplayList(dropFirst);
  assert.notEqual(
    dropFirst.mem.read8(TARGET_SCAN_COUNTER),
    full.mem.read8(TARGET_SCAN_COUNTER),
    "dropping the first pass must change the step counter",
  );

  const dropLast = seat(null); // omit rebuildSpriteDisplayList
  stepActiveTargetActorRecords(dropLast);
  stepEnemyActorStates(dropLast);
  dispatchFormationObjectStates(dropLast);
  assert.notEqual(
    dropLast.mem.read8(LIST_PROBE),
    full.mem.read8(LIST_PROBE),
    "dropping the last pass must change the display list",
  );

  console.log(`  TEETH: caught at ${hx(d.addr)}; first + last passes load-bearing`);
});
