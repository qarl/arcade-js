// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_13aa (idx 18 of the in-game 0x0702 sub-state
 * table: a small state RESET -- mirror DIP_UPRIGHT to the flip-screen latch, clear
 * GAME_SUBSTATE, set 0x600D/0x600E = 1). Reached via dispatchGameState (the NMI
 * game-state path) -> loc_06fe while GAME_STATE(0x6005)==3 and
 * GAME_SUBSTATE(0x600A)==0x12.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_13aa reads EQUAL against
 *      its translated oracle in RAM and in the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *   3. SINGLE PATH + CYCLE TOTAL -- loc_13aa is STRAIGHT-LINE (no data-dependent
 *      control branch), so the one reachable path is what the gates exercise.
 *      Because that path is COLLAPSED, the test also pins its cycle TOTAL (79t) to
 *      the oracle's, and shows a wrong total is caught.
 *   4. DATA-DEPENDENT VALUE -- the routine has no control branch, but the byte it
 *      writes to the flip-screen latch is DATA-dependent (a copy of DIP_UPRIGHT).
 *      Both cabinet settings (0 cocktail / 1 upright) are proven EQUAL in RAM+regs
 *      and in the write-trace value column -- the "different payload" coverage.
 *   5. WRITE-TRACE -- loc_13aa makes its OWN hardware write (the flip-screen latch
 *      0x7D82). The RAM+regs gate can't see the emit.js --writes trace's cycle
 *      column, so this proves the write lands at the oracle's exact bus cycle
 *      (+20t) -- and that a fully-collapsed prologue would shift it (teeth).
 *   6. TEETH (whole + unit) -- a deliberately-wrong output store is CAUGHT, naming
 *      the diverging address (0x600D).
 *
 * WHY THIS TEST DRIVES INPUT + A POKE (and uses core/equivalence.js directly, like
 * equivalence-0a8a). Sub-state 0x12 is only reached deep in gameplay (loc_196b, the
 * computed level-transition, writes (0x600E)+0x12 to 0x600A). It never occurs in a
 * short boot/attract window. So both gates feed the canonical coin+start tape (IN2
 * coin 0x80, then IN2 start1 0x04) to reach GAME_STATE 3, then poke GAME_SUBSTATE
 * (0x600A) = 0x12 at frame 120 so the next NMI dispatches loc_13aa. The poke is
 * applied IDENTICALLY on both sides (baked into makeMachine), so any downstream
 * flow it disturbs is disturbed identically -- EQUAL holds iff the optimized
 * routine is correct. With this driving loc_13aa dispatches EXACTLY ONCE, at frame
 * 120; FRAMES = 180 covers it plus ~60 downstream frames so a wrong cycle total
 * surfaces. (The DK harness.js wrappers bake neither the timed tape nor the poke,
 * so -- exactly as loc_0a8a does for its hardware write -- this drives the
 * game-agnostic CORE equivalence engine through a custom makeMachine factory. The
 * core engine is still the standard gate; it installs the snapshot override at
 * CONSTRUCTION, so nothing here open-codes a reach-the-routine workaround.)
 *
 * THE CYCLE FINDING this routine adds: loc_13aa is ATOMIC and COLLAPSED, but only
 * PARTIALLY. It runs INSIDE the vblank NMI (dispatchGameState), which does not
 * re-enter, and it CALLS nothing (a leaf), so the NMI never lands inside it -- its
 * internal cycle distribution is unobservable and the tail collapses to one 56t
 * charge (total 79t preserved). The prologue keeps the one 13t m.step before the
 * flip-screen write ONLY so that hardware write keeps its exact +20t bus cycle in
 * the trace, which the RAM gate cannot police (see WRITE-TRACE below).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_13aa as translated_13aa } from "../../translated/state0.js";
import { loc_13aa as optimized_13aa } from "../loc_13aa.js";
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

const TARGET = 0x13aa;
const POKE_FRAME = 120; // GAME_STATE is 3 well before here
const FRAMES = 180; // loc_13aa dispatches exactly once, at frame 120

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80)
// then IN2 start1 (0x04) so the ROM's own credit/start logic starts a game.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// Force GAME_SUBSTATE(0x600A) = 0x12 at POKE_FRAME so the next NMI dispatches
// loc_13aa (idx 18 of the 0x0702 table). Applied identically to both sides.
const SUBSTATE_POKE = [{ addr: 0x600a, val: 0x12, frame: POKE_FRAME, dur: 1 }];

// The engine's factory: a DK Machine on this ROM with the coin+start tape AND the
// identical substate poke loaded. Called with no argument for the baseline and with
// the wrapped override map for the optimized side (the core engine wraps each
// override with its own invocation counter, so an EQUAL that never dispatched
// cannot pass vacuously). Fresh copies per machine keep each run independent.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = SUBSTATE_POKE.map((p) => ({ ...p }));
  return m;
};

// loc_13aa's own output store the teeth corrupt: 0x600D (set to 1). It is one of
// the routine's own outputs, sits in the compared work-RAM dump, is not rewritten
// in the run window, and -- unlike 0x600A (the control selector, whose corruption
// dispatches an untranslated sub-state and stops the run) -- does NOT alter control
// flow, so a wrong value there persists. (0x7D82 is a hardware latch, outside the
// compared dump, so it is unsuitable for the RAM teeth -- it is policed instead by
// the WRITE-TRACE test.)
const BROKEN_ADDR = 0x600d;

