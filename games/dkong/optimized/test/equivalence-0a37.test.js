// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0a37 (in-game GAME_STATE==3 SUB-STATE 5:
 * queue the four opening tasks, advance GAME_SUBSTATE 5->6, seed three VRAM
 * cells). Reached from loc_06fe's 0x0702 inline jump table at index 5 -- so from
 * dispatchGameState (the NMI's rst 0x28 table at 0x00CA, entry 3) once, when
 * GAME_SUBSTATE (0x600A) == 5 during the opening setup of a credited game.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_0a37 (optimized/loc_0a37.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_0a37
 *      does NOT run in attract: it needs GAME_STATE==3 with GAME_SUBSTATE==5, so a
 *      plain boot never reaches it. Driven with a coin+start inputTape it dispatches
 *      EXACTLY ONCE, at frame 34 (it does `inc (0x600A)` to advance itself to
 *      sub-state 6, so it is a one-shot setup handler). A 60-frame window covers it.
 *
 *   3. TEETH -- a deliberately-broken twin (the first VRAM store, 0x7740, lands the
 *      wrong value) must be CAUGHT: NOT-EQUAL, naming 0x7740. loc_0a37 writes 0x7740
 *      once and nothing rewrites it, so the corrupted cell persists in every dump
 *      from frame 34 on.
 *
 *   4. CYCLE TOTAL -- loc_0a37 is ATOMIC and its cycles are COLLAPSED to one total
 *      per instruction-run (README §2). This test pins the collapsed total: run the
 *      oracle and the optimized routine on clones of the captured entry and assert
 *      the T-state delta is identical (743 t). It also demonstrates the total is
 *      LOAD-BEARING -- a fully-stripped twin (all charges 0) DIVERGES the whole-
 *      machine trace at SPIN_COUNT (0x6019), because the NMI's total cost sets the
 *      main-loop spin count = the PRNG entropy. So the total is preserved; only its
 *      distribution is dropped.
 *
 *   5. BRANCH / CALLEE COVERAGE -- loc_0a37 has NO internal data-dependent branch:
 *      it is straight-line (four fixed enqueues -> inc -> three fixed stores), one
 *      path for every entry. The only data-dependence anywhere on its path lives in
 *      the callee sub_309f (0x309f), whose ring-slot test either ENQUEUES (slot free)
 *      or DROPS (slot occupied). Both arms are proven EQUAL (RAM+regs+pc) with the
 *      matching cycle total: the natural entry exercises the enqueue arm (743 t); an
 *      entry with the task ring forced fully occupied exercises the drop arm (519 t).
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers): identical to
 * loc_06fe -- harness.js's factory drives NO input, so it can never reach a credited
 * game. This test calls the SAME core unitEquivalence / wholeMachineEquivalence
 * directly with a makeMachine factory that attaches an identical coin+start inputTape
 * to BOTH the baseline and optimized machines. Any poke/tape is applied identically
 * to both sides (the factory is shared).
 *
 * CYCLE FINDING this routine adds: loc_0a37 is ATOMIC and boundary-safe -- a SHORT
 * setup NMI routine (~800 t incl. its four leaf sub_309f calls) that runs ~50000 t
 * away from any frame boundary, unlike loc_06fe (which dispatches into the longest
 * gameplay work and stayed per-instruction). So the collapse to one total per run is
 * EQUAL whole+unit, and preserving the cumulative cycle count at every sub_309f entry
 * keeps the callee's execution identical to the oracle. See optimized/loc_0a37.js.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a37 as translated_0a37 } from "../../translated/state0.js";
import { loc_0a37 as optimized_0a37 } from "../loc_0a37.js";
import { GAME_SUBSTATE } from "../ram.js";
import { Machine } from "../../machine.js";
import {
  unitEquivalence,
  wholeMachineEquivalence,
  firstStateDiff,
  firstRegDiff,
} from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0a37;
const FRAMES = 60; // loc_0a37 dispatches exactly once, at frame 34
const MAX_FRAMES = 50; // loc_0a37 first (and only) dispatches at frame 34

// A coin+start tape (identical to loc_06fe's): coin on IN2 bit7 at frame 10,
// start1 on IN2 bit2 at frame 30. This credits and starts a game so GAME_STATE
// reaches 3 and the sub-state sequence walks 0,1,5(-> loc_0a37 @ frame 34),6,7,...
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The makeMachine factory the core engine drives (the shape harness.js's
// dkMachineFactory produces), extended to attach the coin+start inputTape. Called
// with no argument for the baseline and with the wrapped override map for the
// optimized side -- both get the SAME tape, so any input is applied identically.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
}

// The first store on loc_0a37's OWN path (the callee's ring writes come first but
// are identical on both sides): the VRAM cell 0x7740 <- 0x01, inside the compared
// dump (video RAM 0x7400-0x77FF). loc_0a37 fires once, at frame 34, and nothing
// rewrites 0x7740, so the corrupted cell persists.
const BROKEN_ADDR = 0x7740;

/**
 * Deliberately-broken twin: behaviourally optimized_0a37 EXCEPT the first store to
 * 0x7740 lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly that
 * one write lets the four enqueues and every subroutine run verbatim -- the
 * representative "wrong value to an address on the routine's path" bug the gate must
 * catch.
 */
function broken_0a37(m) {
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
    return optimized_0a37(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/** Fully-stripped twin: same behaviour, every cycle charge 0. If loc_0a37's TOTAL
 *  is load-bearing (it is -- NMI total feeds the main-loop spin count), this must
 *  DIVERGE the whole-machine trace. */
function stripped_0a37(m) {
  const { regs, mem } = m;
  regs.de = 0x0304; m.push16(0x0a3d); m.step(0x309f, 0); m.call(0x309f);
  regs.de = 0x0202; m.push16(0x0a43); m.step(0x309f, 0); m.call(0x309f);
  regs.de = 0x0200; m.push16(0x0a49); m.step(0x309f, 0); m.call(0x309f);
  regs.de = 0x0600; m.push16(0x0a4f); m.step(0x309f, 0); m.call(0x309f);
  regs.hl = GAME_SUBSTATE;
  regs.incMem8(mem, regs.hl);
  regs.a = 0x01; mem.write8(0x7740, regs.a, 10);
  regs.a = 0x25; mem.write8(0x7720, regs.a, 10);
  regs.a = 0x20; mem.write8(0x7700, regs.a, 10);
  m.step(0x0a62, 0);
  m.ret(0);
}

// Capture the pristine machine state at loc_0a37's (only) dispatch, via the same
// construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0a37(mm); // let the host run proceed to a clean stop
  }]]);
  makeMachine(snap).runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_0a37 never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0a37 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0a37]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (in-game sub-state 5, frame 34, via coin+start)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0a37 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0a37, optimized_0a37, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, DE, HL, SP) + pc identical (frame 34)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong VRAM store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0a37]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong VRAM store is CAUGHT and names 0x7740", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0a37, broken_0a37, { maxFrames: MAX_FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- CYCLE TOTAL (the collapse has committed teeth) ---------------------------

