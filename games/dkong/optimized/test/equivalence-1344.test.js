// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_1344 (0x0702 table idx15, ROM 0x1344): a
 * decrement-lives / save-context state setup, the TWIN of loc_12f2 (idx14). It is a
 * game-state dispatch target -- entry 15 (0x0F) of loc_06fe's 0x0702 rst-0x28 table
 * -- reached from INSIDE the NMI while GAME_STATE(0x6005)==3 and GAME_SUBSTATE
 * (0x600A)==0x0F. It calls sub_011c (reset the sound latches), clears PLAY_INTRO
 * (0x622C), `dec (LIVES)`s and reads the count, `ldir`s the live 8-byte player
 * context (LIVES..0x622F) into the P2 save slot (P2_CONTEXT..0x604F), then branches
 * on the decremented life count:
 *   - lives != 0 : arm GAME_SUBSTATE(0x600A) := 0x17 (P1_CONTEXT[0] != 0) else 0x08.
 *   - lives == 0 : render P2's score (0x13CA), enqueue two tasks (0x309F x2), run
 *                  the fill helper (0x1826), then SUBSTATE_TIMER(0x6009) := 0xC0 and
 *                  GAME_SUBSTATE(0x600A) := 0x11.
 *
 * Seven jobs (mirrors equivalence-138f -- same NMI-path, same substate-dispatch shape):
 *
 *   1. EQUAL (whole-machine) -- optimized loc_1344 reads EQUAL against its oracle
 *      every frame, override firing many times. The override routes through
 *      dispatchGameState's consult (nmi.js), inert when the map is empty.
 *
 *   2. EQUAL (unit) -- EQUAL in RAM + every register (F included) + pc, on the
 *      naturally-captured first entry (lives held to 3 -> dec -> 2 -> branch 1; the
 *      driven run's P1_CONTEXT[0] is 0, so its arm is the 0x08 one).
 *
 *   3. TEETH (whole-machine) -- a deliberately-broken twin whose clear of PLAY_INTRO
 *      (0x622C) lands a wrong value is CAUGHT: NOT-EQUAL, naming a diverging address.
 *      0x622C is NOT held by the poke, so its corruption is visible AND cascades --
 *      it sits inside the ldir SOURCE range (0x6228..0x622F), so the wrong byte is
 *      copied into the P2 save slot and the first divergence actually surfaces at
 *      0x604C (the copy), which is exactly the kind of downstream drift the whole-
 *      machine gate exists to catch. GAME_SUBSTATE(0x600A) is re-pinned to 0x0F by
 *      the poke each boundary, so a wrong 0x600A would be masked in the dump (that
 *      store is exercised by the unit TEETH below instead).
 *
 *   4. TEETH (unit) -- loc_1344's OWN primary branch-1 output store is broken: on the
 *      natural entry the write to GAME_SUBSTATE(0x600A) lands a wrong value, and the
 *      gate catches it and names 0x600A.
 *
 *   5/6/7. FULL BRANCH COVERAGE -- loc_1344's three data-dependent arms each proven
 *      EQUAL on a synthesised entry (RAM + registers + pc), AND -- because the
 *      scaffold cycles are COLLAPSED to one charge per straight-line run -- each
 *      arm's CYCLE TOTAL is asserted equal to the oracle's, so a wrong collapsed
 *      total has teeth even for the arm the driven whole-machine run never reaches.
 *      A non-vacuous output probe asserts each arm's effect on GAME_SUBSTATE:
 *        A  lives != 0, P1_CONTEXT[0] != 0  -> 0x600A := 0x17            (branch 1a)
 *        B  lives != 0, P1_CONTEXT[0] == 0  -> 0x600A := 0x08            (branch 1b)
 *        C  lives == 0                       -> 0x600A := 0x11, 0x6009 := 0xC0 (branch 2)
 *      The driven whole-machine run holds lives at 3, so it only ever takes branch 1
 *      (and, with P1_CONTEXT[0]==0, only its 0x08 arm); arm A (0x17) and the whole of
 *      branch C are reached ONLY by synthesis here -- which is why their committed
 *      cycle-total teeth matter.
 *
 * THE CYCLE FINDING this routine shares with loc_138f / loc_0a8a: loc_1344 is ATOMIC
 * and its scaffold is COLLAPSED (each straight-line run between the real ops -- the
 * calls and the ldir -- becomes ONE m.step of the exact summed t-states, pre-call
 * runs folding their `call`'s 17t in). It runs inside the NMI handler (mask cleared,
 * non-reentrant), so the NMI never lands inside loc_1344 OR any callee -- sub_011c
 * even runs on `m.tick` (no maintained PC), which is only safe because nothing can
 * interrupt it here -- and its internal cycle DISTRIBUTION is unobservable. The TOTAL
 * is still load-bearing (the NMI handler's cost sets the main-loop spin count that
 * seeds the PRNG, README §2); preserving each branch's total keeps the whole-machine
 * trace identical, which tests 1 and 5-7 both prove. loc_1344 makes NO hardware
 * (0x7Dxx) write of its own (sub_011c's are inside the oracle via m.call), so no
 * write-bus-cycle trace is at stake.
 *
 * WHY THIS TEST DRIVES A POKE (like 138f/1615/18c6). loc_1344's substate 0x0F is a
 * lives-spend/save phase that NEVER dispatches from boot attract. An IDENTICAL-BOTH-
 * SIDES poke (Karl's sanctioned "poke the board state to reach a state for
 * validation") forces it from frame 101: GAME_STATE=3, GAME_SUBSTATE=0x0F (both held
 * -- loc_1344 moves 0x600A off 0x0F, so it must be re-pinned to re-dispatch every
 * frame), and LIVES=3 (held so the per-frame `dec` still leaves a nonzero count and
 * the driven run stays on the light branch 1 -- otherwise a per-frame slide to 0
 * would take branch 2 and enqueue tasks the main loop would then try to dispatch).
 * The poke is threaded via a makeMachine factory (m.pokes) driving the game-agnostic
 * CORE engine, applied to baseline and optimized alike so equivalence is preserved.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1344 as translated_1344 } from "../../translated/state0.js";
import { loc_1344 as optimized_1344 } from "../loc_1344.js";
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

const TARGET = 0x1344;
const POKE_FRAME = 100;
const FRAMES = 130; // loc_1344 is forced to dispatch from frame 101 on (~30x)
const MAXFRAMES_UNIT = 150; // enough to reach the first (frame-101) entry

const GAME_STATE = 0x6005; // ram.js GAME_STATE (=3 selects the 0x0702 dispatch)
const GAME_SUBSTATE = 0x600a; // ram.js GAME_SUBSTATE (=0x0F -> loc_1344; the routine's output)
const SUBSTATE_TIMER = 0x6009; // ram.js SUBSTATE_TIMER (branch-2 output, armed to 0xC0)
const LIVES = 0x6228; // ram.js LIVES (decremented + tested to pick the branch)
const P1_CONTEXT = 0x6040; // ram.js P1_CONTEXT[0] (branch-1 arm selector: !=0 -> 0x17, ==0 -> 0x08)
const PLAY_INTRO = 0x622c; // ram.js PLAY_INTRO (cleared to 0 every dispatch; whole-machine TEETH target)

// Identical-both-sides poke forcing loc_1344's substate. GAME_STATE + GAME_SUBSTATE
// are HELD (loc_1344 moves 0x600A off 0x0F, so it must be re-pinned to re-dispatch);
// LIVES is held to 3 so the per-frame dec still leaves a nonzero count (branch 1).
const FORCE_1344_POKE = [
  { addr: GAME_STATE, val: 0x03, frame: POKE_FRAME, dur: null }, // GAME_STATE = 3 (held)
  { addr: GAME_SUBSTATE, val: 0x0f, frame: POKE_FRAME, dur: null }, // GAME_SUBSTATE = 0x0F (held)
  { addr: LIVES, val: 0x03, frame: POKE_FRAME, dur: null }, // LIVES = 3 (held -> dec = 2, branch 1)
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_1344_POKE.map((p) => ({ ...p }));
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
      return optimized_1344(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}

const brokenPlayIntro = makeBroken(PLAY_INTRO); // whole-machine TEETH (un-masked; cascades through the ldir)
const brokenSubstate = makeBroken(GAME_SUBSTATE); // unit TEETH: the routine's own branch-1 output

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_1344 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_1344]]));

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

