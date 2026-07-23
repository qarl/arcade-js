// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_12f2 (0x0702 table idx14, ROM 0x12F2): the
 * life-loss / player-context-save sub-state. It is a game-state dispatch target --
 * entry 14 (0x0E) of loc_06fe's 0x0702 rst-0x28 table -- reached from INSIDE the
 * NMI while GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==0x0E. It calls
 * sub_011c (silence sound), clears PLAY_INTRO(0x622C), `dec (LIVES)` to spend a
 * life, and `ldir`s the live 8-byte P1 context (0x6228..0x622F) down to P1_CONTEXT
 * (0x6040); then it branches on the post-decrement lives count:
 *   - lives remain  -> GAME_SUBSTATE := 0x08 (0x600F==0) or 0x17 (0x600F!=0)
 *   - no lives left -> game over: sub_13ca (score sort) / sub_1826 (VRAM fill) /
 *                      two sub_309f enqueues; SUBSTATE_TIMER:=0xC0, 0x600A:=0x10
 *
 * Six jobs (mirrors equivalence-1615 / equivalence-138f -- same NMI-path,
 * poke-driven, collapsed-cycle shape):
 *
 *   1. EQUAL (whole-machine) -- optimized loc_12f2 reads EQUAL against its oracle
 *      every frame, override firing many times. The override routes through
 *      dispatchGameState's consult (nmi.js), inert when the map is empty.
 *
 *   2. EQUAL (unit) -- EQUAL in RAM + every register (F included) + pc, on the
 *      naturally-captured first entry (LIVES held at 5 -> the continue arm).
 *
 *   3. TEETH (whole-machine) -- a broken twin whose first ldir save-store to
 *      P1_CONTEXT(0x6040) lands a wrong value is CAUGHT. 0x6040 is a plain work-RAM
 *      data cell in the diffed dump (NOT re-pinned by the poke and NOT a dispatch
 *      index), so its corruption is visible and persists every frame.
 *
 *   4. TEETH (unit) -- loc_12f2's OWN primary output store is broken: on the
 *      continue-arm entry the write to GAME_SUBSTATE(0x600A) lands a wrong value,
 *      and the gate catches it and names 0x600A.
 *
 *   5. FULL BRANCH COVERAGE -- loc_12f2's four data-dependent paths each proven
 *      EQUAL on a synthesised entry (RAM + registers + pc), AND -- because the
 *      cycles are COLLAPSED to one charge per segment -- each path's CYCLE TOTAL is
 *      asserted equal to the oracle's, so a wrong collapsed total has teeth even for
 *      the arm the driven run never reaches. A non-vacuous probe asserts each arm's
 *      effect on GAME_SUBSTATE (and, on the game-over arms, the sub_309f enqueue
 *      count / first DE), so EQUAL is never two identical no-ops:
 *        A  continue, 0x600F==0  -> 0x600A := 0x08          (ret total 75)
 *        B  continue, 0x600F!=0  -> 0x600A := 0x17          (ret total 82)
 *        C  game over, 0x600F==0 -> 0x600A := 0x10, 1 enqueue (DE=0x0300)
 *        D  game over, 0x600F!=0 -> 0x600A := 0x10, 2 enqueues (DE=0x0302 then 0x0300)
 *      Only arm A is reached by the driven run; B/C/D are reached by synthesis.
 *
 * THE CYCLE FINDING this routine shares with loc_1615/loc_138f: loc_12f2 is ATOMIC.
 * It runs inside the NMI handler (mask cleared, non-reentrant; NMI a full frame
 * from the next boundary, so no mid-routine state-dump capture; its callees run
 * inside the same masked window), so its internal cycle DISTRIBUTION is
 * unobservable and the per-instruction m.step charges between the call/ldir
 * boundaries collapse to one charge per segment. The TOTAL is still load-bearing
 * (the NMI handler's cost sets the main-loop spin count that seeds the PRNG,
 * README §2); preserving each branch's total keeps the whole-machine trace
 * identical, which tests 1 and 5 both prove. No hardware (0x7Dxx) write is made by
 * loc_12f2 itself -- only by its callee sub_011c -- so no write-bus-cycle trace is
 * at stake here.
 *
 * WHY THIS TEST DRIVES A POKE (like 1615/138f/18c6). loc_12f2's sub-state 0x0E is a
 * life-loss transition that never dispatches from boot attract. An IDENTICAL-BOTH-
 * SIDES poke (Karl's sanctioned "poke the board state to reach a state for
 * validation") forces it from frame 100: GAME_STATE=3, GAME_SUBSTATE=0x0E (held --
 * loc_12f2 moves 0x600A off 0x0E, so it must be re-pinned to re-dispatch), and LIVES
 * held at 5 so the `dec` leaves a non-zero counter every frame (the stable continue
 * arm; the game-over arm, which decrements to 0, is reached by synthesis). The poke
 * is threaded via a makeMachine factory (m.pokes) driving the game-agnostic CORE
 * engine, applied to baseline and optimized alike so equivalence is preserved.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_12f2 as translated_12f2 } from "../../translated/state0.js";
