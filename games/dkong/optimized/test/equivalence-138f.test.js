// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_138f (0x0702 table idx16, ROM 0x138F): a
 * gate-clocked phase setter. It is a game-state dispatch target -- entry 16 (0x10)
 * of loc_06fe's 0x0702 rst-0x28 table -- reached from INSIDE the NMI while
 * GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==0x10. Behind a `rst 0x18` gate
 * on SUBSTATE_TIMER(0x6009) it re-arms that timer (inc (hl), 0->1) and arms the
 * NEXT substate: GAME_SUBSTATE(0x600A) := 0x17 if P2_CONTEXT(0x6048) != 0, else
 * 0x14.
 *
 * Six jobs (mirrors equivalence-1615/12de -- same NMI-path, rst-0x18-gated shape):
 *
 *   1. EQUAL (whole-machine) -- optimized loc_138f reads EQUAL against its oracle
 *      every frame, override firing many times. The override routes through
 *      dispatchGameState's consult (nmi.js), inert when the map is empty.
 *
 *   2. EQUAL (unit) -- EQUAL in RAM + every register (F included) + pc, on the
 *      naturally-captured first entry (a gate-EXPIRE, P2_CONTEXT==0 -> the 0x14 arm,
 *      which is the arm a 1-player game takes).
 *
 *   3. TEETH (whole-machine) -- a deliberately-broken twin whose `inc (hl)` re-arm
 *      of SUBSTATE_TIMER(0x6009) lands a wrong value is CAUGHT: NOT-EQUAL, naming a
 *      diverging address. 0x6009 is the control-flow-safe whole-machine target --
 *      it is NOT held by the poke, so its corruption is visible AND cascades;
 *      GAME_SUBSTATE(0x600A) is re-pinned to 0x10 by the poke each boundary, so a
 *      wrong 0x600A would be masked in the dump (that store is exercised by the
 *      unit TEETH below instead).
 *
 *   4. TEETH (unit) -- loc_138f's OWN primary output store is broken: on the
 *      natural gate-EXPIRE entry the write to GAME_SUBSTATE(0x600A) lands a wrong
 *      value, and the gate catches it and names 0x600A.
 *
 *   5/6. FULL BRANCH COVERAGE -- loc_138f's three data-dependent branches each
 *      proven EQUAL on a synthesised entry (RAM + registers + pc), AND -- because
 *      the tail cycles are COLLAPSED to one charge per branch -- each branch's
 *      CYCLE TOTAL is asserted equal to the oracle's, so a wrong collapsed total
 *      has teeth even for the arm the driven whole-machine run never reaches. A
 *      non-vacuous output probe asserts each arm's effect on GAME_SUBSTATE:
 *        A  gate-skip   (SUBSTATE_TIMER != 1)         -> early return, 0x600A unchanged
 *        B  arm 0x17    (expire, P2_CONTEXT != 0)     -> 0x600A := 0x17 (tail 72)
 *        C  arm 0x14    (expire, P2_CONTEXT == 0)     -> 0x600A := 0x14 (tail 79)
 *      Branch B (a 2-player context) never occurs on the 1-player driven run, so it
 *      is reached only by synthesis here.
 *
 * THE CYCLE FINDING this routine shares with loc_12de/loc_1615: loc_138f is ATOMIC
 * and its per-branch tail total is COLLAPSED onto the ret (arm 0x17 = 72, arm 0x14
 * = 79). It runs inside the NMI handler (mask cleared, non-reentrant; its sole
 * callee sub_0018 is a non-interruptible leaf), so its internal cycle DISTRIBUTION
 * is unobservable. The TOTAL is still load-bearing (the NMI handler's cost sets the
 * main-loop spin count that seeds the PRNG, README §2); preserving each branch's
 * total keeps the whole-machine trace identical, which tests 1 and 5 both prove.
 * The gate keeps its own charge before the m.call (rst 0x18 = 11t). No hardware
 * (0x7Dxx) write anywhere, so no write-bus-cycle trace is at stake.
 *
 * WHY THIS TEST DRIVES A POKE (like 1615/18c6/127c). loc_138f's substate 0x10 is
 * a play-start phase whose SUBSTATE_TIMER is armed to 0xC0, and it NEVER dispatches
 * from boot attract. An IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke the
 * board state to reach a state for validation") forces it from frame 100:
 * GAME_STATE=3, GAME_SUBSTATE=0x10 (held so it re-dispatches every frame -- loc_138f
 * itself moves 0x600A off 0x10), SUBSTATE_TIMER=1 for one frame to expire the gate
 * (loc_138f's own inc then re-arms it to 1 every frame after). The poke is threaded
 * via a makeMachine factory (m.pokes) driving the game-agnostic CORE engine, applied
 * to baseline and optimized alike so equivalence is preserved.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_138f as translated_138f } from "../../translated/state0.js";
import { loc_138f as optimized_138f } from "../loc_138f.js";
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

const TARGET = 0x138f;
const POKE_FRAME = 100;
const FRAMES = 130; // loc_138f is forced to dispatch from frame 101 on (~30x)
const MAXFRAMES_UNIT = 150; // enough to reach the first (frame-101) entry

