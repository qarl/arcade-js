// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_1654 (0x1644-sequence idx 0: spawn a board
 * object + copy its template + arm the sub-state timer, then fall through into the
 * shared tail_1662). Dispatched from INSIDE the NMI as entry 0 of loc_1615's 0x1623
 * rst-0x28 table, reached via dispatchGameState -> loc_1615 (GAME_SUBSTATE
 * 0x600A==0x16, board-advance) when BOARD(0x6227) has bit0 SET (an odd board),
 * indexed by the sequence selector 0x6388==0.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized sub_1654 (optimized/sub_1654.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_1654 is
 *      reached via `m.call(0x1654)` from dispatchGameState (nmi.js), so the registry
 *      override (+ its invocation counter) resolves there.
 *
 *   3. TEETH -- a deliberately-broken twin (the routine's only own store, the
 *      SUBSTATE_TIMER arm at 0x6009, lands a wrong value) must be CAUGHT: NOT-EQUAL,
 *      naming 0x6009. (tail_1662's rst-0x30 reads BOARD but never writes 0x6009, so
 *      the corrupted arm stays observable in the unit dump.)
 *
 *   4/5. FULL BRANCH COVERAGE. sub_1654 is STRAIGHT-LINE -- no data-dependent branch
 *      of its own: call 0x1708, ldir via 0x004e, arm 0x6009, fall through to
 *      tail_1662, whose return it propagates (the caller-skip signal). So there is
 *      one path. It is proven EQUAL (RAM + all registers + pc) on a SYNTHESISED entry
 *      (a real captured dispatch), shown non-vacuously to have run the whole chain
 *      (the 0x6A20 spawn record stamped, 0x6009 armed to 0x20, the 0x6388 selector
 *      inc'd by the tail), AND -- because the routine is CYCLE-COLLAPSED -- the
 *      synthesised path also asserts its total cycle count equals the oracle's
 *      (measured across the routine on both clones), the teeth on a wrong collapsed
 *      total.
 *
 * WHY THIS TEST DRIVES A TAPE + POKE (like loc_1880/loc_084b, cannot use
 * games/dkong/optimized/harness.js directly). sub_1654 NEVER dispatches from boot:
 * it is a board-advance staging step deep in gameplay. So a coin+start tape
 * establishes a real in-game state-3 context, then an IDENTICAL-BOTH-SIDES poke
 * (Karl's sanctioned "poke the board state to reach a state for validation") forces
 * the dispatch from frame 131: GAME_SUBSTATE(0x600A)=0x16 (board-advance),
 * BOARD(0x6227)=1 (bit0 set -> the 0x1623 table), selector 0x6388=0 (idx 0 ->
 * sub_1654). The selector is re-seeded to 0 every frame (the tail inc's it to 1),
 * so sub_1654 keeps dispatching. Threaded via a custom `makeMachine` factory
 * (m.inputTape + m.pokes) driving the game-agnostic CORE engine
 * (core/equivalence.js) -- the SAME construction-time snapshot override the DK
 * harness wrapper uses, with a factory that can carry the tape + poke.
 *
 * THE COLLAPSE FINDING this routine adds: sub_1654 is ATOMIC because it is dispatched
 * from inside the NMI, where the NMI mask is held (entry_0066 clears 0x7D84) -- the
 * vblank NMI can never land inside it OR its callees (0x1708, 0x004e, 0x1662).
 * Collapsing its per-instruction m.step charges to one charge per inter-call segment
 * (17 / 27 / 20, own total 64) stays EQUAL whole-machine AND unit (verified here,
 * incl. the explicit cycle total). The TOTAL is preserved because the NMI's
 * cumulative cost feeds mainLoop's vblank-spin count (README §2); only the internal
 * DISTRIBUTION is free. sub_1654 makes no hardware (0x7Dxx) writes -- its sole own
 * store is work RAM SUBSTATE_TIMER(0x6009) -- so there is no write-bus-cycle trace to
 * preserve and the collapse is unconditional.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_1654 as translated_1654 } from "../../translated/state0.js";
import { sub_1654 as optimized_1654 } from "../sub_1654.js";
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

const TARGET = 0x1654;
const FRAMES = 180; // sub_1654 is forced to dispatch from frame 131 (poke at 130)
const POKE_FRAME = 130;

const TIMER = 0x6009; // SUBSTATE_TIMER -- sub_1654's only own store (arm to 0x20)
const SELECTOR = 0x6388; // the 0x1623 sequence selector; the tail inc's it
const SPAWN_RECORD = 0x6a20; // first byte of 0x1708's object record (0x80)

// Canonical coin+start tape: reach in-game GAME_STATE 3 (a real board context) so the
// 0x06FE state-3 handler dispatches the 0x0702 idx-0x16 board-advance path.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// Identical-both-sides poke that forces the board-advance dispatch to sub_1654 idx 0.
// Sustained (dur covers the compared window) so sub_1654 keeps dispatching: the tail's
// inc(0x6388)->1 is reset to 0 before the next frame's state sample, and 0x600A is
// re-forced to the board-advance sub-state. Applied identically to baseline + optimized.
const FORCE_1654_POKE = [
  { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: FRAMES }, // GAME_SUBSTATE = board-advance
  { addr: 0x6227, val: 0x01, frame: POKE_FRAME, dur: FRAMES }, // BOARD = 1 (bit0 set) -> 0x1623 table
  { addr: 0x6388, val: 0x00, frame: POKE_FRAME, dur: FRAMES }, // selector -> idx 0 = sub_1654
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape and the
// force-1654 poke loaded. Called with no argument for the baseline and with the
// wrapped override map for the optimized side (the core engine wraps each override
// with its own invocation counter, so an EQUAL that never dispatched cannot pass
// vacuously). A fresh copy per machine keeps each run independent.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = FORCE_1654_POKE.map((p) => ({ ...p }));
  return m;
};

// sub_1654's only own store is the SUBSTATE_TIMER arm at 0x6009 (0x20). The broken
// twin lands the correct value XOR 0xFF there (guaranteed to differ). Neither callee
// writes 0x6009 (0x1708 -> 0x6A20/0x6905/0x608A, 0x004e -> 0x6908.., tail_1662 ->
// 0x6388/0x690B-chain), so intercepting the first 0x6009 write hits exactly
// sub_1654's own store and lets every callee run verbatim.
function broken_1654(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === TIMER) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_1654(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_1654 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_1654]]));

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
      `override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_1654 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1654, optimized_1654, { maxFrames: 160 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SUBSTATE_TIMER arm is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_1654]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong SUBSTATE_TIMER arm is CAUGHT and names 0x6009", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1654, broken_1654, { maxFrames: 160 });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    TIMER,
    `expected first diff at 0x${TIMER.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (single straight-line path, incl. cycle total) ------

/**
 * Capture ONE real entry to sub_1654 (via the engine's construction-time snapshot
 * override on the tape+poke-driven host). Reusing a real captured entry gives a valid
 * stack (the routine's ret unwinds it), a realistic board object block, and a live
 * board context for the callees.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_1654(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(160);
  assert.ok(entry !== null, "failed to capture a sub_1654 entry to prove the path from");
  return entry;
}

test("PATH (straight-line): spawn + copy + arm + tail — EQUAL + cycle total", () => {
  const entry = captureEntry();
  const selBefore = entry.mem.read8(SELECTOR);

  const a = entry.clone(); // translated oracle
  const b = entry.clone(); // optimized

  const aCyc0 = a.cycles;
  translated_1654(a);
  const oracleCycles = a.cycles - aCyc0;

  const bCyc0 = b.cycles;
  optimized_1654(b);
  const optCycles = b.cycles - bCyc0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, "pc must match");

  // Teeth on the COLLAPSED cycle total: a wrong per-segment sum is caught here.
  assert.equal(optCycles, oracleCycles, `cycle total ${optCycles} != oracle ${oracleCycles}`);

  // Non-vacuous: confirm the whole straight-line chain actually ran.
  assert.equal(a.mem.read8(SPAWN_RECORD), 0x80, "0x1708 must stamp the 0x6A20 record (80 ..)");
  assert.equal(a.mem.read8(TIMER), 0x20, "the SUBSTATE_TIMER arm (0x6009 = 0x20) must persist");
  assert.equal(
    a.mem.read8(SELECTOR),
    (selBefore + 1) & 0xff,
    `tail_1662 must inc the 0x6388 selector (${selBefore} -> ${a.mem.read8(SELECTOR)})`,
  );
  console.log(
    `  PATH: EQUAL (RAM+regs+pc); ${oracleCycles}t both sides; ` +
      `0x6388 ${selBefore} -> ${a.mem.read8(SELECTOR)}, 0x6009 armed to 0x${a.mem.read8(TIMER).toString(16)}`,
  );
});