import { loc_12f2 as optimized_12f2 } from "../loc_12f2.js";
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

const TARGET = 0x12f2;
const POKE_FRAME = 100;
const FRAMES = 130; // loc_12f2 is forced to dispatch from frame 101 on
const MAXFRAMES_UNIT = 150; // enough to reach the first (frame-101) entry

const GAME_STATE = 0x6005; // ram.js GAME_STATE (=3 selects the 0x0702 dispatch)
const GAME_SUBSTATE = 0x600a; // ram.js GAME_SUBSTATE (=0x0E -> loc_12f2; also its output)
const LIVES = 0x6228; // ram.js LIVES (dec'd; held at 5 to keep the counter non-zero)
const P1_CONTEXT = 0x6040; // ram.js P1_CONTEXT (the ldir save block; whole-machine TEETH target)
const MODE_600F = 0x600f; // the mode/arm selector (unnamed in ram.js)

// Identical-both-sides poke forcing loc_12f2's sub-state. GAME_STATE + GAME_SUBSTATE
// are HELD (loc_12f2 moves 0x600A off 0x0E, so it must be re-pinned to re-dispatch);
// LIVES is held at 5 so `dec (LIVES)` leaves 4 every frame -> the continue arm.
const FORCE_12F2_POKE = [
  { addr: GAME_STATE, val: 0x03, frame: POKE_FRAME, dur: null }, // GAME_STATE = 3 (held)
  { addr: GAME_SUBSTATE, val: 0x0e, frame: POKE_FRAME, dur: null }, // GAME_SUBSTATE = 0x0E (held)
  { addr: LIVES, val: 0x05, frame: POKE_FRAME, dur: null }, // lives remain -> continue arm (held)
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_12F2_POKE.map((p) => ({ ...p }));
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
      return optimized_12f2(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}

const brokenContext = makeBroken(P1_CONTEXT); // whole-machine TEETH (unmasked data cell)
const brokenSubstate = makeBroken(GAME_SUBSTATE); // unit TEETH: the routine's own output

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_12f2 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_12f2]]));

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

test("EQUAL (unit): idiomatic optimized loc_12f2 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_12f2, optimized_12f2, { maxFrames: MAXFRAMES_UNIT });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (first entry = continue arm)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong P1_CONTEXT save-store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, brokenContext]]));

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
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_12f2, brokenSubstate, { maxFrames: MAXFRAMES_UNIT });

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

/** Capture ONE real entry to loc_12f2 (via the engine's construction-time snapshot
 * override on the poke-driven host), so the synthesised arms inherit a valid stack
 * and realistic RAM. The arms then re-poke only LIVES (the branch counter, via its
 * post-dec value) and 0x600F (the arm selector). */
