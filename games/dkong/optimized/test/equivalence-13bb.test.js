// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_13bb (idx 19 of the in-game 0x0702 sub-state
 * table: a small state RESET -- clear 0x600D/0x600E, clear GAME_SUBSTATE, drive the
 * flip-screen latch to 1). The near-twin of loc_13aa (idx 18). Reached via
 * dispatchGameState (the NMI game-state path) -> loc_06fe while GAME_STATE(0x6005)==3
 * and GAME_SUBSTATE(0x600A)==0x13 (the ROM table at 0x0702 maps index 0x13 -> 0x13BB).
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_13bb reads EQUAL against
 *      its translated oracle in RAM and in the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *   3. SINGLE PATH + CYCLE TOTAL -- loc_13bb is STRAIGHT-LINE (no data-dependent
 *      control branch, and its one hardware write carries a CONSTANT 1, not data), so
 *      the one reachable path is the whole of its behaviour. Because that path is
 *      COLLAPSED, the test pins its cycle TOTAL (70t) to the oracle's and shows a
 *      wrong total is caught. There is no data-dependent branch or payload to
 *      synthesise -- this single path IS full coverage.
 *   4. WRITE-TRACE -- loc_13bb makes its OWN hardware write (the flip-screen latch
 *      0x7D82). The RAM+regs gate can't see the emit.js --writes trace's cycle
 *      column, so this proves the write lands at the oracle's exact bus cycle
 *      (+54t) -- and that a fully-collapsed body would shift it (teeth).
 *   5. TEETH (whole + unit) -- a deliberately-wrong output store is CAUGHT, naming
 *      the diverging address (0x600D).
 *
 * WHY THIS TEST DRIVES INPUT + A POKE (and uses core/equivalence.js directly, like
 * equivalence-13aa / equivalence-0a8a). Sub-state 0x13 is only reached deep in
 * gameplay; it never occurs in a short boot/attract window. So both gates feed the
 * canonical coin+start tape (IN2 coin 0x80, then IN2 start1 0x04) to reach GAME_STATE
 * 3, then poke GAME_SUBSTATE (0x600A) = 0x13 at frame 120 so the next NMI dispatches
 * loc_13bb. The poke is applied IDENTICALLY on both sides (baked into makeMachine), so
 * any downstream flow it disturbs is disturbed identically -- EQUAL holds iff the
 * optimized routine is correct. With this driving loc_13bb dispatches EXACTLY ONCE, at
 * frame 120; FRAMES = 180 covers it plus ~60 downstream frames so a wrong cycle total
 * surfaces. (The DK harness.js wrappers bake neither the timed tape nor the poke, so --
 * exactly as loc_13aa does for its hardware write -- this drives the game-agnostic CORE
 * equivalence engine through a custom makeMachine factory. The core engine is still the
 * standard gate; it installs the snapshot override at CONSTRUCTION, so nothing here
 * open-codes a reach-the-routine workaround.)
 *
 * THE CYCLE FINDING this routine adds (a mirror of loc_13aa): loc_13bb is ATOMIC and
 * COLLAPSED, but only PARTIALLY. It runs INSIDE the vblank NMI (dispatchGameState),
 * which does not re-enter, and it CALLS nothing (a leaf), so the NMI never lands inside
 * it -- its internal cycle distribution is unobservable and the body collapses to one
 * 47t charge (total 70t preserved). The one m.step granularity kept is the 47t body
 * charge BEFORE the flip-screen write -- so that hardware write keeps its exact +54t
 * bus cycle in the trace, which the RAM gate cannot police (see WRITE-TRACE below).
 * The structural difference from loc_13aa: loc_13aa writes the latch FIRST (13t before
 * it), loc_13bb writes it LAST (47t before it).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_13bb as translated_13bb } from "../../translated/state0.js";
import { loc_13bb as optimized_13bb } from "../loc_13bb.js";
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

const TARGET = 0x13bb;
const POKE_FRAME = 120; // GAME_STATE is 3 well before here
const FRAMES = 180; // loc_13bb dispatches exactly once, at frame 120

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80)
// then IN2 start1 (0x04) so the ROM's own credit/start logic starts a game.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// Force GAME_SUBSTATE(0x600A) = 0x13 at POKE_FRAME so the next NMI dispatches
// loc_13bb (idx 19 of the 0x0702 table). Applied identically to both sides.
const SUBSTATE_POKE = [{ addr: 0x600a, val: 0x13, frame: POKE_FRAME, dur: 1 }];

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

