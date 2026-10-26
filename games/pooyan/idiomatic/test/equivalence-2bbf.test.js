// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stageFormationReadyMarkersOrSkipTick (ROM 0x2bbf) — "formation ready-sprite helper".
 *
 * stageFormationReadyMarkersOrSkipTick is a DISSOLVED CALLER-SKIP for tickFormationSpawnAndScanSlots. In the oracle one path ends with
 * `pop af; ret` (aborting tickFormationSpawnAndScanSlots) and the others with a plain `ret`. The idiomatic module
 * drops the stack plumbing and returns a BOOLEAN:
 *   true  = normal return (tickFormationSpawnAndScanSlots continues),
 *   false = the caller-skip (the indicator marker was already present -> abort tickFormationSpawnAndScanSlots).
 * The translated oracle ALSO returns that boolean, so the two are compared directly. The gate
 * COMPOSES the real idiomatic painters (paintReadySpriteSquareIfAbsent + blit2x2TileBlock).
 *
 * Cycle-free / memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) plus the boolean. pc/SP/cycles/registers are NOT compared. stageFormationReadyMarkersOrSkipTick has NO
 * register live-out — tickFormationSpawnAndScanSlots reloads its own registers. The only input is A (the wave count),
 * bridged via the register default; a case also pokes the two indicator cells (0x877b checked/
 * painted here, 0x87bb painted by paintReadySpriteSquareIfAbsent) identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — a==1 (paint only, true), a==0 & marker present (skip, false, no writes), a==0 &
 *      marker absent (blit + paint, true), a==1 & 0x87bb already painted (true, no writes).
 *   2. WRITE-SET — the blit-and-paint path writes the two 2x2 squares (0x877b and 0x87bb).
 *   3. TEETH — a wrong painted byte is caught by the RAM diff; a wrong boolean by the check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2bbf.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2bbf as oracle } from "../../translated/loc_2bbf.js";
import { stageFormationReadyMarkersOrSkipTick } from "../stageFormationReadyMarkersOrSkipTick.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, FORMATION_READY_TILE_VRAM, READY_SPRITE_TILE_VRAM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const MARKER = 0xba; // indicator value once a square is painted
const STRIDE = 0x20; // video-RAM row stride
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}
/** The four cells of a 2x2 square anchored at `dest` (top-left, top-right, bottom-right, bottom-left). */
const square = (dest) => [dest, dest + 0x01, dest + 0x21, dest + STRIDE];

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: A seated, both indicator anchor cells poked identically. */
function craft({ a, cell877b = 0x00, cell87bb = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.a = a;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  m.mem.write8(FORMATION_READY_TILE_VRAM, cell877b);
  m.mem.write8(READY_SPRITE_TILE_VRAM, cell87bb);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

const CASES = [
  { name: "a=1 -> paint only (true)", args: { a: 0x01, cell87bb: 0x00 }, ret: true },
  { name: "a=0 marker present -> skip (false)", args: { a: 0x00, cell877b: MARKER }, ret: false },
  { name: "a=0 marker absent -> blit+paint (true)", args: { a: 0x00, cell877b: 0x00, cell87bb: 0x00 }, ret: true },
  { name: "a=1 0x87bb already painted -> true, no paint", args: { a: 0x01, cell87bb: MARKER }, ret: true },
];

test("EQUAL: all four paths agree in RAM (−stack) and in the boolean", () => {
  for (const { name, args, ret } of CASES) {
    const o = craft(args);
    const c = craft(args);
    const oret = oracle(o);
    const cret = stageFormationReadyMarkersOrSkipTick(c);
    assert.equal(oret, ret, `oracle boolean for "${name}"`);
    assert.equal(cret, oret, `module boolean mismatch for "${name}"`);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} ("${name}")`);
  }
  console.log(`  EQUAL: ${CASES.length} paths identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the blit+paint path writes the 0x877b and 0x87bb squares", () => {
  const args = { a: 0x00, cell877b: 0x00, cell87bb: 0x00 };
  const before = craft(args);
  const after = craft(args);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
  }
  for (const cell of [...square(FORMATION_READY_TILE_VRAM), ...square(READY_SPRITE_TILE_VRAM)]) {
    assert.ok(changed.has(cell), `expected a write at ${hx(cell)}`);
  }
  console.log(`  WRITE-SET: ${changed.size} cells (0x877b + 0x87bb squares)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong painted byte is CAUGHT by the RAM diff", () => {
  const args = { a: 0x00, cell877b: 0x00, cell87bb: 0x00 };
  const o = craft(args);
  const c = craft(args);
  oracle(o);
  stageFormationReadyMarkersOrSkipTick(c);
  const victim = square(FORMATION_READY_TILE_VRAM)[3]; // bottom-left of the 0x877b square
  c.mem.write8(victim, (c.mem.read8(victim) ^ 0xff) & 0xff); // BUG: corrupt a painted cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong painted byte");
  assert.equal(d.addr, victim, `teeth caught ${hx(d.addr ?? 0)} (expected ${hx(victim)})`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong boolean is CAUGHT by the boolean check", () => {
  const o = craft({ a: 0x00, cell877b: MARKER });
  const oret = oracle(o); // false (skip)
  assert.equal(oret, false, "sanity: the marker-present path reports false");
  const brokenTwin = () => true; // a twin that fails to abort tickFormationSpawnAndScanSlots
  assert.throws(() => assert.equal(brokenTwin(), oret), "a wrong boolean must be caught");
  console.log("  TEETH/bool: a twin returning true on the skip path is rejected");
});
