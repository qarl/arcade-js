// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0a63 (in-game GAME_STATE==3 sub-state 6: the
 * timed gate that decides INTRO vs HOW-HIGH before a board starts). Reached from
 * loc_06fe's 0x0702 sub-state table (index 6), itself dispatched by the NMI's rst
 * 0x28 table at 0x00CA (entry 3) while a credited game runs.
 *
 * Five jobs (entry_0611's three, plus a full branch sweep and its cycle teeth):
 *
 *   1. EQUAL -- the idiomatic optimized loc_0a63 (optimized/loc_0a63.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_0a63
 *      does NOT run in attract (0 dispatches over a plain boot); it needs
 *      GAME_STATE==3. Driven with a coin+start inputTape it dispatches EXACTLY ONCE,
 *      at frame ~35, taking branch B (SUBSTATE_TIMER already 1 on entry so the gate
 *      passes immediately; PLAY_INTRO==1 so it advances 0x600A by 1 -> sub-state 7).
 *      A 60-frame window covers it.
 *
 *   3. TEETH -- a deliberately-broken twin (the first store on loc_0a63's path, the
 *      first cell of sub_0874's playfield clear at VRAM 0x7404, lands the wrong
 *      value) must be CAUGHT: NOT-EQUAL, naming 0x7404.
 *
 *   4. BRANCH COVERAGE -- loc_0a63 has THREE data-dependent paths:
 *        A. gate still counting (SUBSTATE_TIMER > 1) -> sub_0018 skips, return.
 *        B. gate expired, PLAY_INTRO != 0 -> advance 0x600A by 1 (sub-state 7).
 *        C. gate expired, PLAY_INTRO == 0 -> advance 0x600A by 2 (sub-state 8).
 *      The driven run reaches ONLY B. A and C are SYNTHESISED from the captured
 *      entry (A: poke SUBSTATE_TIMER=5; C: poke PLAY_INTRO=0), applied IDENTICALLY
 *      to the oracle and optimized clones, and each proven EQUAL (RAM+regs+pc).
 *
 *   5. CYCLE TEETH -- loc_0a63 is ATOMIC (runs inside the NMI with the mask
 *      cleared; nmiMask==0 at dispatch), so its trailing block is collapsed to one
 *      m.step per branch. Branch B's total is validated by the EQUAL whole-machine
 *      run (loc_0a63's total feeds the main-loop spin count / PRNG). Branches A and
 *      C are NOT reached there, so the sweep ALSO measures each branch's cycle total
 *      across the routine on both clones and asserts optimized == oracle -- otherwise
 *      a wrong collapsed total on the A or C arm would have no teeth.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Like loc_06fe,
 * loc_0a63 needs a credited game to dispatch, and harness.js's factory drives NO
 * input, so it could never reach it. This test therefore calls the SAME core
 * unitEquivalence / wholeMachineEquivalence, passing a makeMachine factory that adds
 * an identical coin+start inputTape to BOTH baseline and optimized machines. Nothing
 * about the capture / clone / diff / invocation-counter logic is re-implemented -- it
 * is the standard engine, reached the way harness.js reaches it (the snapshot
 * override is installed at CONSTRUCTION through the factory, so it reaches loc_0a63
 * however it is first entered), with the input the routine requires. Any poke/tape is
 * applied identically to both sides (the factory, and each synthesised poke, is shared).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a63 as translated_0a63 } from "../../translated/state0.js";
import { loc_0a63 as optimized_0a63 } from "../loc_0a63.js";
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

const TARGET = 0x0a63;
const FRAMES = 60; // loc_0a63 first (and only) dispatches at frame ~35
const MAX_FRAMES = 45; // enough to reach that first entry

const SUBSTATE_TIMER = 0x6009;
const GAME_SUBSTATE = 0x600a;
const PLAY_INTRO = 0x622c;

// A coin+start tape (identical to loc_06fe's): coin on IN2 bit7 at frame 10, start1
// on IN2 bit2 at frame 30. This credits and starts a game so GAME_STATE reaches 3
// and the state-3 sub-state sequence advances into sub-state 6 (loc_0a63) at ~f35.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The makeMachine factory the core engine drives (the same shape harness.js's
// dkMachineFactory produces), extended to attach the coin+start inputTape. Called
// with no argument for the baseline and with the wrapped override map for the
// optimized side -- both get the SAME tape, so any input is applied identically.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
}

// The first store on loc_0a63's (branch-B) path: the first cell of sub_0874's
// playfield clear, VRAM 0x7404 <- 0x10, inside the compared dump (0x7400-0x77FF).
// loc_0a63 fires only at frame ~35 and does not run again, so the corrupted cell
// persists to that frame's boundary and the whole-machine diff catches it.
const BROKEN_ADDR = 0x7404;

/**
 * Deliberately-broken twin: behaviourally optimized_0a63 EXCEPT the first store to
 * 0x7404 lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly that
 * one write lets the routine and every subroutine it calls run verbatim -- the
 * representative "wrong value to an address on the routine's path" bug the gate
 * must catch.
 */
function broken_0a63(m) {
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
    return optimized_0a63(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0a63 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0a63]]));

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
      `${r.invocations.get(TARGET)}x (branch B: sub-state 6->7, intro path)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0a63 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0a63, optimized_0a63, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, HL, DE, SP) + pc identical (first entry: branch B)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong store on the routine's path is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0a63]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong store on the routine's path is CAUGHT and names 0x7404", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0a63, broken_0a63, { maxFrames: MAX_FRAMES });

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

// -- BRANCH COVERAGE + CYCLE TEETH --------------------------------------------

// Capture the pristine machine state at loc_0a63's FIRST dispatch (branch B, frame
// ~35), via the same construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0a63(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_0a63 never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

// Run oracle vs optimized on two clones of `entry`, after applying `poke` (a
// {addr,val}[] list) identically to both. Diffs RAM+regs+pc AND the cycle total.
function runBranch(entry, poke) {
  const a = entry.clone(); // translated (oracle)
  const b = entry.clone(); // optimized
  for (const { addr, val } of poke) {
    a.mem.write8(addr, val);
    b.mem.write8(addr, val);
  }
  const startCycles = entry.cycles;
  const subBefore = a.mem.read8(GAME_SUBSTATE);

  translated_0a63(a);
  optimized_0a63(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return {
    ram,
    regs,
    pcEqual: a.pc === b.pc,
    cyclesEqual: (a.cycles - startCycles) === (b.cycles - startCycles),
    aCycles: a.cycles - startCycles,
    bCycles: b.cycles - startCycles,
    subBefore,
    subAfterA: a.mem.read8(GAME_SUBSTATE),
    subAfterB: b.mem.read8(GAME_SUBSTATE),
  };
}

test("BRANCH COVERAGE + CYCLE: A (gate counting), B (intro +1), C (how-high +2) each EQUAL", () => {
  const entry = captureEntry();

  // The captured entry is branch B's state (SUBSTATE_TIMER==1, PLAY_INTRO==1).
  const branches = [
    { name: "A gate-counting", poke: [{ addr: SUBSTATE_TIMER, val: 5 }], expectDelta: 0 },
    { name: "B intro (+1)",    poke: [],                                  expectDelta: 1 },
    { name: "C how-high (+2)", poke: [{ addr: PLAY_INTRO, val: 0 }],      expectDelta: 2 },
  ];

  for (const { name, poke, expectDelta } of branches) {
    const r = runBranch(entry, poke);

    assert.equal(r.ram, null, r.ram ? `${name}: RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
    assert.equal(r.regs, null, r.regs ? `${name}: reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
    assert.ok(r.pcEqual, `${name}: pc mismatch`);
    // Prove this arm actually took the intended path (distinct 0x600A advance).
    const deltaA = (r.subAfterA - r.subBefore) & 0xff;
    const deltaB = (r.subAfterB - r.subBefore) & 0xff;
    assert.equal(deltaA, expectDelta, `${name}: oracle advanced 0x600A by ${deltaA}, expected ${expectDelta}`);
    assert.equal(deltaB, expectDelta, `${name}: optimized advanced 0x600A by ${deltaB}, expected ${expectDelta}`);
    // Cycle teeth: the collapsed per-branch total must equal the oracle's per-
    // instruction sum (A and C are never reached by the whole-machine run, so this
    // is their only cycle check; B is additionally covered by EQUAL/whole).
    assert.ok(
      r.cyclesEqual,
      `${name}: cycle total differs (oracle ${r.aCycles} vs optimized ${r.bCycles})`,
    );
    console.log(`  BRANCH ${name}: EQUAL (RAM+regs+pc), 0x600A +${expectDelta}, cycle total ${r.aCycles}t (oracle==optimized)`);
  }
});
