// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_09ee (the shared 3-cell tilemap-column draw
 * fragment: three fixed tiles into VRAM 0x74E0/0x74C0/0x74A0 — the P2 "2UP" marker
 * column). It is a LEAF reached via `m.call` from three sites, all inside the vblank
 * NMI: handler_0779 (attract, when 0x600F==1), sub_09d6 (2-player board-setup arm,
 * FALLS THROUGH into it) and sub_0a1b (2-player setup step, CALLs it).
 *
 * Six jobs:
 *
 *   1. EQUAL -- the idiomatic optimized sub_09ee (optimized/sub_09ee.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *
 *   3. SINGLE PATH + CYCLE -- sub_09ee is straight-line (no data-dependent branch:
 *      always the same three stores), so it has exactly ONE path, exercised end-to-
 *      end by the driven run. Because that branch is COLLAPSED (six per-instruction
 *      m.step charges folded to one), a committed cycle test asserts the collapsed
 *      TOTAL equals the oracle's own-instruction sum (measured on clones): 60 (the
 *      six stores, 7+13 x3) + 10 (ret) = 70 T-states.
 *
 *   4. CYCLE TEETH -- a twin with a WRONG total (its m.step charges stripped) must be
 *      CAUGHT by the whole-machine gate. sub_09ee runs inside the NMI during board
 *      setup, so dropping its 60t makes the frame cheaper and shifts WHERE the NMI's
 *      pushed PC lands -- the divergence surfaces at a STACK address (observed 0x6bf4,
 *      the entry_0611 pushed-PC mechanism) rather than at its caller sub_09d6's
 *      SPIN_COUNT 0x6019. Either way it proves the preserved total is load-bearing,
 *      not a free parameter; the test asserts the CATCH, not the surface address.
 *
 *   5. TEETH (whole-machine) -- a deliberately-broken twin (a wrong value to one of
 *      the routine's own output stores) must be CAUGHT: NOT-EQUAL, naming 0x74A0.
 *
 *   6. TEETH (unit) -- the same wrong store is CAUGHT in isolation and names 0x74A0.
 *
 * WHY THIS TEST DRIVES INPUT (and uses core/equivalence.js directly, like
 * equivalence-09d6/0a1b). sub_09ee's callers are all P2/2-player draws: sub_09d6 /
 * sub_0a1b run only in a 2-player game, and handler_0779's call is gated on 0x600F.
 * So sub_09ee NEVER dispatches in a fresh 1-player attract. This test feeds the
 * machine the canonical coin+coin+start2 tape (2 credits via IN2 coin 0x80 twice,
 * then IN2 start2 0x08) through a custom makeMachine factory and drives the game-
 * agnostic CORE equivalence engine with it -- the DK harness.js wrapper bakes
 * `inputs` but not the timed `inputTape`, which is why the factory is built here.
 * The core engine still installs the snapshot override at CONSTRUCTION, so it reaches
 * this leaf (entered only via m.call, not a dispatch point). With this tape sub_09ee
 * dispatches EXACTLY ONCE -- via sub_09d6's fall-through during 2-player board setup
 * (its ret returns to the NMI game-state dispatch at 0x00D2); FRAMES = 80 covers it.
 *
 * THE CYCLE FINDING this routine adds: sub_09ee is ATOMIC and COLLAPSED.
 * ATOMICITY-IS-PER-CALL-PATH holds -- all three callers reach it with the NMI mask
 * cleared (each is dispatched by the NMI, which zeroes io.nmiMask on entry), and this
 * leaf calls nothing interruptible, so no NMI can ever land inside it. Its internal
 * cycle DISTRIBUTION is therefore unobservable and the six charges fold to one 60t
 * total; the ret keeps its 10t. The TOTAL stays load-bearing (job 4) -- but where a
 * WRONG total surfaces differs from its caller sub_09d6: sub_09d6's stripped twin
 * diverges at SPIN_COUNT 0x6019, whereas sub_09ee's diverges at a STACK address
 * (0x6bf4, the NMI's pushed PC), the entry_0611 mechanism. Same conclusion, different
 * surface. See optimized/sub_09ee.js for the full decision.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_09ee as translated_09ee } from "../../translated/state0.js";
import { sub_09ee as optimized_09ee } from "../sub_09ee.js";
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

const TARGET = 0x09ee;
const FRAMES = 80; // sub_09ee dispatches exactly once (2-player board setup, ~frame 44)

// Canonical 2-player coin+start tape: pulse IN2 coin (0x80) TWICE for two credits,
// then IN2 start2 (0x08), so the ROM's own credit/start logic starts a 2-player
// game (which routes board setup through the 2-player arm sub_09d6, falling through
// into sub_09ee). A fresh copy per machine keeps each run's tape independent.
const COIN_START2_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin 1
  { port: 0x7d00, bits: 0x80, frame: 20, dur: 6 }, // coin 2
  { port: 0x7d00, bits: 0x08, frame: 40, dur: 6 }, // start2 (IN2 bit 0x08)
];