function broken_13aa(m) {
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
    return optimized_13aa(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated single-path / value / trace checks) --

/** Capture the machine the instant loc_13aa is FIRST entered (frame 120). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_13aa(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_13aa never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;
// The value the flip-screen write carries on this entry = DIP_UPRIGHT (0x6026).
const DIP_UPRIGHT_AT_ENTRY = ROM_PRESENT ? ENTRY.mem.read8(0x6026) : null;

/** Run `fn` on a fresh clone of the entry; return {m, cycles}. */
function runClone(fn) {
  const c = ENTRY.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Run `fn` on a fresh clone of the entry with 0x6026 preset; return {m, cycles}. */
function runCloneWithDip(fn, dip) {
  const c = ENTRY.clone();
  c.mem.write8(0x6026, dip);
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Run `fn` on a fresh clone with the hardware write-trace recording (0x6026 preset). */
function traceClone(fn, dip = DIP_UPRIGHT_AT_ENTRY) {
  const c = ENTRY.clone();
  c.mem.write8(0x6026, dip);
  c.mem.writeTrace = []; // clock is () => c.cycles from the constructor
  const c0 = c.cycles;
  fn(c);
  // Report each write's cycle RELATIVE to entry so it is base-independent.
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_13aa matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_13aa]]));

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
      `override fired ${r.invocations.get(TARGET)}x (frame ${POKE_FRAME})`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_13aa matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_13aa, optimized_13aa, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- SINGLE PATH + CYCLE TOTAL ------------------------------------------------

test("SINGLE PATH + CYCLE TOTAL: the one straight-line path is EQUAL and preserves the total", () => {
  // loc_13aa has no data-dependent control branch: one path, exercised in isolation.
  const a = runClone(translated_13aa);
  const b = runClone(optimized_13aa);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // Committed cycle teeth for the collapsed path: the optimized total equals the
  // oracle's exactly (79t = 13+13+4+13+10+16 + ret 10).
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);
  assert.equal(a.cycles, 79, `oracle total expected 79t, got ${a.cycles}`);

  // ...and the assertion is not vacuous: a 1-cycle error in the collapsed tail
  // total makes the totals disagree.
  const wrong = runClone((m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x13ba ? cyc - 1 : cyc);
    try { return optimized_13aa(m); } finally { m.step = realStep; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t; wrong-total caught`);
});

// -- DATA-DEPENDENT VALUE (the "different payload" coverage) -------------------

test("DATA-DEPENDENT VALUE: both cabinet DIPs (0 cocktail / 1 upright) are EQUAL", () => {
  for (const dip of [0, 1]) {
    const a = runCloneWithDip(translated_13aa, dip);
    const b = runCloneWithDip(optimized_13aa, dip);
    const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.m.regs, b.m.regs);
    assert.equal(ram, null, ram ? `dip=${dip}: RAM diff at 0x${ram.addr.toString(16)}` : "");
    assert.equal(regs, null, regs ? `dip=${dip}: reg diff at ${regs.reg}` : "");
    assert.equal(a.m.pc, b.m.pc, `dip=${dip}: pc must match`);

    // The flip-screen write carries exactly the DIP value, at the same bus cycle.
    const oTrace = traceClone(translated_13aa, dip);
    const bTrace = traceClone(optimized_13aa, dip);
    assert.deepEqual(oTrace, [{ rel: 20, addr: 0x7d82, value: dip }], `dip=${dip}: oracle trace`);
    assert.deepEqual(bTrace, oTrace, `dip=${dip}: optimized flip-screen write differs`);
  }
  console.log("  VALUE: flip-screen write == DIP for both 0 (cocktail) and 1 (upright); RAM+regs EQUAL");
});

// -- WRITE-TRACE (the hardware-write bus cycle the RAM gate cannot see) --------

test("WRITE-TRACE: the flip-screen write lands at the oracle's exact bus cycle", () => {
  const oracleTrace = traceClone(translated_13aa);
  const optTrace = traceClone(optimized_13aa);

  // Exactly one hardware write: flip-screen 0x7D82 <- DIP_UPRIGHT @ +20t (the
  // first instruction's 13t, plus the ld(nn),a bus offset 7 the oracle tags).
  assert.deepEqual(
    oracleTrace,
    [{ rel: 20, addr: 0x7d82, value: DIP_UPRIGHT_AT_ENTRY }],
    "oracle hardware-write trace is not the expected single flip-screen write",
  );
  assert.deepEqual(optTrace, oracleTrace, "optimized flip-screen write bus cycle differs from the oracle");

  // Teeth: a FULLY-collapsed prologue (the write BEFORE the lump charge) would
  // shift it to +7t -- proving the partial collapse is what preserves the trace.
  const flat = traceClone((m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x6026);
    mem.write8(0x7d82, regs.a, 7); // written at cumulative 0 -> +7t, not +20t
    regs.xor(regs.a);
    mem.write8(0x600a, regs.a);
    regs.hl = 0x0101;
    mem.write16(0x600d, regs.hl);
    m.step(0x13ba, 69); // whole routine (minus ret) in one lump
    m.ret();
  });
  assert.notDeepEqual(flat, oracleTrace, "write-trace check has no teeth");
  console.log("  WRITE-TRACE: flip-screen write @ +20t identical to oracle; flat-prologue variant caught");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong reset store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_13aa]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong reset store is CAUGHT and names 0x600D", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_13aa, broken_13aa, { maxFrames: FRAMES });

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
