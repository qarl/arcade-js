// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_08d5 (the credit-screen start-button read:
 * build the start mask B / prompt index E from CREDITS, redraw the prompt once
 * every 8 frames, and return A = IN2(0x7D00) & B -- the pressed start button).
 * Reached ONLY inside the vblank NMI: loc_08ba (game state 2, sub-state 0) FALLS
 * THROUGH into it and loc_08f8 (sub-state 1) CALLs it, both dispatched by
 * dispatchGameState off GAME_STATE(0x6005)==2.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_08d5 (optimized/loc_08d5.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. With the
 *      coin+start tape loc_08d5 is called 60x (every frame of the credited state).
 *
 *   3. BRANCH COVERAGE -- all four data-dependent paths proven EQUAL in RAM +
 *      registers + pc: the CREDITS branch (==1 -> B=0x04,E=0x09; else -> B=0x0C,
 *      E=0x0A) x the (FRAME&7) branch (!=0 -> skip the draw; ==0 -> draw). The
 *      driven run only reaches CREDITS==1 (a single credit), so the B=0x0C arms
 *      are SYNTHESISED by forcing CREDITS/FRAME on the captured entry. Because the
 *      cycles are COLLAPSED (see below), each synthesised arm ALSO asserts its
 *      cycle TOTAL equals the oracle's -- the teeth on the collapse for the arms
 *      the whole-machine run does not exercise.
 *
 *   4. TEETH (whole + unit) -- a deliberately-broken twin (a wrong value to the
 *      first store on loc_08d5's draw path, VRAM 0x7729 written by handler_05e9)
 *      must be CAUGHT: NOT-EQUAL, naming 0x7729.
 *
 * WHY THIS TEST DRIVES INPUT (and uses core/equivalence.js directly, like
 * equivalence-08f8/08ba). loc_08d5 only runs once a game is credited, so it never
 * dispatches in attract mode. These tests feed the canonical coin+start tape
 * (tapes/coin_start.lua contract: IN2 coin 0x80, then IN2 start1 0x04) via a
 * custom makeMachine factory and drive the game-agnostic CORE equivalence engine
 * with it -- the DK harness.js wrapper bakes `inputs` but not the timed
 * `inputTape`, which is why the factory is built here. The core engine is still
 * the standard gate (it installs the snapshot override at CONSTRUCTION, so nothing
 * here open-codes a reach-the-routine workaround, and it reaches loc_08d5 even
 * though it is entered only by m.call / fall-through, never as a dispatch target).
 *
 * THE CYCLE FINDING this routine adds: loc_08d5 is ATOMIC and COLLAPSED. Every
 * call path roots in dispatchGameState (the NMI clears its mask before
 * dispatching), so the vblank NMI never lands inside loc_08d5 OR its callees --
 * exactly the "loc_08d5's interruptible 0x05e9/0x0616 arm" that loc_08ba's header
 * notes never fires here. So its internal cycle DISTRIBUTION is unobservable and
 * each straight-line segment charges one m.step total; the per-branch TOTAL is
 * kept load-bearing (as part of the NMI total it sets the main-loop spin count,
 * SPIN_COUNT 0x6019): skip arms 101t (B=4) / 112t (B=0xC), draw arms 139t / 150t
 * excluding the callee bodies. Whole-machine EQUAL confirms the reached (B=4)
 * totals; the branch-coverage cycle asserts confirm the rest. loc_08d5 writes NO
 * hardware register of its own (its only 0x7Dxx touch is the IN2 read, whose
 * watchdog kick is cycle-position-insensitive), so unlike loc_08ba there is no
 * write-trace column to protect and the collapse is full.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08d5 as translated_08d5 } from "../../translated/state0.js";
import { loc_08d5 as optimized_08d5 } from "../loc_08d5.js";
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

const TARGET = 0x08d5;
const FRAMES = 160; // loc_08d5 is called every frame of the credited state (60x)

// RAM the branch synthesis forces to select each path.
const CREDITS = 0x6001; // ==1 -> B=0x04,E=0x09 ; else -> B=0x0C,E=0x0A
const FRAME = 0x601a; // (FRAME & 7) == 0 -> take the draw arm

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80)
// then IN2 start1 (0x04). A fresh copy per machine keeps each run independent.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// The first store on loc_08d5's DRAW path: the first cell handler_05e9 writes for
// the prompt string, VRAM 0x7729 (probed constant across every draw-arm frame). It
// sits in the compared video-RAM dump (0x7400-0x77FF); the twin corrupts it once,
// and the diff persists until the next 8-frame redraw -- long enough for the
// per-frame whole-machine trace to catch it.
const BROKEN_ADDR = 0x7729;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x7729 lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). loc_08d5 writes no work RAM of its own -- its only stores are the draw
 * arm's, made by handler_05e9 (reached via m.call) -- so this is the representative
 * "wrong value to one of the routine's own output addresses" bug the gate must
 * catch, exactly as equivalence-0611 corrupts handler_05e9's 0x759F.
 */