test("CYCLE TOTAL: the collapsed total equals the oracle, and stripping it DIVERGES", () => {
  const entry = captureEntry();

  // (a) collapsed total == oracle total on the captured entry.
  const a = entry.clone();
  const b = entry.clone();
  const ca = a.cycles;
  const cb = b.cycles;
  translated_0a37(a);
  optimized_0a37(b);
  const da = a.cycles - ca;
  const db = b.cycles - cb;
  assert.equal(db, da, `collapsed total ${db} != oracle total ${da}`);

  // (b) the total is LOAD-BEARING: stripping every charge to 0 diverges the trace
  //     (at SPIN_COUNT 0x6019 -- the NMI total drives the main-loop spin count).
  const rs = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, stripped_0a37]]));
  assert.ok(rs.invocations.get(TARGET) >= 1, "stripped override must have dispatched");
  assert.equal(rs.equal, false, "stripping the total left the trace EQUAL — total not observable?");
  console.log(
    `  CYCLE TOTAL: collapsed ${db} t == oracle ${da} t; stripped diverges at frame ` +
      `${rs.frame}, addr 0x${(rs.addr ?? 0).toString(16)} (${rs.baseline} vs ${rs.optimized})`,
  );
});

// -- BRANCH / CALLEE COVERAGE -------------------------------------------------

test("BRANCH COVERAGE: straight-line loc_0a37 EQUAL under both sub_309f arms (enqueue + drop)", () => {
  const entry = captureEntry();

  // loc_0a37 itself has ONE path (no data-dependent branch). The only data-
  // dependence on its path is inside the callee sub_309f: a ring slot is free
  // (ENQUEUE) or occupied (DROP). Prove optimized == translated (RAM+regs+pc) on
  // BOTH arms, each with the matching cycle total, so no callee-state-dependent
  // divergence hides. The ring is prepared IDENTICALLY on both clones.
  const arms = [
    { label: "enqueue (ring free)", prep: null, wantCyc: 743 },
    {
      label: "drop (ring fully occupied)",
      // occupied = bit7 CLEAR; fill 0x60C0-0x60FF with 0x00 so every enqueue drops.
      prep: (mm) => { for (let a = 0x60c0; a <= 0x60ff; a++) mm.mem.write8(a, 0x00); },
      wantCyc: 519,
    },
  ];

  for (const { label, prep, wantCyc } of arms) {
    const a = entry.clone();
    const b = entry.clone();
    if (prep) { prep(a); prep(b); }
    const ca = a.cycles;
    const cb = b.cycles;
    translated_0a37(a);
    optimized_0a37(b);

    const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.regs, b.regs);
    assert.equal(ram, null, ram ? `${label}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
    assert.equal(regs, null, regs ? `${label}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
    assert.equal(a.pc, b.pc, `${label}: pc mismatch`);
    assert.equal(b.cycles - cb, a.cycles - ca, `${label}: cycle total ${b.cycles - cb} != oracle ${a.cycles - ca}`);
    assert.equal(a.cycles - ca, wantCyc, `${label}: unexpected oracle total ${a.cycles - ca} (expected ${wantCyc})`);
  }
  console.log("  BRANCH COVERAGE: one straight-line path, EQUAL under both sub_309f arms (enqueue 743 t, drop 519 t)");
});