test("EQUAL (unit): idiomatic optimized loc_1344 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1344, optimized_1344, { maxFrames: MAXFRAMES_UNIT });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (first entry = branch 1, 0x08 arm)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong PLAY_INTRO store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, brokenPlayIntro]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized}) — the ldir copies 0x622C's corruption to 0x604C`,
  );
});

test("TEETH (unit): a wrong GAME_SUBSTATE store is CAUGHT and names 0x600A", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1344, brokenSubstate, { maxFrames: MAXFRAMES_UNIT });

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

/** Capture ONE real entry to loc_1344 (via the engine's construction-time snapshot
 * override on the poke-driven host), so the synthesised arms inherit a valid stack
 * and realistic RAM. The arms then re-poke only LIVES (the branch selector) and
 * P1_CONTEXT[0] (the branch-1 arm selector). */
let ENTRY = null;
function capturedEntry() {
  if (ENTRY) return ENTRY;
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_1344(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(MAXFRAMES_UNIT);
  assert.ok(entry !== null, "loc_1344 never entered — cannot synthesise branches");
  ENTRY = entry;
  return ENTRY;
}

/** Run oracle and optimized from an identical synthesised entry (LIVES and
 * P1_CONTEXT[0] poked to force a branch), returning the RAM/reg/pc diffs, each side's
 * cycle delta across the routine, and the oracle's resulting GAME_SUBSTATE /
 * SUBSTATE_TIMER (the non-vacuous output probe). clone() neutralises the frame
 * machinery, so the cycle count is exactly the routine's own + the identical callees
 * (sub_011c / sub_13ca / sub_309f / sub_1826, all reached via m.call). */
function runBranch(livesVal, p1ctx) {
  const seed = capturedEntry().clone();
  seed.mem.write8(LIVES, livesVal);
  seed.mem.write8(P1_CONTEXT, p1ctx);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  const ca0 = a.cycles;
  const cb0 = b.cycles;
  translated_1344(a);
  optimized_1344(b);

  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pcEqual: a.pc === b.pc,
    cyclesOracle: a.cycles - ca0,
    cyclesOptimized: b.cycles - cb0,
    substateAfterOracle: a.mem.read8(GAME_SUBSTATE),
    timerAfterOracle: a.mem.read8(SUBSTATE_TIMER),
  };
}

