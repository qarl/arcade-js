// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_09fe (the PLAYER-2 CONTEXT RESTORE: copy P2's
 * saved 8-byte context into the live player block, re-derive BOARD from the
 * restored sequence pointer, and arm the sub-state machine). Reached from
 * dispatchGameState (the NMI's rst-0x28 game-state dispatch) as a game-state-3
 * sub-state, the moment control passes to player 2 in a 2-player game.
 *
 * Five jobs, as for entry_0611, plus the cycle-collapse teeth:
 *
 *   1. EQUAL -- the idiomatic optimized sub_09fe (optimized/sub_09fe.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      routes through dispatchGameState's override consult (nmi.js), inert when
 *      the map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_09fe
 *      is NEVER reached in attract, nor at a 1-player start, nor even at a 2-player
 *      START: it needs control to pass to player 2, i.e. player 1 must lose a life
 *      in a credited 2-player game (verified: 0 dispatches over 4000 attract frames;
 *      0 at 1P start; 0 at 2P start until the switch). We drive it the cheap
 *      deterministic way: TWO coins + START2, then leave Mario idle so the bonus
 *      timer expires and player 1 dies -- control passes to player 2 and sub_09fe
 *      dispatches at frame 1661 (stable). A 1700-frame window covers it.
 *
 *   3. BRANCH COVERAGE + CYCLE TOTAL -- sub_09fe is STRAIGHT-LINE: no data-dependent
 *      branch (unlike its P1 twin loc_09ab, which branches on 0x600F; this P2 variant
 *      hard-codes the 0x78 / sub-state-4 arm). One path, so the EQUAL gates above are
 *      full branch coverage. Because the routine's cycles are COLLAPSED to one total
 *      (see below), this test also pins that total with teeth: it measures the cycle
 *      delta across the routine on an oracle clone and an optimized clone (both must
 *      be exactly 279), and proves a WRONG collapsed total is CAUGHT whole-machine --
 *      so the collapse cannot be silently off.
 *
 *   4. TEETH -- a deliberately-broken twin (the SUBSTATE_TIMER store at 0x6009 lands
 *      the wrong value) must be CAUGHT: NOT-EQUAL, naming 0x6009. (sub_09fe writes no
 *      video RAM; every output feeds control flow, so the target is chosen for a
 *      clean, non-crashing, persisting divergence -- corrupting LIVES 0x6228 instead
 *      overruns the lives-display draw into unmapped RAM, and corrupting GAME_SUBSTATE
 *      0x600A dispatches an out-of-range sub-state. 0x6009 is the lowest-address
 *      output and a countdown timer that persists with a constant offset -- clean.)
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). The engine that
 * proves equivalence lives in core/equivalence.js; games/dkong/optimized/harness.js is
 * a thin wrapper that bakes in a `makeMachine` factory built on `{}` assets -- which
 * drives NO input, so it can never reach a credited 2-player game and never dispatches
 * sub_09fe. This test therefore calls the SAME core unitEquivalence /
 * wholeMachineEquivalence directly, passing a makeMachine factory that adds an
 * identical coin+start inputTape to BOTH the baseline and optimized machines (the
 * factory is the wrapper's only job). Nothing about the capture / clone / diff /
 * invocation-counter logic is re-implemented -- it is the standard engine, reached the
 * way harness.js reaches it, with the input the routine requires. Any poke/tape is
 * applied identically to both sides (the factory is shared). Same approach as
 * equivalence-06fe.test.js.
 *
 * CYCLE FINDING this routine adds: sub_09fe is ATOMIC (no call to an interruptible
 * routine, and it runs inside the vblank NMI whose mask is cleared on entry, so no
 * nested NMI). Collapsing its per-instruction m.step charges to ONE total (279 t) on
 * the ret stays EQUAL whole-machine AND unit. The total is still load-bearing: a wrong
 * total diverges through the main-loop spin count (0x6019) or the stack (0x6bfe), the
 * same universal mechanism as entry_0611 / loc_08b2. See optimized/sub_09fe.js.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_09fe as translated_09fe } from "../../translated/state0.js";
import { sub_09fe as optimized_09fe } from "../sub_09fe.js";
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

const TARGET = 0x09fe;
const FRAMES = 1700; // sub_09fe first dispatches at frame 1661 (2P start -> P1 dies)
const CYCLE_TOTAL = 279; // 10+10+10+163+16+7+13+7+13+7+13+10 (ldir = 7*21 + 16)

// A 2-coin + START2 tape: two coins on IN2 bit7 (frames 6 and 16), START2 on IN2
// bit3 (frame 40). This credits and starts a TWO-player game; leaving Mario idle
// then lets the bonus timer expire, so player 1 dies and control passes to player
// 2 -- the transition that dispatches sub_09fe (at frame 1661).
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 6, dur: 6 },  // coin 1 (IN2 bit7)
  { port: 0x7d00, bits: 0x80, frame: 16, dur: 6 }, // coin 2 (IN2 bit7)
  { port: 0x7d00, bits: 0x08, frame: 40, dur: 6 }, // START2 (IN2 bit3)
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

