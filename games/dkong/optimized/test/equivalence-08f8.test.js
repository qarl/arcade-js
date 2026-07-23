// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_08f8 (game state 2, sub-state 1: COMMIT A GAME
 * START -- set up player context(s), clear the playfield, and advance GAME_STATE
 * 2 -> 3 into gameplay). Reached via dispatchGameState (the NMI game-state path),
 * as arm 1 of loc_08b2's 0x08B6 table.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_08f8 (optimized/loc_08f8.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *
 *   3. BRANCH COVERAGE -- every data-dependent branch of loc_08f8 (the start
 *      selector loc_08d5 returns in A: 0x04 1-player, 0x08 2-player, else no-op)
 *      is proven EQUAL, synthesising the arms the natural run does not reach.
 *
 *   4. TEETH (whole + unit) -- a deliberately-broken twin (a wrong value to one of
 *      the routine's own output stores) must be CAUGHT: NOT-EQUAL, naming 0x6048.
 *
 * WHY THIS TEST DRIVES INPUT (and uses core/equivalence.js directly, like
 * equivalence-059b/06b8). loc_08f8 is the state-2 -> state-3 GAME-START commit: it
 * only runs once a credit is inserted and a start button pressed, so it NEVER
 * dispatches in attract mode. These tests feed the machine the canonical coin+
 * start tape (the tapes/coin_start.lua contract: IN2 coin 0x80, then IN2 start1
 * 0x04) via a custom makeMachine factory and drive the game-agnostic CORE
 * equivalence engine with it -- the DK harness.js wrapper bakes `inputs` but not
 * the timed `inputTape`, which is why the factory is built here. The core engine
 * is still the standard gate (it installs the snapshot override at CONSTRUCTION,
 * so nothing here open-codes a reach-the-routine workaround). With this tape
 * loc_08f8 dispatches 59x (frames 93-151): the else/no-op arm every frame while
 * the player has not yet chosen, then the 1-player (A=0x04) arm at frame 151 when
 * START1 is seen. FRAMES = 160 covers it.
 *
 * THE CYCLE FINDING this routine adds: loc_08f8 is ATOMIC and COLLAPSED. It runs
 * INSIDE the vblank NMI, which does not re-enter, so the NMI never lands inside it
 * or its callees -- a boot+coin+start probe dispatched it 59x (including the
 * 36717-cycle 1P-start frame) with the NMI landing inside it ZERO times. So each
 * branch charges its per-instruction tstate SUM in one m.step per straight-line
 * segment (else = 61, 1P = 582, 2P = 621; ldir/callees keep charging themselves).
 * Whole-machine EQUAL confirms the totals exactly -- a wrong total would diverge
 * at SPIN_COUNT 0x6019, as it did for handler_05c6 when stripped. See
 * optimized/loc_08f8.js for the full decision.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08f8 as translated_08f8 } from "../../translated/state0.js";
import { loc_08f8 as optimized_08f8 } from "../loc_08f8.js";
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

const TARGET = 0x08f8;
const FRAMES = 160; // loc_08f8 dispatches frames 93-151; the 1P-start arm at 151

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80)
// then IN2 start1 (0x04), so the ROM's own credit/start logic starts a game. A
// fresh copy per machine keeps each run's tape independent.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded.
// Called with no argument for the baseline and with the wrapped override map for
// the optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously).
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// loc_08f8's own output store the teeth corrupt: 0x6048 (P2_CONTEXT byte 0). On
// the naturally-reached 1-player arm (A=0x04) loc_08f8 ZEROES P2's saved context,
// so 0x6048 is written 0. It sits in the compared work-RAM dump and is not
// rewritten in the run window, so a wrong value there persists. (Corrupting the
// control outputs 0x6005/0x600A instead would crash the downstream dispatch, not
// diff cleanly -- 0x6048 is a pure-data output, the representative bug to catch.)
const BROKEN_ADDR = 0x6048;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x6048 lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim -- the representative "wrong value to one
 * of the routine's own output addresses" bug the gate must catch.
 */
function broken_08f8(m) {
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
    return optimized_08f8(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the synthesised branch-coverage arms) ---------

/**
 * Capture the machine at the instant loc_08f8 is FIRST entered (frame 93, the
 * else/no-op arm) and return that pristine clone. The natural run only reaches the
 * else and 1-player arms, so the 2-player arm (and a clean isolated repeat of the
 * others) is proven by re-driving THIS entry with the branch selector forced.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_08f8(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_08f8 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/**
 * Prove translated == optimized for ONE branch of loc_08f8. The branch selector
 * is the value loc_08d5 returns in A; loc_08f8 calls loc_08d5 as its first act, so
 * the arm is forced by overriding 0x08d5 on the clone with a stub that returns the
 * chosen A (and rets, popping the pushed return so SP balances -- the oracle's net
 * effect). BOTH clones carry the identical stub, so loc_08d5's absent side effects
 * are absent on both sides equally and the diff isolates loc_08f8's own arm logic.
 * The real callees (0x0977, 0x0874, 0x309f, ldir) still run verbatim on both.
 */
function branchDiff(selectorA, runOptimized = optimized_08f8) {
  const stub = (mm) => { mm.regs.a = selectorA; mm.ret(); };
  const a = ENTRY.clone(); a.routines.set(0x08d5, stub);
  const b = ENTRY.clone(); b.routines.set(0x08d5, stub);
  translated_08f8(a);
  runOptimized(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_08f8 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_08f8]]));

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

test("EQUAL (unit): idiomatic optimized loc_08f8 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_08f8, optimized_08f8, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

test("BRANCH COVERAGE: every start-selector arm is proven EQUAL", () => {
  // Three distinct code paths, four representative selector values:
  //   0x04 -> 1-player start (loc_0906: zero P2_CONTEXT, HL=0, shared tail)
  //   0x08 -> 2-player start (loc_0919: seed P2_CONTEXT, HL=0x0100, shared tail)
  //   0x00 / 0x0C -> else guard both-not-taken: return, writing NOTHING
  const arms = [
    [0x04, "1-player start (loc_0906)"],
    [0x08, "2-player start (loc_0919)"],
    [0x00, "else / no start yet"],
    [0x0c, "else / both buttons"],
  ];
  for (const [selectorA, label] of arms) {
    const d = branchDiff(selectorA);
    assert.equal(d.ram, null, d.ram ? `arm 0x${selectorA.toString(16)} (${label}) RAM diff at 0x${d.ram.addr.toString(16)} (t ${d.ram.a} vs o ${d.ram.b})` : "");
    assert.equal(d.regs, null, d.regs ? `arm 0x${selectorA.toString(16)} (${label}) reg diff at ${d.regs.reg} (t ${d.regs.a} vs o ${d.regs.b})` : "");
    assert.equal(d.pc, null, `arm 0x${selectorA.toString(16)} (${label}) pc must match`);
  }
  console.log(`  BRANCH: all ${arms.length} arms (1P/2P/else x2) EQUAL in RAM + registers + pc`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong context-clear store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_08f8]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong context-clear store is CAUGHT and names 0x6048", () => {
  // The else/no-op arm the natural first entry takes writes nothing, so the teeth
  // are shown on the 1-player arm (the naturally-reached WRITING arm), synthesised
  // via branchDiff so the corrupted store actually happens.
  const d = branchDiff(0x04, broken_08f8);

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