let ENTRY = null;
function capturedEntry() {
  if (ENTRY) return ENTRY;
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_12f2(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(MAXFRAMES_UNIT);
  assert.ok(entry !== null, "loc_12f2 never entered — cannot synthesise branches");
  ENTRY = entry;
  return ENTRY;
}

/** Run oracle and optimized from an identical synthesised entry (LIVES and 0x600F
 * poked to force a path), returning the RAM/reg/pc diffs, each side's cycle delta
 * across the routine, the oracle's resulting GAME_SUBSTATE (the non-vacuous output
 * probe), and -- via a non-destructive registry wrapper -- the sub_309f enqueue
 * count + first DE the oracle issued (distinguishes the two game-over arms).
 * clone() neutralises the frame machinery, so the cycle count is exactly the
 * routine's own + its identical callees'. */
function runBranch(lives, mode600f) {
  const seed = capturedEntry().clone();
  seed.mem.write8(LIVES, lives);
  seed.mem.write8(MODE_600F, mode600f);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  const ca0 = a.cycles;
  const cb0 = b.cycles;
  translated_12f2(a);
  optimized_12f2(b);

  // Non-destructive routing probe on a fresh oracle clone: count sub_309f calls and
  // capture the first DE, without changing behaviour (the real callee still runs).
  const probe = seed.clone();
  const realSub309f = probe.routines.get(0x309f);
  let enqueues = 0;
  let firstDE = null;
  probe.routines.set(0x309f, (mm) => {
    enqueues += 1;
    if (firstDE === null) firstDE = mm.regs.de;
    return realSub309f(mm);
  });
  translated_12f2(probe);

  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pcEqual: a.pc === b.pc,
    cyclesOracle: a.cycles - ca0,
    cyclesOptimized: b.cycles - cb0,
    substateAfterOracle: a.mem.read8(GAME_SUBSTATE),
    enqueues,
    firstDE,
  };
}

test("BRANCH A (continue, 0x600F==0): EQUAL RAM + regs + pc + cycle total; 0x600A := 0x08", () => {
  const r = runBranch(0x03, 0x00); // dec 3 -> 2 (!=0) -> continue; 0x600F==0 -> C=0x08
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch A cycle total must equal the oracle's");
  assert.equal(r.substateAfterOracle, 0x08, "arm A must set GAME_SUBSTATE := 0x08");
  assert.equal(r.enqueues, 0, "continue arm enqueues nothing");
  console.log(`  BRANCH A: EQUAL, cycles ${r.cyclesOptimized} (== oracle; ret total 75); 0x600A := 0x08`);
});

test("BRANCH B (continue, 0x600F!=0): EQUAL RAM + regs + pc + cycle total; 0x600A := 0x17", () => {
  const r = runBranch(0x03, 0x01); // dec 3 -> 2 (!=0) -> continue; 0x600F!=0 -> C=0x17
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch B cycle total must equal the oracle's");
  assert.equal(r.substateAfterOracle, 0x17, "arm B must set GAME_SUBSTATE := 0x17");
  assert.equal(r.enqueues, 0, "continue arm enqueues nothing");
  console.log(`  BRANCH B: EQUAL, cycles ${r.cyclesOptimized} (== oracle; ret total 82); 0x600A := 0x17`);
});

test("BRANCH C (game over, 0x600F==0): EQUAL RAM + regs + pc + cycle total; 0x600A := 0x10, 1 enqueue", () => {
  const r = runBranch(0x01, 0x00); // dec 1 -> 0 -> game over; 0x600F==0 -> jr z taken (no extra enqueue)
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch C cycle total must equal the oracle's");
  assert.equal(r.substateAfterOracle, 0x10, "arm C must set GAME_SUBSTATE := 0x10");
  assert.equal(r.enqueues, 1, "game-over arm C enqueues exactly once (the 0x0300 task)");
  assert.equal(r.firstDE, 0x0300, "arm C's single enqueue is DE=0x0300");
  console.log(`  BRANCH C: EQUAL, cycles ${r.cyclesOptimized} (== oracle); 0x600A := 0x10; 1 enqueue (DE=0x0300)`);
});

test("BRANCH D (game over, 0x600F!=0): EQUAL RAM + regs + pc + cycle total; 0x600A := 0x10, 2 enqueues", () => {
  const r = runBranch(0x01, 0x01); // dec 1 -> 0 -> game over; 0x600F!=0 -> jr z not taken (extra 0x0302 enqueue)
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch D cycle total must equal the oracle's");
  assert.equal(r.substateAfterOracle, 0x10, "arm D must set GAME_SUBSTATE := 0x10");
  assert.equal(r.enqueues, 2, "game-over arm D enqueues twice (the extra 0x0302, then 0x0300)");
  assert.equal(r.firstDE, 0x0302, "arm D's first enqueue is the extra DE=0x0302");
  console.log(`  BRANCH D: EQUAL, cycles ${r.cyclesOptimized} (== oracle); 0x600A := 0x10; 2 enqueues (DE=0x0302,0x0300)`);
});