test("BRANCH A (lives != 0, P1_CONTEXT[0] != 0): EQUAL RAM + regs + pc + cycle total; 0x600A := 0x17", () => {
  const r = runBranch(5, 0x03); // dec -> 4 (!=0); 0x6040 != 0 -> C stays 0x17
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch A cycle total must equal the oracle's");
  assert.equal(r.substateAfterOracle, 0x17, "arm A must set GAME_SUBSTATE := 0x17");
  console.log(`  BRANCH A: EQUAL, cycles ${r.cyclesOptimized} (== oracle); 0x600A := 0x17`);
});

test("BRANCH B (lives != 0, P1_CONTEXT[0] == 0): EQUAL RAM + regs + pc + cycle total; 0x600A := 0x08", () => {
  const r = runBranch(5, 0x00); // dec -> 4 (!=0); 0x6040 == 0 -> C = 0x08 (+7t vs arm A)
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch B cycle total must equal the oracle's");
  assert.equal(r.substateAfterOracle, 0x08, "arm B must set GAME_SUBSTATE := 0x08");
  console.log(`  BRANCH B: EQUAL, cycles ${r.cyclesOptimized} (== oracle; +7t vs A for the extra ld c,0x08); 0x600A := 0x08`);
});

test("BRANCH C (lives == 0): EQUAL RAM + regs + pc + cycle total; 0x600A := 0x11, 0x6009 := 0xC0", () => {
  const r = runBranch(1, 0x00); // dec -> 0 -> the out-of-lives render/enqueue/arm branch
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch C cycle total must equal the oracle's");
  assert.equal(r.substateAfterOracle, 0x11, "arm C must set GAME_SUBSTATE := 0x11");
  assert.equal(r.timerAfterOracle, 0xc0, "arm C must arm SUBSTATE_TIMER := 0xC0");
  console.log(`  BRANCH C: EQUAL, cycles ${r.cyclesOptimized} (== oracle; five collapsed scaffold stretches + callees); 0x600A := 0x11, 0x6009 := 0xC0`);
});
