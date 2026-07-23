// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_09d6 (the in-game GAME_STATE==3 board-setup
 * arm reached at GAME_SUBSTATE==2: clear two board control latches, enqueue two
 * draw tasks via sub_309f, arm sub-state 5, then FALL THROUGH into sub_09ee to
 * paint one tilemap column). Reached from dispatchGameState (the NMI's rst-0x28
 * game-state path) as table entry 2 of loc_06fe's 0x0702 table.
 *
 * Six jobs:
 *
 *   1. EQUAL -- the idiomatic optimized sub_09d6 (optimized/sub_09d6.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *
 *   3. SINGLE PATH + CYCLE -- sub_09d6 is straight-line (no data-dependent branch
 *      of its own; the only conditionals live inside its callees), so it has ONE
 *      branch, exercised end-to-end by the driven run. Because that branch is
 *      COLLAPSED (per-instruction m.step charges folded to one per straight-line
 *      segment), a committed cycle test asserts the collapsed TOTAL equals the
 *      oracle's own-instruction sum (measured on clones): 57 + 27 + 20 = 104.
 *
 *   4. CYCLE TEETH -- a twin with a WRONG total (its m.step charges stripped) must
 *      be CAUGHT by the whole-machine gate at SPIN_COUNT 0x6019, proving the
 *      preserved total is load-bearing and the gate has teeth on it.
 *
 *   5. TEETH (whole-machine) -- a deliberately-broken twin (a wrong value to one of
 *      the routine's own output stores) must be CAUGHT: NOT-EQUAL, naming 0x74A0.
 *
 *   6. TEETH (unit) -- the same wrong store is CAUGHT in isolation and names 0x74A0.
 *
 * WHY THIS TEST DRIVES INPUT (and uses core/equivalence.js directly, like
 * equivalence-08f8/06fe). sub_09d6 is the 2-PLAYER board-setup arm: loc_09ab (the
 * preceding sub-state) only routes to GAME_SUBSTATE==2 when the two-player marker
 * 0x600F is non-zero, which loc_08f8's 2-player start sets. So it NEVER dispatches
 * in attract or in a 1-player game. These tests feed the machine a coin+coin+start2
 * tape (2 credits, IN2 coin 0x80 twice, then IN2 start2 0x08) via a custom
 * makeMachine factory and drive the game-agnostic CORE equivalence engine with it
 * -- the DK harness.js wrapper bakes `inputs` but not the timed `inputTape`, which
 * is why the factory is built here. The core engine is still the standard gate (it
 * installs the snapshot override at CONSTRUCTION, so nothing here open-codes a
 * reach-the-routine workaround). With this tape sub_09d6 dispatches EXACTLY ONCE,
 * at frame 44; FRAMES = 80 covers it.
 *
 * THE CYCLE FINDING this routine adds (same as loc_08f8, via SPIN_COUNT): sub_09d6
 * is ATOMIC and COLLAPSED. It runs INSIDE the vblank NMI, which does not re-enter,
 * so no NMI lands inside it or its short callees -- the boot+2coin+start2 probe
 * dispatched it once with the NMI landing inside it ZERO times. So each straight-
 * line segment charges its per-instruction tstate SUM (folding the following CALL's
 * 17t) in one m.step; sub_309f/sub_09ee keep charging themselves. Whole-machine
 * EQUAL confirms the total exactly -- stripping the charges diverges at SPIN_COUNT
 * 0x6019 (job 4). See optimized/sub_09d6.js for the full decision.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_09d6 as translated_09d6 } from "../../translated/state0.js";
import { sub_09d6 as optimized_09d6 } from "../sub_09d6.js";
import { Machine } from "../../machine.js";
import {
  unitEquivalence,
  wholeMachineEquivalence,
} from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x09d6;
const FRAMES = 80; // sub_09d6 dispatches exactly once, at frame 44

// Canonical 2-player coin+start tape: pulse IN2 coin (0x80) TWICE for two credits,
// then IN2 start2 (0x08), so the ROM's own credit/start logic starts a 2-player
// game (which sets 0x600F != 0 and routes board setup through GAME_SUBSTATE==2 =
// sub_09d6). A fresh copy per machine keeps each run's tape independent.
const COIN_START2_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin 1
  { port: 0x7d00, bits: 0x80, frame: 20, dur: 6 }, // coin 2
  { port: 0x7d00, bits: 0x08, frame: 40, dur: 6 }, // start2 (IN2 bit 0x08)
];

