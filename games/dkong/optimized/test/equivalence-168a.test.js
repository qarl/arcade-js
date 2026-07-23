// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_168a (0x6388-sequence step 2: a SUBSTATE_TIMER-
 * gated re-init of the 0x6908 board-object block that re-stamps one byte, clears
 * three, then tail-jumps the shared board-advance tail). Reached via rst 0x28 on
 * (0x6388)==2 through the table at 0x1623, itself dispatched from loc_1615 = the
 * 0x0702 sub-state table index 0x16 (the board-advance cutscene) while a credited
 * game runs with BOARD(0x6227) bit0 SET. Like loc_186f it runs INSIDE the vblank NMI,
 * so it is ATOMIC. sub_168a is the near-twin of loc_186f (same rst-0x18 gate + same
 * sub_004e copy prologue), so this test mirrors equivalence-186f.
 *
 * Five jobs (entry_0611's three, plus a full branch sweep and its cycle teeth):
 *
 *   1. EQUAL -- the idiomatic optimized sub_168a (optimized/sub_168a.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_168a runs
 *      neither in attract NOR in a plain coin+start into board 1 (the 0x6388-sequence
 *      is the board-ADVANCE cutscene, only reached from sub-state 0x16). It is therefore
 *      driven by an identical-both-sides POKE (the sanctioned "poke the board state"
 *      method): at frame 40 the machine is forced into GAME_SUBSTATE 0x16 / BOARD bit0
 *      set (routes loc_1615 -> table 0x1623) / selector==2 (rst-0x28 idx 2 = sub_168a) /
 *      SUBSTATE_TIMER==1, so the game's own loc_1615 -> rst-0x28 dispatch runs sub_168a
 *      EXACTLY ONCE, at frame 41, taking branch B (timer expires -> body runs, selector
 *      2->3). The poke is applied identically to baseline and optimized (shared factory).
 *
 *   3. TEETH -- a deliberately-broken twin (the first store on sub_168a's branch-B path,
 *      the first byte of sub_004e's copy at 0x6908) must be CAUGHT: NOT-EQUAL, naming
 *      0x6908.
 *
 *   4. BRANCH COVERAGE -- sub_168a has TWO data-dependent paths, keyed on the rst-0x18
 *      substate-timer gate:
 *        A. gate still counting (SUBSTATE_TIMER > 1) -> sub_0018 skips, early return; the
 *           body does not run, only 0x6009 changes and the selector stays put (delta +0).
 *        B. gate expired (SUBSTATE_TIMER == 1) -> body runs: copy 0x28 bytes 0x388C ->
 *           0x6908, stamp 0x690C=0x66, clear 0x6924/0x692C/0x62AF, then tail_1662 advances
 *           the selector (delta +1).
 *      The driven run reaches ONLY B. A is SYNTHESISED from the captured entry (poke
 *      SUBSTATE_TIMER=5), applied IDENTICALLY to the oracle and optimized clones, and
 *      proven EQUAL (RAM+regs+pc). Each branch is distinguished by its selector delta.
 *
 *   5. CYCLE TEETH -- sub_168a is ATOMIC (runs inside the NMI), so its epilogue is
 *      collapsed to one m.step per branch. The EXACT per-cycle teeth for BOTH branch
 *      totals is the branch-coverage sweep's cycle-total assertion (optimized == oracle,
 *      exact: branch A 59 t total, branch B 1579 t total -- of which sub_168a's OWN
 *      charges are 11 t and 111 t; the rest is its identical m.call'd callees). Branch A
 *      is not reached by the whole-machine run at all, so the sweep is its only cycle
 *      check; a wrong collapsed epilogue total is shown to be caught (not vacuous).
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Like loc_186f,
 * sub_168a needs game state harness.js's input-free factory can never reach, so this
 * test calls the SAME core unitEquivalence / wholeMachineEquivalence, passing a
 * makeMachine factory that adds an identical coin+start inputTape AND the identical
 * board-advance pokes to BOTH baseline and optimized machines. Nothing about the
 * capture / clone / diff / invocation-counter logic is re-implemented -- it is the
 * standard engine, reached the way harness.js reaches it (the snapshot override is
 * installed at CONSTRUCTION through the factory, so it reaches sub_168a however it is
 * first entered). Any poke/tape is applied identically to both sides.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_168a as translated_168a } from "../../translated/state0.js";
import { sub_168a as optimized_168a } from "../sub_168a.js";
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

const TARGET = 0x168a;
const FRAMES = 50; // sub_168a first (and only) dispatches at frame 41
const MAX_FRAMES = 45; // enough to reach that first entry

const SUBSTATE_TIMER = 0x6009;
const GAME_SUBSTATE = 0x600a;
const BOARD = 0x6227;
const SELECTOR = 0x6388; // the 0x6388-sequence selector sub_168a's tail advances

// A coin+start tape (identical to loc_186f's): coin on IN2 bit7 at frame 10, start1
// on IN2 bit2 at frame 30. This credits + starts a game so GAME_STATE reaches 3.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// Board-advance pokes, applied at the frame-40 boundary (dur 1). They force the state
// the 0x6388-sequence dispatch requires: sub-state 0x16 (loc_1615), BOARD bit0 SET (so
// loc_1615's `rrca` routes to table 0x1623 = [1654,1670,168a,...]), selector 2 (rst-0x28
// idx 2 = sub_168a), and SUBSTATE_TIMER 1 (so the rst-0x18 gate expires immediately and
// sub_168a takes branch B on its single dispatch at frame 41). Identical on both sides --
// the ONLY difference between the baseline and optimized runs is sub_168a.
const ADVANCE_POKES = [
  { addr: GAME_SUBSTATE, val: 0x16, frame: 40, dur: 1 },
  { addr: BOARD, val: 0x01, frame: 40, dur: 1 }, // bit0 set -> table 0x1623
  { addr: SELECTOR, val: 0x02, frame: 40, dur: 1 }, // idx 2 -> sub_168a
  { addr: SUBSTATE_TIMER, val: 0x01, frame: 40, dur: 1 },
];

// The makeMachine factory the core engine drives (the same shape harness.js's
// dkMachineFactory produces), extended to attach the coin+start inputTape and the
// board-advance pokes. Called with no argument for the baseline and with the wrapped
// override map for the optimized side -- both get the SAME tape and pokes.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = ADVANCE_POKES.map((p) => ({ ...p }));
  return m;
}

// The first store on sub_168a's branch-B path that lands in the compared dump: the
// first byte of sub_004e's 0x28-byte copy, 0x6908 <- (0x388C). sub_168a fires only at
// frame 41 and does not run again, so the corrupted cell persists to that frame's
// boundary and the whole-machine diff catches it. (0x690C/0x6924/0x692C are unsuitable:
// the copy writes them and sub_168a immediately overwrites them, so a first-write flip
// is lost -- verified. 0x6908 is the first CORRUPTED address; nothing below it differs.)
const BROKEN_ADDR = 0x6908;

/**
 * Deliberately-broken twin: behaviourally optimized_168a EXCEPT the first store to
 * 0x6908 lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly that
 * one write lets the routine and every subroutine it calls run verbatim -- the
 * representative "wrong value to an address on the routine's path" bug the gate must
 * catch.
 */
function broken_168a(m) {
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
    return optimized_168a(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_168a matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_168a]]));

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
      `${r.invocations.get(TARGET)}x (branch B: selector 2->3, block re-init)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_168a matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_168a, optimized_168a, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, HL, DE, BC, SP) + pc identical (first entry: branch B)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong store on the routine's path is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_168a]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong store on the routine's path is CAUGHT and names 0x6908", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_168a, broken_168a, { maxFrames: MAX_FRAMES });

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

// Capture the pristine machine state at sub_168a's FIRST dispatch (branch B, frame
// 41), via the same construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_168a(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`sub_168a never dispatched within ${MAX_FRAMES} frames`);
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
  const startCyclesA = a.cycles;
  const startCyclesB = b.cycles;
  const selBefore = a.mem.read8(SELECTOR);

  translated_168a(a);
  optimized_168a(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return {
    ram,
    regs,
    pcEqual: a.pc === b.pc,
    cyclesEqual: (a.cycles - startCyclesA) === (b.cycles - startCyclesB),
    aCycles: a.cycles - startCyclesA,
    bCycles: b.cycles - startCyclesB,
    selBefore,
    selAfterA: a.mem.read8(SELECTOR),
    selAfterB: b.mem.read8(SELECTOR),
  };
}

test("BRANCH COVERAGE + CYCLE: A (gate counting), B (body + advance) each EQUAL", () => {
  const entry = captureEntry();

  // The captured entry is branch B's state (SUBSTATE_TIMER==1, selector==2).
  const branches = [
    { name: "A gate-counting", poke: [{ addr: SUBSTATE_TIMER, val: 5 }], expectDelta: 0 },
    { name: "B body+advance",  poke: [],                                 expectDelta: 1 },
  ];

  for (const { name, poke, expectDelta } of branches) {
    const r = runBranch(entry, poke);

    assert.equal(r.ram, null, r.ram ? `${name}: RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
    assert.equal(r.regs, null, r.regs ? `${name}: reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
    assert.ok(r.pcEqual, `${name}: pc mismatch`);
    // Prove this arm actually took the intended path (distinct selector advance).
    const deltaA = (r.selAfterA - r.selBefore) & 0xff;
    const deltaB = (r.selAfterB - r.selBefore) & 0xff;
    assert.equal(deltaA, expectDelta, `${name}: oracle advanced 0x6388 by ${deltaA}, expected ${expectDelta}`);
    assert.equal(deltaB, expectDelta, `${name}: optimized advanced 0x6388 by ${deltaB}, expected ${expectDelta}`);
    // Cycle teeth: the collapsed per-branch total must equal the oracle's per-
    // instruction sum (branch A is never reached by the whole-machine run, so this
    // is its only cycle check; B is additionally covered by EQUAL/whole).
    assert.ok(
      r.cyclesEqual,
      `${name}: cycle total differs (oracle ${r.aCycles} vs optimized ${r.bCycles})`,
    );
    console.log(`  BRANCH ${name}: EQUAL (RAM+regs+pc), 0x6388 +${expectDelta}, cycle total ${r.aCycles}t (oracle==optimized)`);
  }

  // ...and the cycle-total assertion is not vacuous: a 1-cycle error in the collapsed
  // epilogue total (the m.step(0x1662, 73) charge) makes branch B's totals disagree.
  const a = entry.clone();
  const b = entry.clone();
  const a0 = a.cycles, b0 = b.cycles;
  translated_168a(a);
  const realStep = b.step.bind(b);
  b.step = (addr, cyc) => realStep(addr, addr === 0x1662 ? cyc - 1 : cyc);
  try { optimized_168a(b); } finally { b.step = realStep; }
  assert.notEqual(b.cycles - b0, a.cycles - a0, "branch-B cycle-total assertion has no teeth");
  console.log("  CYCLE TEETH: a 1 t error in the collapsed epilogue total is caught");
});