// The engine's factory: a DK Machine on this ROM with the coin+start2 tape loaded.
// Called with no argument for the baseline and with the wrapped override map for the
// optimized side (the core engine wraps each override with its own invocation counter,
// so an EQUAL that never dispatched cannot pass vacuously). Both sides get the SAME
// tape, so any input is applied identically.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START2_TAPE.map((t) => ({ ...t }));
  return m;
};

// sub_09ee's path writes VRAM 0x74A0 (value 0x20) -- a pure-data tilemap output
// inside the compared dump (video RAM 0x7400-0x77FF), written once during this
// one-time board-setup step and not rewritten in the run window, so a wrong value
// there persists. It is the lowest of the routine's three output addresses, so the
// address-ordered state diff lands on it first when only it is corrupted -- the
// representative "wrong value to one of the routine's own output stores" bug the gate
// must catch (same choice as equivalence-09d6, whose path runs THROUGH sub_09ee).
const BROKEN_ADDR = 0x74a0;

/**
 * Deliberately-broken twin: behaviourally the optimized routine EXCEPT the store to
 * 0x74A0 lands a wrong value (the correct byte XOR 0xFF, guaranteed to differ).
 * Intercepting exactly that one write lets the rest of the routine run verbatim --
 * the representative "wrong value to one of the routine's own output addresses" bug.
 */
function broken_09ee(m) {
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
    return optimized_09ee(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Cycle-teeth twin: behaviourally the optimized routine, but every m.step charge is
 * forced to 0 -- i.e. a WRONG total. A frame that reaches the vblank spin sooner
 * spins one extra time and reseeds the PRNG, so this must diverge at SPIN_COUNT
 * (0x6019). Proves the collapsed total is not a free parameter. (The ret's own 10t
 * still charges -- m.ret goes through machine.js's ret(), not m.step -- so this
 * strips the collapsed 60t, the exact quantity under test.)
 */
function strippedCycles_09ee(m) {
  const realStep = m.step.bind(m);
  m.step = (addr) => realStep(addr, 0);
  try {
    return optimized_09ee(m);
  } finally {
    m.step = realStep;
  }
}

// -- pristine-entry capture (for the cycle-total assertion) --------------------

/**
 * Capture the machine at the instant sub_09ee is FIRST (and only) entered, via the
 * same construction-time snapshot the core unit gate uses. sub_09ee is entered only
 * through m.call (sub_09d6's fall-through), which resolves through the registry built
 * at construction -- so the snapshot must be installed at construction, which
 * makeMachine does.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_09ee(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error(`sub_09ee never dispatched within ${FRAMES} frames`);
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

test("EQUAL (whole-machine): idiomatic optimized sub_09ee matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_09ee]]));

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
      `override fired ${r.invocations.get(TARGET)}x (2-player board setup, via sub_09d6)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_09ee matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_09ee, optimized_09ee, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical");
});

// -- SINGLE PATH + CYCLE ------------------------------------------------------

test("SINGLE PATH + CYCLE: the one straight-line branch preserves the oracle's cycle total", () => {
  // sub_09ee has no data-dependent branch, so there is exactly one path. It is
  // COLLAPSED, so pin the total: optimized == translated == 70 own T-states
  // (60 for the six stores + 10 for the ret).
  const t = cyclesOf(translated_09ee);
  const o = cyclesOf(optimized_09ee);
  assert.equal(o, t, `collapsed total ${o} != oracle total ${t}`);
  assert.equal(o, 70, `expected 70 T-states (60 stores + 10 ret), got ${o}`);
  console.log(`  CYCLE: collapsed total == oracle total (${o} T-states over the whole routine)`);
});

// -- CYCLE TEETH --------------------------------------------------------------

test("CYCLE TEETH (whole-machine): a WRONG cycle total is CAUGHT (stack pushed-PC shift)", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, strippedCycles_09ee]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "cycle-teeth override must have dispatched");
  assert.equal(r.equal, false, "a wrong total was NOT caught — the preserved total would be a free parameter");
  assert.ok(r.addr != null, "a caught cycle divergence must name an address");
  // sub_09ee runs inside the NMI during 2-player board setup: dropping its 60t makes
  // the frame cheaper, which shifts WHERE the NMI's pushed PC lands rather than the
  // spin count -- so the divergence surfaces at a STACK address (observed 0x6bf4, in
  // the 0x6be0-0x6c00 stack region, base 179 vs 180), the entry_0611 mechanism, not
  // its caller sub_09d6's SPIN_COUNT 0x6019. Either address proves the total is
  // load-bearing; we assert the CATCH, not the specific surface address.
  console.log(
    `  CYCLE TEETH: wrong total caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs stripped ${r.optimized}) — pushed-PC shift, not SPIN_COUNT`,
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong tilemap store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_09ee]]));

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
  const r = unitEquivalence(makeMachine, TARGET, translated_09ee, broken_09ee, { maxFrames: FRAMES });

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
