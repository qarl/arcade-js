// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0cc6 (the shared tail every board-setup
 * dispatch arm converges on: walk the DE-selected layout table, then on board 4
 * run an extra rivet-fill pass, then tail-jump the rest of board setup).
 *
 * loc_0cc6 runs INSIDE the vblank NMI (game-state rst-0x28 dispatch: handler_0763
 * -> jp 0x0c92 -> board cascade -> here), where entry_0066 has cleared the NMI
 * mask, so the handler cannot re-enter. It is therefore ATOMIC on every one of its
 * four call paths (all NMI-local, GREP-confirmed), and its per-instruction cycle
 * charges collapse to one total per inter-call segment with the cumulative clock at
 * each callee entry preserved exactly. See optimized/loc_0cc6.js for the analysis.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_0cc6 reads EQUAL against its translated
 *      oracle, whole-machine and unit. In attract mode it dispatches EXACTLY ONCE,
 *      at frame 518 (board 1, the NOT-taken arm -- the only arm attract reaches;
 *      matches the oracle's own "first executes in frame 518" note at loc_0cd4).
 *
 *   2. DISPATCH -- the override must actually fire (frame 518), or EQUAL is vacuous.
 *
 *   3. TEETH -- a deliberately-broken twin (the first board-tile store to 0x75C7,
 *      a persistent VRAM cell from sub_0da7's table walk, lands the wrong value)
 *      must be CAUGHT: NOT-EQUAL, naming 0x75C7.
 *
 *   4. BRANCH COVERAGE -- the natural attract run only reaches the NOT-taken arm
 *      (board 1). The TAKEN arm (board 4, `call z,0x0d00`) is the loc_0cb6
 *      fall-through in a real 100m setup; it is SYNTHESISED by cloning the frame-518
 *      entry and poking BOARD=4, then diffing oracle vs optimized RAM+regs+pc AND
 *      asserting the arm's CYCLE TOTAL matches (a collapsed arm the whole-machine
 *      run never reaches needs its own cycle teeth).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0cc6 as translated_0cc6 } from "../../translated/nmi.js";
import { loc_0cc6 as optimized_0cc6 } from "../loc_0cc6.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0cc6;
const FRAMES = 525; // loc_0cc6 first (and only, in attract) fires at frame 518
const BOARD = 0x6227; // work-RAM board register; ==4 selects the taken arm

// A persistent board-tile cell written by sub_0da7's layout-table walk during
// loc_0cc6's frame-518 execution and NOT overwritten (verified to still differ at
// frames 518/519/539). loc_0cc6 makes no store of its own, so the teeth target is
// its first callee's first PERSISTENT output, exactly as broken_0611 used 0x759F.
const BROKEN_ADDR = 0x75c7;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x75C7 lands a wrong value (correct char XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim -- the representative "wrong value to one
 * of the routine's own output addresses" bug the gate must catch.
 */
function broken_0cc6(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BROKEN_ADDR) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_0cc6(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/** Capture the pristine machine state at loc_0cc6's first (frame-518) entry. */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (m) => {
    if (entry === null) entry = m.clone();
    return translated_0cc6(m);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(FRAMES);
  assert.ok(entry, `entry to 0x${TARGET.toString(16)} never captured within ${FRAMES} frames`);
  return entry;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0cc6 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0cc6]]));

  // The override must actually have run, or EQUAL would be vacuous.
  assert.ok(
    r.invocations.get(TARGET) >= 1,
    `override at 0x${TARGET.toString(16)} never dispatched (invocations=${r.invocations.get(TARGET)})`,
  );
  assert.equal(
    r.equal,
    true,
    r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
  assert.equal(r.framesCompared, FRAMES);
  console.log(
    `  EQUAL/whole: ${r.framesCompared} frames identical, ` +
      `override fired ${r.invocations.get(TARGET)}x (frame 518, board-1 not-taken arm)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0cc6 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0cc6, optimized_0cc6, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong board-tile store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0cc6]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong board-tile store is CAUGHT and names 0x75C7", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0cc6, broken_0cc6, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- BRANCH COVERAGE (the taken arm the attract run never reaches) ------------

test("BRANCH (taken, board 4): synthesised 0x6227==4 arm — RAM+regs+pc EQUAL and cycle total matches", () => {
  const entry = captureEntry();
  // The natural attract entry is the NOT-taken arm; the whole-machine + unit
  // EQUAL tests above already prove that arm. Here we force the other one.
  assert.equal(entry.mem.read8(BOARD), 1, "natural attract entry should be board 1 (not-taken)");

  const a = entry.clone(); a.mem.write8(BOARD, 4); // oracle, forced taken
  const b = entry.clone(); b.mem.write8(BOARD, 4); // optimized, forced taken
  const ca = a.cycles, cb = b.cycles;
  translated_0cc6(a);
  optimized_0cc6(b);
  const takenCyclesOracle = a.cycles - ca;
  const takenCyclesOpt = b.cycles - cb;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(a.pc, b.pc, "pc must match on the taken arm");
  // A collapsed arm the whole-machine run never reaches needs its own cycle teeth:
  // a wrong taken-arm total (own charges 64t) would show as a cycle-total mismatch.
  assert.equal(
    takenCyclesOpt,
    takenCyclesOracle,
    `taken-arm cycle total diverged (oracle ${takenCyclesOracle} vs optimized ${takenCyclesOpt})`,
  );
  console.log(
    `  BRANCH/taken: board-4 arm EQUAL (RAM+regs+pc), cycle total ${takenCyclesOracle}t on both`,
  );
});