// loc_13bb's own output store the teeth corrupt: 0x600D (cleared to 0). It is one of
// the routine's own outputs, sits in the compared work-RAM dump, is not rewritten in
// the run window, and -- unlike 0x600A (the control selector, whose corruption
// dispatches an untranslated sub-state and stops the run) -- does NOT alter control
// flow, so a wrong value there persists. (0x7D82 is a hardware latch, outside the
// compared dump, so it is unsuitable for the RAM teeth -- it is policed instead by the
// WRITE-TRACE test.)
const BROKEN_ADDR = 0x600d;

function broken_13bb(m) {
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
    return optimized_13bb(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated single-path / cycle / trace checks) --

/** Capture the machine the instant loc_13bb is FIRST entered (frame 120). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_13bb(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_13bb never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry; return {m, cycles}. */
function runClone(fn) {
  const c = ENTRY.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Run `fn` on a fresh clone with the hardware write-trace recording. */
function traceClone(fn) {
  const c = ENTRY.clone();
  c.mem.writeTrace = []; // clock is () => c.cycles from the constructor
  const c0 = c.cycles;
  fn(c);
  // Report each write's cycle RELATIVE to entry so it is base-independent.
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_13bb matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_13bb]]));

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

test("EQUAL (unit): idiomatic optimized loc_13bb matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_13bb, optimized_13bb, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- SINGLE PATH + CYCLE TOTAL ------------------------------------------------

test("SINGLE PATH + CYCLE TOTAL: the one straight-line path is EQUAL and preserves the total", () => {
  // loc_13bb has no data-dependent control branch (and its hardware write carries a
  // constant 1, not data): one path, exercised in isolation.
  const a = runClone(translated_13bb);
  const b = runClone(optimized_13bb);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // Committed cycle teeth for the collapsed path: the optimized total equals the
  // oracle's exactly (70t = 4+13+13+13+4+13 + ret 10).
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);
  assert.equal(a.cycles, 70, `oracle total expected 70t, got ${a.cycles}`);

  // ...and the assertion is not vacuous: a 1-cycle error in the collapsed body total
  // makes the totals disagree.
  const wrong = runClone((m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x13c6 ? cyc - 1 : cyc);
    try { return optimized_13bb(m); } finally { m.step = realStep; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t; wrong-total caught`);
});

// -- WRITE-TRACE (the hardware-write bus cycle the RAM gate cannot see) --------

test("WRITE-TRACE: the flip-screen write lands at the oracle's exact bus cycle", () => {
  const oracleTrace = traceClone(translated_13bb);
  const optTrace = traceClone(optimized_13bb);

  // Exactly one hardware write: flip-screen 0x7D82 <- 1 @ +54t (the whole body's 47t,
  // plus the ld(nn),a bus offset 7 the oracle tags). The value is a constant 1.
  assert.deepEqual(
    oracleTrace,
    [{ rel: 54, addr: 0x7d82, value: 1 }],
    "oracle hardware-write trace is not the expected single flip-screen write",
  );
  assert.deepEqual(optTrace, oracleTrace, "optimized flip-screen write bus cycle differs from the oracle");

  // Teeth: a FULLY-collapsed body (the write BEFORE the lump charge) would shift it to
  // +7t -- proving the partial collapse is what preserves the trace.
  const flat = traceClone((m) => {
    const { regs, mem } = m;
    regs.xor(regs.a);
    mem.write8(0x600d, regs.a);
    mem.write8(0x600e, regs.a);
    mem.write8(0x600a, regs.a);
    regs.a = regs.inc8(regs.a);
    mem.write8(0x7d82, regs.a, 7); // written at cumulative 0 -> +7t, not +54t
    m.step(0x13c9, 60); // whole routine (minus ret) in one lump: 4+13+13+13+4+13
    m.ret();
  });
  assert.notDeepEqual(flat, oracleTrace, "write-trace check has no teeth");
  console.log("  WRITE-TRACE: flip-screen write @ +54t identical to oracle; flat-body variant caught");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong reset store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_13bb]]));

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
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_13bb, broken_13bb, { maxFrames: FRAMES });

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