// SUBSTATE_TIMER (0x6009): sub_09fe's lowest-address output and a countdown timer,
// so a corrupt value persists in the compared dump with a constant offset (no heal)
// and does not crash the machine -- a clean representative "wrong value to one of the
// routine's own output addresses" bug for the gate to catch.
const BROKEN_ADDR = 0x6009;

/**
 * Deliberately-broken twin: behaviourally optimized_09fe EXCEPT the store to 0x6009
 * lands a wrong value (correct byte XOR 0xFF). Intercepting exactly that one write
 * lets the rest of the routine run verbatim -- the representative bug the gate must
 * catch.
 */
function broken_09fe(m) {
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
    return optimized_09fe(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * A twin whose collapsed cycle total is WRONG by one (278). Used to prove the
 * collapsed total has teeth: a wrong total must be caught whole-machine.
 */
function wrongTotal_09fe(m) {
  const orig = m.ret.bind(m);
  m.ret = (cycles) => orig(cycles === CYCLE_TOTAL ? cycles - 1 : cycles);
  try {
    return optimized_09fe(m);
  } finally {
    m.ret = orig;
  }
}

/**
 * Capture the pristine machine state at sub_09fe's FIRST dispatch (frame 1661), via
 * the same construction-time snapshot the core unit gate uses. For the cycle-total
 * measurement, which needs an entry clone to run the routine on in isolation.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_09fe(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error(`sub_09fe never dispatched within ${FRAMES} frames`);
  return entry;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_09fe matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_09fe]]));

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
      `${r.invocations.get(TARGET)}x (P2 context restore, frame 1661, via 2 coins + START2)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_09fe matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_09fe, optimized_09fe, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, DE, BC, SP) + pc identical");
});

// -- BRANCH COVERAGE + CYCLE TOTAL --------------------------------------------

test("CYCLE TOTAL (branch teeth): the single path collapses to exactly 279 t, and a wrong total is caught", () => {
  // sub_09fe is straight-line -- one path -- so the EQUAL gates are full branch
  // coverage. The one thing the collapse must get right that the unit RAM/reg diff
  // does NOT check is the cycle TOTAL, so pin it here with teeth.
  const entry = captureEntry();

  // (a) The collapsed optimized total EQUALS the oracle total, both exactly 279.
  const measure = (fn) => {
    const c = entry.clone();
    const before = c.cycles;
    fn(c);
    return c.cycles - before;
  };
  const oracleCycles = measure(translated_09fe);
  const optCycles = measure(optimized_09fe);
  assert.equal(oracleCycles, CYCLE_TOTAL, `oracle charged ${oracleCycles}, expected ${CYCLE_TOTAL}`);
  assert.equal(optCycles, CYCLE_TOTAL, `optimized charged ${optCycles}, expected ${CYCLE_TOTAL}`);

  // (b) TEETH for the collapse: a total wrong by one is CAUGHT whole-machine. A
  //     routine's total is observable (spin count / stack) even though its internal
  //     distribution is free, so an off-by-one total must NOT read EQUAL.
  const rWrong = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongTotal_09fe]]));
  assert.ok(rWrong.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(rWrong.equal, false, "a wrong collapsed cycle total must be CAUGHT — else the collapse has no teeth");
  console.log(
    `  CYCLE TOTAL: oracle == optimized == ${CYCLE_TOTAL} t (single path, collapsed); ` +
      `off-by-one total caught at frame ${rWrong.frame}, addr 0x${(rWrong.addr ?? 0).toString(16)}`,
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SUBSTATE_TIMER store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_09fe]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong SUBSTATE_TIMER store is CAUGHT and names 0x6009", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_09fe, broken_09fe, { maxFrames: FRAMES });

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