function broken_08d5(m) {
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
    return optimized_08d5(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the synthesised branch-coverage arms) ---------

/**
 * Capture the machine at the instant loc_08d5 is FIRST entered and return that
 * pristine clone. The driven run only reaches the CREDITS==1 arms, so the CREDITS
 * != 1 arms (and clean isolated repeats) are proven by re-driving THIS entry with
 * CREDITS / FRAME forced to select the path.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_08d5(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_08d5 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/**
 * Prove translated == optimized for ONE path of loc_08d5, forcing the path by
 * poking CREDITS (the B/E selector) and FRAME (the draw/skip selector) on the
 * clone before running. Both clones carry the identical pokes, so the callees'
 * side effects (on the draw arm) are identical on both sides and the diff isolates
 * loc_08d5's own logic. Returns RAM/reg/pc diffs AND each side's cycle delta, so a
 * collapsed arm the whole-machine run never reaches still has its TOTAL asserted.
 */
function branchDiff(credits, frame, runOptimized = optimized_08d5) {
  const a = ENTRY.clone(); a.mem.write8(CREDITS, credits); a.mem.write8(FRAME, frame);
  const b = ENTRY.clone(); b.mem.write8(CREDITS, credits); b.mem.write8(FRAME, frame);
  const ca = a.cycles; translated_08d5(a); const cycT = a.cycles - ca;
  const cb = b.cycles; runOptimized(b); const cycO = b.cycles - cb;
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
    cycT,
    cycO,
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_08d5 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_08d5]]));

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

test("EQUAL (unit): idiomatic optimized loc_08d5 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_08d5, optimized_08d5, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

test("BRANCH COVERAGE: all four CREDITS x (FRAME&7) arms EQUAL, collapsed totals asserted", () => {
  // credits, frame, expected loc_08d5-own cycle total, label.
  //   frame & 7 == 0 -> DRAW arm (calls 0x05e9/0x0616; the measured delta includes
  //   the callee bodies, identical on both sides, so it still tests loc_08d5's own
  //   charge); != 0 -> SKIP arm. Draw totals here are the FULL deltas (own + callee
  //   bodies) as observed on both sides -- what matters is translated == optimized.
  const arms = [
    [1, 1, "credits==1, skip (B=0x04)"],
    [1, 8, "credits==1, draw (B=0x04, callees clobber before and b)"],
    [2, 1, "credits!=1, skip (B=0x0C) -- NOT reached by the driven run"],
    [2, 8, "credits!=1, draw (B=0x0C) -- NOT reached by the driven run"],
  ];
  for (const [credits, frame, label] of arms) {
    const d = branchDiff(credits, frame);
    assert.equal(d.ram, null, d.ram ? `arm [${label}] RAM diff at 0x${d.ram.addr.toString(16)} (t ${d.ram.a} vs o ${d.ram.b})` : "");
    assert.equal(d.regs, null, d.regs ? `arm [${label}] reg diff at ${d.regs.reg} (t ${d.regs.a} vs o ${d.regs.b})` : "");
    assert.equal(d.pc, null, `arm [${label}] pc must match`);
    // Teeth on the cycle collapse: the optimized per-branch total must equal the
    // oracle's exactly (a wrong collapsed total would otherwise pass RAM+regs).
    assert.equal(d.cycO, d.cycT, `arm [${label}] cycle total ${d.cycO} != oracle ${d.cycT}`);
  }
  console.log(`  BRANCH: all ${arms.length} arms EQUAL in RAM + regs + pc, cycle totals identical`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong prompt-draw store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_08d5]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong prompt-draw store is CAUGHT and names 0x7729", () => {
  // The draw arm is where loc_08d5's path makes a store, so the teeth are shown on
  // a synthesised draw-arm entry (CREDITS=1, FRAME=8 so FRAME&7==0), via branchDiff
  // so the corrupted handler_05e9 store actually happens.
  const d = branchDiff(1, 8, broken_08d5);

  assert.ok(d.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    d.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${d.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${d.ram.addr.toString(16)} ` +
      `(translated ${d.ram.a} vs broken ${d.ram.b})`,
  );
});
