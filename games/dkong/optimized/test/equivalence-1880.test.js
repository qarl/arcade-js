// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_1880 (0x1644-sequence idx 4: a gated object
 * spawn + selector advance on the 100m board-advance). Dispatched from INSIDE the
 * NMI as entry 4 of loc_1644's 0x1648 rst-0x28 table, reached via dispatchGameState
 * -> loc_1615 (GAME_SUBSTATE 0x600A==0x16) -> sub_1641 when BOARD(0x6227) has bits 0
 * and 1 clear (BOARD==4, 100m rivets), indexed by the sequence selector 0x6388==4.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_1880 (optimized/loc_1880.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_1880 is
 *      reached via `m.call(0x1880)` from dispatchGameState (nmi.js), so the registry
 *      override (+ its invocation counter) resolves there.
 *
 *   3. TEETH -- a deliberately-broken twin (the FIRST own store, the spawn flag
 *      0x6919, lands a wrong value) must be CAUGHT: NOT-EQUAL, naming 0x6919.
 *
 *   4/5. FULL BRANCH COVERAGE -- loc_1880 has one data-dependent branch, gated on the
 *      trigger byte 0x691B *after* the rst-0x38 add-loop has +1'd it:
 *        BRANCH A (ret nz)  -- 0x691B != 0xD0: the frame's only effect is the add-loop
 *                              +1 to the counter chain; the routine returns.
 *        BRANCH B (spawn)   -- 0x691B == 0xD0: writes 0x6919, stamps the 0x6A24 record,
 *                              runs three callees, clears 0x62AF, sets the 0x6082 sound
 *                              latch, and inc's the selector 0x6388.
 *      Each branch is proven EQUAL (RAM + all registers + pc) on a SYNTHESISED entry
 *      (the add-loop transforms the seeded 0x691B: 0x00->0x01 for A, 0xCF->0xD0 for B),
 *      shown non-vacuously to have taken that branch, AND -- because the routine is
 *      CYCLE-COLLAPSED -- each synthesised branch also asserts its total cycle count
 *      equals the oracle's (measured across the routine on both clones), the teeth on
 *      a wrong collapsed total.
 *
 * WHY THIS TEST DRIVES A TAPE + POKE (and, like loc_084b/entry_128b, cannot use
 * games/dkong/optimized/harness.js directly). loc_1880 NEVER dispatches from boot:
 * measured 0 hits across 700 frames of driven coin+start (the natural board-1 flow
 * loops 25m death/respawn and never reaches this 100m board-advance staging). So a
 * coin+start tape establishes a real in-game state-3 context, then an IDENTICAL-BOTH-
 * SIDES poke (Karl's sanctioned "poke the board state to reach a state for
 * validation") forces the dispatch at frame 130: GAME_SUBSTATE(0x600A)=0x16
 * (board-advance), BOARD(0x6227)=4 (both low bits clear -> the 0x1648 path),
 * selector 0x6388=4 (idx 4 -> loc_1880), 0x6340=0 (so sub_1dbd on the loc_1615 path
 * dispatches to a ret no-op, crash-free), and the trigger 0x691B=0xCF so the add-loop
 * bumps it to 0xD0 -> loc_1880 takes BRANCH B (the storing branch) every dispatch.
 * Threaded via a custom `makeMachine` factory (m.inputTape + m.pokes) driving the
 * game-agnostic CORE engine (core/equivalence.js) -- the SAME construction-time
 * snapshot override the DK harness wrapper uses, with a factory that can carry the
 * tape + poke, which the wrapper's fixed (rom, assets) factory cannot.
 *
 * THE COLLAPSE FINDING this routine adds: loc_1880 is ATOMIC because it is dispatched
 * from inside the NMI, where the NMI mask is held (entry_0066 clears 0x7D84) -- the
 * vblank NMI can never land inside it OR its four callees (0x0038, 0x1826, 0x0DA7,
 * 0x003D). Collapsing each branch's per-instruction m.step charges to one charge per
 * inter-call segment stays EQUAL whole-machine AND unit (verified here, incl. the
 * explicit per-branch cycle totals: branch A 59t of loc_1880 proper, branch B 307t).
 * The TOTAL is preserved because the NMI's cumulative cost feeds mainLoop's vblank-
 * spin count (README §2); only the internal DISTRIBUTION is free. loc_1880 makes no
 * hardware (0x7Dxx) writes -- only object/scratch/sound work RAM -- so there is no
 * write-bus-cycle trace to preserve and the collapse is unconditional.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1880 as translated_1880 } from "../../translated/state0.js";
import { loc_1880 as optimized_1880 } from "../loc_1880.js";
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

const TARGET = 0x1880;
const FRAMES = 180; // loc_1880 is forced to dispatch from frame 131 (poke at 130)
const POKE_FRAME = 130;

const TRIGGER = 0x691b; // add-loop-driven trigger byte the guard reads
const SELECTOR = 0x6388; // the 0x1648 sequence selector; branch B inc's it
const SPAWN_FLAG = 0x6919; // branch B's FIRST own store (0x20)
const RECORD = 0x6a24; // branch B's stamped object record (7F 39 01 D8)

// Canonical coin+start tape: reach in-game GAME_STATE 3 (a real board context) so the
// 0x06FE state-3 handler dispatches the 0x0702 idx-0x16 board-advance path.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// Identical-both-sides poke that forces the 100m board-advance dispatch to loc_1880
// idx 4, holding BRANCH B (the storing branch) every dispatch. Sustained (dur covers
// the compared window) so loc_1880 keeps dispatching idx 4 -- its inc(0x6388)->5 is
// reset to 4 before the next frame's state sample, and 0x691B is re-seeded to 0xCF so
// the add-loop lands 0xD0 every frame. Applied identically to baseline and optimized.
const FORCE_1880_POKE = [
  { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: FRAMES }, // GAME_SUBSTATE = board-advance
  { addr: 0x6227, val: 0x04, frame: POKE_FRAME, dur: FRAMES }, // BOARD = 4 (100m) -> 0x1648 path
  { addr: 0x6388, val: 0x04, frame: POKE_FRAME, dur: FRAMES }, // selector -> idx 4 = loc_1880
  { addr: 0x6340, val: 0x00, frame: POKE_FRAME, dur: FRAMES }, // sub_1dbd -> ret no-op (crash-free)
  { addr: 0x691b, val: 0xcf, frame: POKE_FRAME, dur: FRAMES }, // trigger -> add-loop -> 0xD0 -> BRANCH B
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape and the
// force-1880 poke loaded. Called with no argument for the baseline and with the
// wrapped override map for the optimized side (the core engine wraps each override
// with its own invocation counter, so an EQUAL that never dispatched cannot pass
// vacuously). A fresh copy per machine keeps each run independent.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = FORCE_1880_POKE.map((p) => ({ ...p }));
  return m;
};

// loc_1880's FIRST own store is the spawn flag 0x6919 (branch B writes 0x20). The
// broken twin lands the correct value XOR 0xFF there (guaranteed to differ; 0x6919 is
// object scratch, not a dispatch index, so the run stays healthy). Intercepting
// exactly that one write lets every callee and the rest of the routine run verbatim.
function broken_1880(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === SPAWN_FLAG) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_1880(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_1880 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_1880]]));

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
      `override fired ${r.invocations.get(TARGET)}x (branch B)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_1880 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1880, optimized_1880, { maxFrames: 160 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong spawn-flag store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_1880]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong spawn-flag store is CAUGHT and names 0x6919", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1880, broken_1880, { maxFrames: 160 });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    SPAWN_FLAG,
    `expected first diff at 0x${SPAWN_FLAG.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (synthesised per-branch teeth, incl. cycle totals) --

/**
 * Capture ONE real entry to loc_1880 (via the engine's construction-time snapshot
 * override on the tape+poke-driven host), then synthesise each branch from it.
 * Reusing a real captured entry gives a valid stack (the routine's ret unwinds it),
 * a realistic counter chain, and a live board context for the three callees.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_1880(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(160);
  assert.ok(entry !== null, "failed to capture a loc_1880 entry to synthesise branches from");
  return entry;
}

/**
 * Prove one branch EQUAL. Seeds the trigger byte 0x691B (the add-loop then +1's it:
 * 0x00->0x01 stays != 0xD0 = BRANCH A; 0xCF->0xD0 = BRANCH B). Runs oracle vs
 * optimized on two clones and asserts RAM + every register + pc identical, that the
 * branch took the expected path (non-vacuous, via the selector 0x6388), AND that both
 * consumed the SAME total cycles (the teeth on the collapsed cycle total). Cycles are
 * the m.cycles delta -- a clone's frame machinery is neutralised, so nothing but the
 * routine advances the clock.
 */
function proveBranch(entry, name, trigger, opts) {
  const seed = entry.clone();
  seed.mem.write8(TRIGGER, trigger);
  const selBefore = seed.mem.read8(SELECTOR);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized

  const aCyc0 = a.cycles;
  translated_1880(a);
  const oracleCycles = a.cycles - aCyc0;

  const bCyc0 = b.cycles;
  optimized_1880(b);
  const optCycles = b.cycles - bCyc0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, `${name}: pc must match`);

  // Teeth on the COLLAPSED cycle total: a wrong per-branch sum is caught here.
  assert.equal(
    optCycles,
    oracleCycles,
    `${name}: cycle total ${optCycles} != oracle ${oracleCycles}`,
  );

  // Non-vacuous: confirm the synthesised entry actually reached the intended branch.
  const selAfter = a.mem.read8(SELECTOR);
  const trigAfter = a.mem.read8(TRIGGER);
  if (opts.expectSpawn) {
    assert.equal(trigAfter, 0xd0, `${name}: BRANCH B needs 0x691B == 0xD0 after the add-loop (got 0x${trigAfter.toString(16)})`);
    assert.equal(selAfter, (selBefore + 1) & 0xff, `${name}: BRANCH B must inc 0x6388 (${selBefore} -> ${selAfter})`);
    assert.equal(a.mem.read8(SPAWN_FLAG), 0x20, `${name}: BRANCH B must set 0x6919 = 0x20`);
    assert.equal(a.mem.read8(RECORD), 0x7f, `${name}: BRANCH B must stamp the 0x6A24 record (7F..)`);
    assert.equal(a.regs.a, 0x03, `${name}: BRANCH B leaves A = 0x03`);
    assert.equal(a.regs.hl, 0x6388, `${name}: BRANCH B leaves HL = 0x6388`);
  } else {
    assert.notEqual(trigAfter, 0xd0, `${name}: BRANCH A needs 0x691B != 0xD0 after the add-loop (got 0x${trigAfter.toString(16)})`);
    assert.equal(selAfter, selBefore, `${name}: BRANCH A must leave 0x6388 unchanged (${selBefore} -> ${selAfter})`);
    assert.equal(a.regs.a, trigAfter, `${name}: BRANCH A leaves A = the read 0x691B (0x${trigAfter.toString(16)})`);
  }
  console.log(
    `  BRANCH ${name}: EQUAL (RAM+regs+pc); ${oracleCycles}t both sides; ` +
      `0x6388 ${selBefore} -> ${selAfter}, 0x691B -> 0x${trigAfter.toString(16)}`,
  );
}

test("BRANCH (A / ret nz): 0x691B != 0xD0 skips the spawn — EQUAL + cycle total", () => {
  const entry = captureEntry();
  // 0x691B = 0x00 -> add-loop -> 0x01 (!= 0xD0) -> ret nz, no spawn, selector held.
  proveBranch(entry, "A (ret nz)", 0x00, { expectSpawn: false });
});

test("BRANCH (B / spawn): 0x691B == 0xD0 runs the spawn — EQUAL + cycle total", () => {
  const entry = captureEntry();
  // 0x691B = 0xCF -> add-loop -> 0xD0 -> spawn record, run 3 callees, advance selector.
  proveBranch(entry, "B (spawn)", 0xcf, { expectSpawn: true });
});