// The engine's factory: a DK Machine on this ROM with the coin+start2 tape loaded.
// Called with no argument for the baseline and with the wrapped override map for
// the optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously). Both sides get
// the SAME tape, so any input is applied identically.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START2_TAPE.map((t) => ({ ...t }));
  return m;
};

// sub_09d6's path writes VRAM 0x74A0 (value 0x20) via its callee sub_09ee -- a
// pure-data tilemap output inside the compared dump (video RAM 0x7400-0x77FF),
// written once during this one-time board-setup step and not rewritten in the run
// window, so a wrong value there persists. (Corrupting the control byte 0x600A
// instead crashes the downstream sub-state dispatch rather than diffing cleanly, so
// 0x74A0 is the representative "wrong value to one of the routine's own output
// addresses" bug the gate must catch -- the same choice pattern as entry_0611's
// 0x759F, a store made inside a callee on the routine's path.)
const BROKEN_ADDR = 0x74a0;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x74A0 lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim -- the representative "wrong value to one
 * of the routine's own output addresses" bug the gate must catch.
 */
function broken_09d6(m) {
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
    return optimized_09d6(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Cycle-teeth twin: behaviourally the optimized handler, but every m.step charge is
 * forced to 0 -- i.e. a WRONG total. A frame that reaches the vblank spin sooner
 * spins one extra time and reseeds the PRNG, so this must diverge at SPIN_COUNT
 * (0x6019). Proves the collapsed total is not a free parameter.
 */
function strippedCycles_09d6(m) {
  const realStep = m.step.bind(m);
  m.step = (addr) => realStep(addr, 0);
  try {
    return optimized_09d6(m);
  } finally {
    m.step = realStep;
  }
}

// -- pristine-entry capture (for the cycle-total assertion) --------------------

/**
 * Capture the machine at the instant sub_09d6 is FIRST (and only) entered
 * (frame 44), via the same construction-time snapshot the core unit gate uses.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_09d6(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error(`sub_09d6 never dispatched within ${FRAMES} frames`);
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Total T-states a routine consumes when run on a fresh clone of the entry. */
function cyclesOf(fn) {
  const c = ENTRY.clone();
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_09d6 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_09d6]]));

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
      `override fired ${r.invocations.get(TARGET)}x (2-player board setup, frame 44)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_09d6 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_09d6, optimized_09d6, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, DE, SP) + pc identical");
});

// -- SINGLE PATH + CYCLE ------------------------------------------------------

test("SINGLE PATH + CYCLE: the one straight-line branch preserves the oracle's cycle total", () => {
  // sub_09d6 has no data-dependent branch of its own, so there is exactly one path.
  // It is COLLAPSED, so pin the total: optimized == translated == 104 own T-states
  // (57 + 27 + 20), plus the identical callee cost on both sides.
  const t = cyclesOf(translated_09d6);
  const o = cyclesOf(optimized_09d6);
  assert.equal(o, t, `collapsed total ${o} != oracle total ${t}`);
  console.log(`  CYCLE: collapsed total == oracle total (${o} T-states over the whole routine)`);
});

// -- CYCLE TEETH --------------------------------------------------------------

test("CYCLE TEETH (whole-machine): a WRONG cycle total is CAUGHT at SPIN_COUNT 0x6019", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, strippedCycles_09d6]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "cycle-teeth override must have dispatched");
  assert.equal(r.equal, false, "a wrong total was NOT caught — the preserved total would be a free parameter");
  assert.equal(r.addr, 0x6019, `expected divergence at SPIN_COUNT 0x6019, got 0x${(r.addr ?? 0).toString(16)}`);
  console.log(
    `  CYCLE TEETH: wrong total caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs stripped ${r.optimized})`,
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong tilemap store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_09d6]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong tilemap store is CAUGHT and names 0x74A0", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_09d6, broken_09d6, { maxFrames: FRAMES });

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