const GAME_STATE = 0x6005; // ram.js GAME_STATE (=3 selects the 0x0702 dispatch)
const GAME_SUBSTATE = 0x600a; // ram.js GAME_SUBSTATE (=0x10 -> loc_138f; the routine's output)
const SUBSTATE_TIMER = 0x6009; // ram.js SUBSTATE_TIMER (the rst-0x18 gate counter)
const P2_CONTEXT = 0x6048; // ram.js P2_CONTEXT (the arm selector: !=0 -> 0x17, ==0 -> 0x14)

// Identical-both-sides poke forcing loc_138f's substate. GAME_STATE + GAME_SUBSTATE
// are HELD (loc_138f moves 0x600A off 0x10, so it must be re-pinned to re-dispatch);
// SUBSTATE_TIMER is kicked to 1 for one frame (loc_138f's own inc re-arms it after).
const FORCE_138F_POKE = [
  { addr: GAME_STATE, val: 0x03, frame: POKE_FRAME, dur: null }, // GAME_STATE = 3 (held)
  { addr: GAME_SUBSTATE, val: 0x10, frame: POKE_FRAME, dur: null }, // GAME_SUBSTATE = 0x10 (held)
  { addr: SUBSTATE_TIMER, val: 0x01, frame: POKE_FRAME, dur: 1 }, // gate expires (kick once)
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_138F_POKE.map((p) => ({ ...p }));
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
      return optimized_138f(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}

const brokenTimer = makeBroken(SUBSTATE_TIMER); // whole-machine TEETH (control-flow-safe, un-masked)
const brokenSubstate = makeBroken(GAME_SUBSTATE); // unit TEETH: the routine's own output

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_138f matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_138f]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_138f matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_138f, optimized_138f, { maxFrames: MAXFRAMES_UNIT });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (first entry = arm 0x14)");
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
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_138f, brokenSubstate, { maxFrames: MAXFRAMES_UNIT });

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

// -- FULL BRANCH COVERAGE (synthesised per-arm teeth incl. cycle totals) -------

/** Capture ONE real entry to loc_138f (via the engine's construction-time snapshot
 * override on the poke-driven host), so the synthesised arms inherit a valid stack
 * and realistic RAM. The arms then re-poke only SUBSTATE_TIMER (the gate) and
 * P2_CONTEXT (the arm selector). */
let ENTRY = null;
function capturedEntry() {
  if (ENTRY) return ENTRY;
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_138f(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(MAXFRAMES_UNIT);
  assert.ok(entry !== null, "loc_138f never entered — cannot synthesise branches");
  ENTRY = entry;
  return ENTRY;
}

/** Run oracle and optimized from an identical synthesised entry (SUBSTATE_TIMER
 * and P2_CONTEXT poked to force a branch), returning the RAM/reg/pc diffs, each
 * side's cycle delta across the routine, and the oracle's resulting GAME_SUBSTATE
 * (the non-vacuous output probe). clone() neutralises the frame machinery, so the
 * cycle count is exactly the routine's own + the identical sub_0018 callee's. */
function runBranch(timer, p2ctx) {
  const seed = capturedEntry().clone();
  seed.mem.write8(SUBSTATE_TIMER, timer);
  seed.mem.write8(P2_CONTEXT, p2ctx);
  const substateAtEntry = seed.mem.read8(GAME_SUBSTATE);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  const ca0 = a.cycles;
  const cb0 = b.cycles;
  translated_138f(a);
  optimized_138f(b);

  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pcEqual: a.pc === b.pc,
    cyclesOracle: a.cycles - ca0,
    cyclesOptimized: b.cycles - cb0,
    substateAtEntry,
    substateAfterOracle: a.mem.read8(GAME_SUBSTATE),
  };
}

test("BRANCH A (gate-skip): EQUAL RAM + regs + pc + cycle total; 0x600A unchanged", () => {
  const r = runBranch(8, 0); // SUBSTATE_TIMER != 1 -> rst 0x18 skips, early return
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch A cycle total must equal the oracle's");
  // Non-vacuous: the gate skipped, so the body never ran -- 0x600A is untouched.
  assert.equal(r.substateAfterOracle, r.substateAtEntry, "gate-skip must NOT write GAME_SUBSTATE");
  console.log(`  BRANCH A: EQUAL, cycles ${r.cyclesOptimized} (== oracle); 0x600A unchanged (0x${r.substateAfterOracle.toString(16)})`);
});

test("BRANCH B (arm 0x17, P2_CONTEXT != 0): EQUAL RAM + regs + pc + cycle total; 0x600A := 0x17", () => {
  const r = runBranch(1, 0x05); // gate expires, 0x6048 != 0 -> C stays 0x17
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch B cycle total must equal the oracle's");
  assert.equal(r.substateAfterOracle, 0x17, "arm B must set GAME_SUBSTATE := 0x17");
  console.log(`  BRANCH B: EQUAL, cycles ${r.cyclesOptimized} (== oracle; collapsed tail total 72); 0x600A := 0x17`);
});

test("BRANCH C (arm 0x14, P2_CONTEXT == 0): EQUAL RAM + regs + pc + cycle total; 0x600A := 0x14", () => {
  const r = runBranch(1, 0x00); // gate expires, 0x6048 == 0 -> C = 0x14
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch C cycle total must equal the oracle's");
  assert.equal(r.substateAfterOracle, 0x14, "arm C must set GAME_SUBSTATE := 0x14");
  console.log(`  BRANCH C: EQUAL, cycles ${r.cyclesOptimized} (== oracle; collapsed tail total 79); 0x600A := 0x14`);
});
