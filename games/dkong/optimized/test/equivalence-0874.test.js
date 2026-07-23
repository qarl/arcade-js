// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0874 (ROM 0x0874): the board/power-on
 * screen + sprite-buffer CLEAR. It is a pure LEAF -- it reads nothing, calls
 * nothing, and is reached only via `m.call` from state-0 / sub-state SETUP
 * handlers (handler_01c3 at power-on, then the per-board setups). All of those
 * run INSIDE the vblank NMI (dispatchGameState), which clears its own mask and
 * cannot re-enter, so sub_0874 is ATOMIC on every call path and its per-
 * instruction cycle charges collapse to three per-block totals -- the TOTAL
 * (35690t) preserved exactly.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized sub_0874 reads EQUAL against its
 *      translated oracle, whole-machine and unit. The harness now installs the
 *      snapshot override at CONSTRUCTION, so the unit gate reaches this leaf
 *      through its `m.call` entry (handler_01c3 at boot), not just a dispatch.
 *
 *   2. DISPATCH -- the override must actually fire or EQUAL is vacuous. sub_0874
 *      dispatches from boot at frame 5 (handler_01c3's power-on clear) and again
 *      during the following board/attract setup; a 12-frame window sees it 2x.
 *
 *   3. TEETH -- a deliberately-broken twin (the first playfield store to VRAM
 *      0x7404 lands the wrong value) must be CAUGHT: NOT-EQUAL, naming 0x7404.
 *
 *   4. FULL-BRANCH COVERAGE -- sub_0874 has NO data-dependent branch: fixed
 *      iteration counts (32x28, 2x14, 256+128) and no register/RAM input, so it
 *      is a single straight-line path fully exercised by the natural run. There
 *      is no alternate arm to synthesise; the unit gate pins the exact final
 *      RAM + all registers (incl. F=0x42) + pc.
 *
 *   5. COLLAPSE TEETH -- because the cycles were collapsed, the collapsed TOTAL
 *      is proven load-bearing two ways: (a) oracle and optimized consume the
 *      IDENTICAL total (35690t) across the routine on cloned entries; (b) a twin
 *      whose total is wrong is CAUGHT by the whole-machine gate (the NMI's cost
 *      sets the main-loop spin count, so a wrong total surfaces at SPIN_COUNT
 *      0x6019 or a shifted stack PC -- README §2).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0874 as translated_0874 } from "../../translated/state0.js";
import { sub_0874 as optimized_0874 } from "../sub_0874.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0874;
const FRAMES = 12; // sub_0874 fires at frame 5 (boot) and once more by frame ~8

// The first store on the routine's path is the first playfield cell, tile 0x10
// to VRAM 0x7404 (inside the compared state dump, video RAM 0x7400-0x77FF).
// sub_0874 is the last writer of that cell in its frame, so the corruption
// survives to the frame boundary and is caught there.
const BROKEN_ADDR = 0x7404;

/**
 * Deliberately-broken twin: the optimized handler EXCEPT the first store to
 * 0x7404 lands a wrong value (correct byte XOR 0xFF, guaranteed to differ).
 * Every other write and the whole rest of the routine run verbatim.
 */
function broken_0874(m) {
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
    return optimized_0874(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Wrong-total twin: the optimized handler EXCEPT its first m.step charge is
 * inflated by `delta` cycles, so the routine's TOTAL is wrong while every store
 * is correct. Used to prove the collapsed total has teeth.
 */
function wrongTotal_0874(delta) {
  return (m) => {
    const realStep = m.step.bind(m);
    let first = true;
    m.step = (addr, cyc) => {
      if (first) {
        first = false;
        return realStep(addr, cyc + delta);
      }
      return realStep(addr, cyc);
    };
    try {
      return optimized_0874(m);
    } finally {
      m.step = realStep;
    }
  };
}

/** Capture the pristine machine state at sub_0874's first entry (via m.call). */
function captureEntry(maxFrames = 30) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0874(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error("sub_0874 never entered");
  return entry;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0874 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0874]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0874 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0874, optimized_0874);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F=0x42) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong playfield store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0874]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong playfield store is CAUGHT and names 0x7404", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0874, broken_0874);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});

// -- COLLAPSE TEETH (the total is preserved AND load-bearing) ------------------

test("COLLAPSE: optimized consumes the oracle's exact total, and a wrong total is CAUGHT", () => {
  // (a) same TOTAL across the routine on independent clones of the entry state.
  const entry = captureEntry();
  const a = entry.clone();
  const b = entry.clone();
  const ca = a.cycles;
  translated_0874(a);
  const totalTranslated = a.cycles - ca;
  const cb = b.cycles;
  optimized_0874(b);
  const totalOptimized = b.cycles - cb;
  assert.equal(totalOptimized, totalTranslated, "collapsed total must equal the oracle's");
  assert.equal(totalTranslated, 35690, "oracle total is 35680 of m.step + 10 of ret");
  console.log(`  COLLAPSE: total preserved exactly (${totalOptimized}t == oracle ${totalTranslated}t)`);

  // (b) a twin whose total is wrong (+100t) must be caught by the whole-machine
  // gate -- the NMI's cost sets the main-loop spin count, so a wrong total drifts
  // observable state (SPIN_COUNT 0x6019 or a shifted stack PC). README §2.
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, wrongTotal_0874(100)]]));
  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong collapsed total must be caught (the total is load-bearing)");
  assert.ok(r.addr != null, "a caught total-divergence must name an address");
  console.log(
    `  COLLAPSE teeth: wrong total (+100t) caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});
