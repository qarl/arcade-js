// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_17b6 (the 0x6388-sequence SETUP arm: entry 0
 * of sub_1641's rst-0x28 table at 0x1648). It is dispatched from INSIDE the vblank
 * NMI during BOARD-ADVANCE: dispatchGameState(GAME_STATE(0x6005)==3) -> loc_06fe ->
 * loc_1615 (GAME_SUBSTATE(0x600A)==0x16) -> sub_1641 (BOARD(0x6227) low two bits
 * clear, e.g. 0x04=100m) -> rst 0x28 on the 0x6388 selector -> this routine when
 * 0x6388==0. It renders the four "how-high" glyphs, arms the phase timer, advances
 * the selector, and repoints the shared rate-limiter.
 *
 * Six jobs, as for loc_0a8a (straight-line: no data-dependent branch) plus the
 * force-poke driving loc_128b/loc_127c use to reach a deep in-game sub-state:
 *
 *   1. EQUAL -- the idiomatic optimized loc_17b6 (optimized/loc_17b6.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      routes through dispatchGameState's override consult (nmi.js), inert when the
 *      map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_17b6
 *      runs only after board 4 is cleared, which a bounded boot never reaches
 *      (probed: 0 hits in 1500 coin+start frames). So these tests force it with an
 *      IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke the board state to reach a
 *      state for validation" -- applied to baseline and optimized alike, so
 *      equivalence is preserved): from frame 100 it HOLDS GAME_STATE(0x6005)=3,
 *      GAME_SUBSTATE(0x600A)=0x16 (board-advance), BOARD(0x6227)=4 (routes to the
 *      0x1648 table), and the selector 0x6388=0 (entry 0 = loc_17b6). Held across
 *      the window so loc_17b6 dispatches every frame (~40x). Threaded via a custom
 *      makeMachine factory (m.pokes) driving the game-agnostic CORE engine.
 *
 *   3. TEETH -- a deliberately-broken twin (the first EPILOGUE store, 0x6905 <-
 *      0x13, lands the wrong value) must be CAUGHT: NOT-EQUAL, naming 0x6905, whole
 *      and unit. (loc_17b6's literal first stores 0x608A/0x608B are the sound
 *      scheduler's SND_PRIORITY pair, re-managed within a frame, so a flip there
 *      does not persist; 0x6905 is written exactly once and by nothing else, so it
 *      persists. Corrupting the 0x6388 selector instead would change the dispatch
 *      index and crash into an untranslated arm, so it is unsuitable.)
 *
 *   4. SINGLE PATH + CYCLE TOTAL -- loc_17b6 is STRAIGHT-LINE (no data-dependent
 *      branch; the four render pairs are a fixed unroll), so the one reachable path
 *      IS full branch coverage, exercised by EQUAL/whole (override fires) and pinned
 *      in isolation here: on a captured entry the optimized total equals the
 *      oracle's exactly, and a 1-cycle error in the collapsed epilogue is caught.
 *
 *   5. CYCLE (unit, isolated) -- with all six callees stubbed to charge nothing,
 *      loc_17b6's OWN charge is 506t on BOTH oracle and optimized (the collapse is a
 *      redistribution of the SAME total, not a cheaper one).
 *
 *   6. CYCLE (whole-machine) -- a WRONG collapsed total (505: epilogue 96 not 97)
 *      is CAUGHT and NOT-EQUAL, proving the collapsed total is load-bearing.
 *
 * THE CYCLE FINDING this routine adds: loc_17b6 is ATOMIC because it is dispatched
 * from inside the NMI, where the mask is held -- the vblank NMI can never land
 * inside it OR any of its six callees (0x011C/0x0514/0x1826/0x0DA7/0x004E/0x0038),
 * which all run with interrupts disabled. So its ~35 per-instruction m.step charges
 * collapse to one per call-segment plus one call-free epilogue (own total 506t),
 * each charge placed immediately before its call so every callee still starts at
 * the oracle's exact cumulative cycle. The TOTAL stays load-bearing -- as part of
 * the NMI's cost it sets the main-loop vblank-spin count (README §2) -- so the sum
 * is preserved exactly; a wrong 505 diverges at STACK 0x6BF7 (an NMI-pushed PC in
 * diffed stack RAM), the same downstream-landing mechanism as loc_0a8a/entry_0611.
 * loc_17b6 makes NO hardware writes (all stores are work/video RAM), so unlike
 * loc_0a8a the collapse has no --writes-trace consequence and no write-trace test.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_17b6 as translated_17b6 } from "../../translated/state0.js";
import { loc_17b6 as optimized_17b6 } from "../loc_17b6.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
  unitEquivalence as coreUnitEquivalence,
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

