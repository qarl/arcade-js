// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_13a1 (0x0702 table idx 0x11: counter-gated
 * substate select, the TWIN of loc_138f). Dispatched from INSIDE the NMI as
 * table[0x11] of loc_06fe's 0x0702 rst-0x28 substate dispatch (GAME_STATE 3,
 * GAME_SUBSTATE 0x600A == 0x11), reached via dispatchGameState -> loc_06fe.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized loc_13a1
 *      (optimized/loc_13a1.js) reads EQUAL against its translated oracle, every
 *      frame. The override routes through dispatchGameState's override consult
 *      (nmi.js), inert when the map is empty.
 *
 *   2. EQUAL (unit) -- EQUAL in RAM + the whole register file (incl. F) + pc, on
 *      the naturally-captured first entry (the nonzero WORK branch).
 *
 *   3. TEETH (whole-machine) -- a deliberately-broken twin (the first store on the
 *      routine's path -- sub_0018's dec of SUBSTATE_TIMER 0x6009, reached through
 *      loc_13a1's own `rst 0x18` gate -- lands the wrong value) must be CAUGHT:
 *      NOT-EQUAL, naming a diverging address. (0x6009 is control-flow-safe as a
 *      corruption target -- see the poke design below -- whereas corrupting
 *      GAME_SUBSTATE 0x600A is masked by the sustaining poke, so 0x600A is
 *      exercised by the unit TEETH instead.)
 *
 *   4. TEETH (unit) -- loc_13a1's OWN primary output store is broken: on the
 *      captured WORK entry the write to GAME_SUBSTATE (0x600A) -- the routine's own
 *      `ld (0x600a),a`, not a callee's -- lands the wrong value, and the gate must
 *      catch it and name 0x600A.
 *
 *   5. FULL BRANCH COVERAGE -- loc_13a1's three data-dependent branches each proven
 *      EQUAL on a synthesised entry (RAM + registers + pc), AND -- because the tail
 *      cycles are COLLAPSED to one charge per branch -- each branch's CYCLE TOTAL
 *      is asserted equal to the oracle's, so a wrong collapsed total has teeth even
 *      for the arm the whole-machine run does not reach:
 *        A  gate-skip (SUBSTATE_TIMER != 1)      -> early return, no body writes
 *        B  WORK nonzero (0x6040 != 0)           -> C = 0x17, GAME_SUBSTATE = 0x17
 *        C  WORK zero    (0x6040 == 0)           -> C = 0x14, GAME_SUBSTATE = 0x14
 *      Branch C (P1 context byte zero) never occurs on the natural run, so it is
 *      reached only by synthesis here.
 *
 * WHY THIS TEST DRIVES A TAPE + POKE (and, like loc_1880/loc_084b, cannot use
 * games/dkong/optimized/harness.js directly). loc_13a1 NEVER dispatches from boot:
 * measured 0 hits across 6000 attract frames (idx 0x11 is a late in-game substate
 * select not reached by the attract demo). So a coin+start tape establishes a real
 * in-game state-3 context (GAME_STATE reaches 3 by frame 92), then an IDENTICAL-
 * BOTH-SIDES poke (Karl's sanctioned "poke the board state to reach a state for
 * validation") forces the dispatch from frame 131: GAME_SUBSTATE(0x600A)=0x11
 * (SUSTAINED so loc_13a1 keeps dispatching -- its own write of 0x17/0x14 is
 * re-forced to 0x11 before the next state sample), plus SUBSTATE_TIMER(0x6009)=1
 * ONCE (dur 1) to kick the `rst 0x18` gate into its self-sustaining WORK cycle:
 * loc_13a1's own `inc (hl)` re-arms 0x6009 to 1 every frame, so it stays 1 with a
 * single kick (measured: 70 WORK dispatches, 0 skips). Poking 0x6009 only once
 * leaves it UN-masked from frame 131, which is what makes it the whole-machine
 * TEETH target. Threaded via a custom `makeMachine` factory (m.inputTape +
 * m.pokes) driving the game-agnostic CORE engine (core/equivalence.js) -- the
 * SAME construction-time snapshot override the DK harness wrapper uses, with a
 * factory that can carry the tape + poke, which the wrapper's fixed (rom, assets)
 * factory cannot.
 *
 * THE COLLAPSE FINDING this routine shares with its sibling loc_12de: loc_13a1 is
 * ATOMIC because it is dispatched from inside the NMI, where the NMI mask is held
 * (entry_0066 cleared 0x7D84) -- the vblank NMI can never land inside it, and its
 * only callee sub_0018 does not re-enable the mask. Collapsing the post-gate tail
 * to one charge folded onto the ret stays EQUAL whole-machine AND unit (verified
 * here, incl. the explicit per-branch cycle totals: nonzero tail 82t, zero tail
 * 89t; the rst 0x18 keeps its own 11t before the m.call). The TOTAL is preserved
 * because the NMI handler's cumulative cost feeds mainLoop's vblank-spin count
 * that seeds the PRNG (README §2); only the internal DISTRIBUTION is free.
 * loc_13a1 makes no hardware (0x7Dxx) writes -- only SUBSTATE_TIMER + GAME_SUBSTATE
 * work RAM -- so there is no write-bus-cycle trace to preserve and the collapse is
 * unconditional.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_13a1 as translated_13a1 } from "../../translated/state0.js";
import { loc_13a1 as optimized_13a1 } from "../loc_13a1.js";
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

const TARGET = 0x13a1;
const FRAMES = 200; // loc_13a1 is forced to dispatch from frame 131 (poke at 130)
const POKE_FRAME = 130;
const MAXFRAMES_UNIT = 160; // enough to reach the first (frame-131) entry

const SUBSTATE_TIMER = 0x6009; // the rst-0x18 gate counter; whole-machine TEETH target
const GAME_SUBSTATE = 0x600a; // the routine's primary output; unit TEETH target
const P1_CONTEXT = 0x6040; // P1's saved LIVES; the branch decider (nonzero -> 0x17)

// Canonical coin+start tape: reach in-game GAME_STATE 3 (a real board context) so the
// 0x06FE state-3 handler dispatches the 0x0702 substate table.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// Identical-both-sides poke that forces the idx-0x11 dispatch to loc_13a1 every
// frame from 131. GAME_SUBSTATE is SUSTAINED (loc_13a1's own write to 0x17/0x14 is
// re-forced to 0x11 before the next state sample); SUBSTATE_TIMER is kicked ONCE
// (dur 1) so it stays UN-masked as the whole-machine TEETH target while loc_13a1's
// own inc self-sustains it at 1. Applied identically to baseline and optimized.
const FORCE_13A1_POKE = [
  { addr: 0x600a, val: 0x11, frame: POKE_FRAME, dur: FRAMES }, // GAME_SUBSTATE = idx 0x11 -> loc_13a1
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // kick the rst-0x18 gate into the WORK cycle
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape and the
// force-13a1 poke loaded. Called with no argument for the baseline and with the
// wrapped override map for the optimized side (the core engine wraps each override
// with its own invocation counter, so an EQUAL that never dispatched cannot pass
// vacuously). A fresh copy per machine keeps each run independent.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = FORCE_13A1_POKE.map((p) => ({ ...p }));
  return m;
};

/**
 * Deliberately-broken twin factory: behaviourally the optimized handler EXCEPT the
 * first store to `addr` lands a wrong value (the correct byte XOR 0xFF, guaranteed
 * to differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim -- the representative "wrong value to one
 * of the routine's own output addresses" bug the gate must catch.
 */
function makeBroken(addr) {
  return function broken(m) {
    const realWrite = m.mem.write8.bind(m.mem);
    let broke = false;
    m.mem.write8 = (a, value, busOffset) => {
      if (!broke && a === addr) {
        broke = true;
        return realWrite(a, value ^ 0xff, busOffset);
      }
      return realWrite(a, value, busOffset);
    };
    try {
      return optimized_13a1(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}

const brokenTimer = makeBroken(SUBSTATE_TIMER); // whole-machine TEETH (control-flow-safe, un-masked)
const brokenSubstate = makeBroken(GAME_SUBSTATE); // unit TEETH: the routine's own output

// -- shared entry snapshot for the synthesised branch tests --------------------
// Capture the machine at the instant loc_13a1 is first entered, ONCE, and clone
// it per branch. (The unit harness does the same internally for tests 2 and 4.)
let ENTRY = null;
function capturedEntry() {
  if (ENTRY) return ENTRY;
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_13a1(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(MAXFRAMES_UNIT);
  assert.ok(entry !== null, "loc_13a1 never entered — cannot synthesise branches");
  ENTRY = entry;
  return ENTRY;
}

/**
 * Run oracle and optimized from an identical synthesised entry (SUBSTATE_TIMER and
 * the P1_CONTEXT byte poked to force a branch), and return the RAM/reg/pc diffs
 * plus each side's cycle delta across the routine (the teeth on the collapsed
 * total -- a clone's frame machinery is neutralised, so only the routine ticks).
 */
function runBranch(timer, p1ctx) {
  const base = capturedEntry();
  const a = base.clone();
  a.mem.write8(SUBSTATE_TIMER, timer);
  a.mem.write8(P1_CONTEXT, p1ctx);
  const b = base.clone();
  b.mem.write8(SUBSTATE_TIMER, timer);
  b.mem.write8(P1_CONTEXT, p1ctx);

  const ca0 = a.cycles;
  const cb0 = b.cycles;
  translated_13a1(a);
  optimized_13a1(b);

  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pcEqual: a.pc === b.pc,
    cyclesOracle: a.cycles - ca0,
    cyclesOptimized: b.cycles - cb0,
    substateAfter: a.mem.read8(GAME_SUBSTATE),
    timerAfter: a.mem.read8(SUBSTATE_TIMER),
    cAfter: a.regs.c,
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_13a1 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_13a1]]));

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
      `override fired ${r.invocations.get(TARGET)}x (nonzero WORK branch)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_13a1 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_13a1, optimized_13a1, { maxFrames: MAXFRAMES_UNIT });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (first entry = nonzero WORK branch)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SUBSTATE_TIMER store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, brokenTimer]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong GAME_SUBSTATE store is CAUGHT and names 0x600A", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_13a1, brokenSubstate, { maxFrames: MAXFRAMES_UNIT });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    GAME_SUBSTATE,
    `expected first diff at the broken address 0x${GAME_SUBSTATE.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (RAM + regs + pc + collapsed cycle total) ------------

test("BRANCH A (gate-skip): EQUAL RAM + regs + pc + cycle total", () => {
  const r = runBranch(8, 0x03); // SUBSTATE_TIMER != 1 -> rst 0x18 dec 8->7 skips, early return
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch A cycle total must equal the oracle's");
  // Non-vacuous: gate skipped -> GAME_SUBSTATE untouched (still the poked 0x11),
  // SUBSTATE_TIMER decremented 8 -> 7 by sub_0018 (no re-arm inc reached).
  assert.equal(r.substateAfter, 0x11, "gate-skip must leave GAME_SUBSTATE untouched");
  assert.equal(r.timerAfter, 7, "gate-skip must leave SUBSTATE_TIMER dec'd to 7 (no re-arm)");
  console.log(`  BRANCH A (gate-skip): EQUAL, cycles ${r.cyclesOptimized} (== oracle)`);
});

test("BRANCH B (WORK, 0x6040 != 0): EQUAL RAM + regs + pc + cycle total", () => {
  const r = runBranch(1, 0x03); // gate expires, P1_CONTEXT nonzero -> C = 0x17, GAME_SUBSTATE = 0x17
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch B cycle total must equal the oracle's");
  // Non-vacuous: nonzero -> C/GAME_SUBSTATE = 0x17, SUBSTATE_TIMER re-armed to 1.
  assert.equal(r.cAfter, 0x17, "WORK-nonzero must leave C = 0x17");
  assert.equal(r.substateAfter, 0x17, "WORK-nonzero must set GAME_SUBSTATE = 0x17");
  assert.equal(r.timerAfter, 1, "WORK must re-arm SUBSTATE_TIMER to 1");
  console.log(`  BRANCH B (WORK nonzero): EQUAL, cycles ${r.cyclesOptimized} (== oracle; collapsed tail 82)`);
});

test("BRANCH C (WORK, 0x6040 == 0): EQUAL RAM + regs + pc + cycle total", () => {
  const r = runBranch(1, 0x00); // gate expires, P1_CONTEXT zero -> C = 0x14, GAME_SUBSTATE = 0x14 (never natural)
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch C cycle total must equal the oracle's");
  // Non-vacuous: zero -> C/GAME_SUBSTATE = 0x14, SUBSTATE_TIMER re-armed to 1.
  assert.equal(r.cAfter, 0x14, "WORK-zero must leave C = 0x14");
  assert.equal(r.substateAfter, 0x14, "WORK-zero must set GAME_SUBSTATE = 0x14");
  assert.equal(r.timerAfter, 1, "WORK must re-arm SUBSTATE_TIMER to 1");
  console.log(`  BRANCH C (WORK zero): EQUAL, cycles ${r.cyclesOptimized} (== oracle; collapsed tail 89)`);
});
