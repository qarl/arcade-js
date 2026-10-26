// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for driveObjectsByFrameParityThenBuildSprites (ROM 0x1c53, Pooyan) — the per-frame object driver, split on
 * frame parity (ROUND_COUNTER 0x8907 bit0). On an odd frame it runs the group-update pass
 * (idiomatic runPerFrameObjectSubPasses); on an even frame it runs the spawn-subtree driver (idiomatic runObjectAndSpawnUpdatePass).
 * Either way it then rebuilds the sprite display list (idiomatic rebuildSpriteDisplayList).
 *
 * SEATING: BALANCED (WIRE). The oracle ends in a plain `ret(10)`; no `pop af`. The module does no
 * stack ops; the oracle's marshalled pushes/pops land in STACK_SCRATCH and drop from the diff. SP is
 * parked in STACK_SCRATCH so each sub-driver's nested pushes drop out.
 *
 * LIVE-OUT: none — a void per-frame driver; the caller reads no register back, so the register file
 * is not compared. Fidelity = RAM (dumpState) minus stack scratch below the entry SP.
 *
 * The sub-drivers have their own equivalence gates; this test isolates driveObjectsByFrameParityThenBuildSprites's own job — PARITY
 * SELECTION + calling the display-list rebuild after — so the crafted state gates the sub-drivers to
 * benign branches: runPerFrameObjectSubPasses's frame-delay timer + blink countdown left running (each merely ticks),
 * runObjectAndSpawnUpdatePass's blitter hold (0x8f06) left running (it merely ticks), and empty 0x8ae0 records so the
 * bird pass is a no-op. That keeps oracle and module in their agreement region.
 *
 * DEPENDS ON in-batch sibling runObjectAndSpawnUpdatePass (dissolved even-frame call) being written; see reconcile notes.
 *
 * Jobs:
 *   1. EQUAL — odd frame (runPerFrameObjectSubPasses path) and even frame (runObjectAndSpawnUpdatePass path): oracle == module in RAM.
 *   2. WRITE-SET — the display-list rebuild leaves an observable footprint (both parities).
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a twin taking the WRONG parity branch
 *      diverges; and a twin that skips the display-list rebuild diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1c53.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1c53 as oracle } from "../../translated/loc_1c53.js";
import { driveObjectsByFrameParityThenBuildSprites } from "../driveObjectsByFrameParityThenBuildSprites.js";
import { runPerFrameObjectSubPasses } from "../runPerFrameObjectSubPasses.js"; // odd-branch pass, for the teeth twins
import { runObjectAndSpawnUpdatePass } from "../runObjectAndSpawnUpdatePass.js"; // even-branch pass, for the teeth twins
import { rebuildSpriteDisplayList } from "../rebuildSpriteDisplayList.js"; // shared display-list rebuild, for the teeth twins
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ROUND_COUNTER, SPRITE_DISPLAY_LIST } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DELAY = 0x8929; // SHARED_FRAME_DELAY_TIMER (runPerFrameObjectSubPasses sweep)
const COUNTDOWN = 0x892a; // BLINK_COUNTDOWN (runPerFrameObjectSubPasses sweep driver)
const PHASE = 0x892b; // BLINK_PHASE (runPerFrameObjectSubPasses object driver)
const TOGGLE = 0x892c; // ANIM_PHASE_TOGGLE
const WAVE = 0x892d; // WAVE_NUMBER
const BLIT_HOLD = 0x8f06; // blitStackedTwoTileAnimFrameOnHoldTimer frame-hold countdown (runObjectAndSpawnUpdatePass first callee)
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Gate both sub-drivers to their tick-and-continue branches so the parity split is isolated. */
function gate(m) {
  m.regs.sp = SP0;
  m.mem.write8(DELAY, 0x05); // runPerFrameObjectSubPasses: frame-delay timer running -> first sweep just decrements
  m.mem.write8(PHASE, 0x01); // runPerFrameObjectSubPasses: blink phase set -> object driver walks (empty) records
  m.mem.write8(TOGGLE, 0x00);
  m.mem.write8(COUNTDOWN, 0x07); // runPerFrameObjectSubPasses: sweep driver just decrements
  m.mem.write8(WAVE, 0x00);
  m.mem.write8(BLIT_HOLD, 0x05); // runObjectAndSpawnUpdatePass: blitter hold running -> blitStackedTwoTileAnimFrameOnHoldTimer just decrements
  return m;
}

const craftOdd = () => { const m = gate(BASE.clone()); m.mem.write8(ROUND_COUNTER, 0x01); return m; };
const craftEven = () => { const m = gate(BASE.clone()); m.mem.write8(ROUND_COUNTER, 0x00); return m; };

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, craft] of [["odd frame (runPerFrameObjectSubPasses path)", craftOdd], ["even frame (runObjectAndSpawnUpdatePass path)", craftEven]]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack)`, () => {
    const o = craft();
    const c = craft();
    oracle(o);
    driveObjectsByFrameParityThenBuildSprites(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL ${label}: RAM identical`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the display-list rebuild leaves an observable footprint (both parities)", () => {
  for (const craft of [craftOdd, craftEven]) {
    const before = craft();
    const b0 = before.dumpState();
    const after = craft();
    oracle(after);
    assert.notDeepEqual([...after.dumpState()], [...b0], "the frame driver must write something");
  }
  console.log("  WRITE-SET: both parities write");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftOdd();
  const c = craftOdd();
  oracle(o);
  driveObjectsByFrameParityThenBuildSprites(c);
  c.mem.write8(SPRITE_DISPLAY_LIST + 4, (o.mem.read8(SPRITE_DISPLAY_LIST + 4) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted display-list byte");
  assert.equal(d.addr, SPRITE_DISPLAY_LIST + 4, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin taking the WRONG parity branch diverges from the oracle", () => {
  // Even frame: correct = runObjectAndSpawnUpdatePass + rebuild. A twin that runs the odd pass (runPerFrameObjectSubPasses) instead must diverge.
  const o = craftEven();
  const twin = craftEven();
  oracle(o);
  runPerFrameObjectSubPasses(twin); // WRONG branch for an even frame
  rebuildSpriteDisplayList(twin);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "wrong-branch twin not caught -> parity split is toothless");
  console.log(`  TEETH(branch): wrong parity branch caught at ${hx(d.addr ?? 0)}`);
});

test("TEETH: a twin that skips the display-list rebuild diverges from the oracle", () => {
  const o = craftOdd();
  const twin = craftOdd();
  oracle(o);
  runPerFrameObjectSubPasses(twin); // ran the parity pass but omitted the rebuild
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "missing display-list rebuild not caught");
  console.log(`  TEETH(order): missing rebuild caught at ${hx(d.addr ?? 0)}`);
});