const TARGET = 0x17b6;
const POKE_FRAME = 100;
const HOLD_DUR = 40; // held across the rest of the window so loc_17b6 dispatches ~40x
const FRAMES = 140; // run ends within the hold, so no post-hold untranslated arm is reached
const OWN_CYCLES = 506; // loc_17b6's own charge (callees excluded)
const CALLEES = [0x011c, 0x0514, 0x1826, 0x0da7, 0x004e, 0x0038];
const EPILOGUE_STEP = 0x1825; // the address of the collapsed epilogue m.step
const BROKEN_ADDR = 0x6905; // first epilogue store (0x13); written once, persists

// Identical-both-sides poke that forces board-advance / the 0x1648 table / selector
// 0. Held (dur = HOLD_DUR) so loc_17b6 dispatches every frame of the window. A fresh
// copy per machine keeps each run independent.
const FORCE_17B6_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_STATE = 3 (in-game)
  { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_SUBSTATE = 0x16 (board-advance)
  { addr: 0x6227, val: 0x04, frame: POKE_FRAME, dur: HOLD_DUR }, // BOARD = 4 -> 0x1648 table
  { addr: 0x6388, val: 0x00, frame: POKE_FRAME, dur: HOLD_DUR }, // selector 0 -> loc_17b6
];

// The engine's factory: a DK Machine on this ROM with the force poke loaded. Called
// with no argument for the baseline and with the wrapped override map for the
// optimized side; both get the SAME poke, so any state forcing is applied identically.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_17B6_POKE.map((p) => ({ ...p }));
  return m;
};

// loc_17b6's first epilogue store is 0x6905. The broken twin lands the correct value
// XOR 0xFF there (guaranteed to differ). Intercepting exactly that one write lets
// every subroutine and the rest of the routine run verbatim -- the representative
// "wrong value to one of the routine's own output addresses" bug the gate must catch.
function broken_17b6(m) {
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
    return optimized_17b6(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// A WRONG-total twin: byte-for-byte optimized_17b6 but charges 96 for the collapsed
// epilogue instead of 97 (total 505 not 506). Used to prove the collapsed total has
// teeth -- a cheaper NMI shifts where a later frame's NMI lands in diffed stack RAM.
function wrongTotal_17b6(m) {
  const realStep = m.step.bind(m);
  m.step = (addr, cyc) => realStep(addr, addr === EPILOGUE_STEP ? cyc - 1 : cyc);
  try {
    return optimized_17b6(m);
  } finally {
    m.step = realStep;
  }
}

// -- pristine-entry capture (for the isolated single-path / cycle checks) --------

/** Capture the machine the instant loc_17b6 is FIRST entered (frame 101). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_17b6(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_17b6 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry; return {machine, cyclesSpent}. */
function runClone(fn) {
  const c = ENTRY.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_17b6 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_17b6]]));

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
      `override fired ${r.invocations.get(TARGET)}x (board-advance, forced)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_17b6 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_17b6, optimized_17b6, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong epilogue store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_17b6]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong epilogue store is CAUGHT and names 0x6905", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_17b6, broken_17b6, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- SINGLE PATH + CYCLE TOTAL ------------------------------------------------

test("SINGLE PATH + CYCLE TOTAL: the one straight-line path is EQUAL and preserves the total", () => {
  // loc_17b6 has no data-dependent branch: one path, exercised in isolation here.
  const a = runClone(translated_17b6);
  const b = runClone(optimized_17b6);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // Committed cycle teeth for the collapsed path: the optimized total equals the
  // oracle's exactly (both run the same six callees via m.call, so the delta pins
  // loc_17b6 proper = 506t + the callees' identical charges).
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);

  // ...and the assertion is not vacuous: a 1-cycle error in the collapsed epilogue
  // total makes the totals disagree.
  const wrong = runClone(wrongTotal_17b6);
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t; wrong-total caught`);
});

test("CYCLE (unit, isolated): loc_17b6's OWN charge is 506t on both oracle and optimized", () => {
  // Stub every callee to charge nothing; the m.cycles delta is then exactly
  // loc_17b6's own contribution. The collapse redistributes the SAME 506t.
  const measure = (fn) => {
    const c = ENTRY.clone();
    for (const addr of CALLEES) c.routines.set(addr, () => {}); // no-op, charges nothing
    const before = c.cycles;
    fn(c);
    return c.cycles - before;
  };
  assert.equal(measure(translated_17b6), OWN_CYCLES, "oracle own-cycles != 506");
  assert.equal(measure(optimized_17b6), OWN_CYCLES, "optimized own-cycles != 506");
  console.log(`  CYCLE/unit: own total = ${OWN_CYCLES}t on oracle and optimized (distribution collapsed, total preserved)`);
});

test("CYCLE (whole-machine): a WRONG collapsed total (505) is CAUGHT and NOT-EQUAL", () => {
  // The collapsed 506 is load-bearing: this frame's NMI cost sets the main-loop spin
  // count (PRNG entropy) and where a LATER frame's NMI lands in diffed stack RAM.
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongTotal_17b6]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong collapsed total slipped through — the total has no teeth");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  CYCLE/whole: wrong total 505 caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});
