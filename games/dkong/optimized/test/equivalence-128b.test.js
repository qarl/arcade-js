// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for entry_128b (game-state-1 sub-state-4, animation-
 * state 0: arm the two-cell blinker + advance the sub-state's own state machine).
 * Like loc_084b it is dispatched from INSIDE the NMI, as arm 0 of entry_127f's
 * rst-0x28 table at 0x1283, reached through handler_073c's 0x0748 sub-state table
 * entry 4.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized entry_128b (optimized/entry_128b.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. entry_128b
 *      is reached via `m.call(0x128b)` from the rst-0x28 dispatcher (nmi.js), so the
 *      registry override (+ its invocation counter) resolves there.
 *
 *   3. TEETH -- a deliberately-broken twin (the FIRST store, the blinker cell
 *      0x694D, lands a wrong value) must be CAUGHT: NOT-EQUAL, naming 0x694D.
 *
 *   4/5. FULL BRANCH COVERAGE -- entry_128b has one guard branch and, within the
 *      body, one data-dependent value:
 *        SKIP    -- rst 0x18 not expired (0x6009 > 1): body skipped, no body store.
 *        PROCEED -- rst 0x18 expired (0x6009 == 1): body runs. The blinker cell
 *                   0x694D becomes 0xF8 if its old bit7 was set, else 0x78 -- both
 *                   sub-values are proven.
 *      Each branch is proven EQUAL (RAM + all registers + pc) on a SYNTHESISED
 *      entry, shown non-vacuously to have taken that branch, AND -- because the body
 *      is CYCLE-COLLAPSED and the natural/driven run reaches only one arm -- each
 *      synthesised branch also asserts its total cycle count equals the oracle's
 *      (measured across the routine on both clones), which is the teeth on a wrong
 *      collapsed total.
 *
 * WHY THIS TEST DRIVES A POKE (and, like loc_084b, cannot use games/dkong/
 * optimized/harness.js directly). entry_128b runs only while GAME_STATE(0x6005)==1,
 * CREDITS(0x6001)==0, GAME_SUBSTATE(0x600A)==4 and the animation state 0x639D==0 --
 * a sub-state the 0x0748 table's own comment flags as "regions nothing has reached
 * yet" (0 hits from boot). So these tests force it with an IDENTICAL-BOTH-SIDES poke
 * (Karl's sanctioned "poke the board state to reach a state for validation" --
 * applied to baseline and optimized alike, so equivalence is preserved): a one-shot
 * poke at frame 100 sets 0x6005=1, 0x6001=0 (enable the sub-state dispatch),
 * 0x600A=4 (select the 0x127C chain), 0x6340=0 (so sub_1dbd dispatches to the
 * loc_1e49 `ret` no-op, keeping the chain crash-free), 0x639D=0 (select entry_128b),
 * and SUBSTATE_TIMER 0x6009=1 (so entry_128b's rst 0x18 expires THIS tick -> the
 * PROCEED branch, which is the branch that stores). Threaded via a custom
 * `makeMachine` factory (m.pokes) driving the game-agnostic CORE engine
 * (core/equivalence.js) -- the SAME construction-time snapshot override the DK
 * harness wrapper uses, with a factory that can carry the poke, which the wrapper's
 * fixed (rom, assets) factory cannot.
 *
 * THE COLLAPSE FINDING this routine adds: entry_128b is ATOMIC because it is
 * dispatched from inside the NMI, where the NMI mask is held -- the vblank NMI can
 * never land inside it or its callees. Collapsing the PROCEED body's per-instruction
 * charges to one pre-call block (121t) + m.ret(30) stays EQUAL whole-machine AND
 * unit (verified here, incl. the explicit per-branch cycle totals). The TOTAL is
 * preserved because the NMI's cumulative cost feeds mainLoop's vblank-spin count
 * (README §2); only the internal DISTRIBUTION is free.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { entry_128b as translated_128b } from "../../translated/state0.js";
import { entry_128b as optimized_128b } from "../entry_128b.js";
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

const TARGET = 0x128b;
const FRAMES = 120; // entry_128b is forced to dispatch at frame 100
const BLINK_CELL = 0x694d; // the routine's first store (low blinker cell)
const ANIM_STATE = 0x639d; // inc'd on PROCEED, untouched on SKIP
const SND_IRQ_TRIGGER = 0x6088; // the routine's last store
const SUBSTATE_TIMER = 0x6009;
const POKE_FRAME = 100;

// Identical-both-sides poke that forces state-1 / sub-state-4 / anim-state-0 with
// the substate timer expiring on a SINGLE frame, so entry_128b dispatches once and
// takes the PROCEED branch (the branch that stores). One-shot (dur 1) so the stored
// values are NOT re-masked by the poke on the frame they are sampled.
const FORCE_128B_POKE = [
  { addr: 0x6005, val: 0x01, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 1
  { addr: 0x6001, val: 0x00, frame: POKE_FRAME, dur: 1 }, // CREDITS = 0 -> enable sub-state dispatch
  { addr: 0x600a, val: 0x04, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 4 -> the 0x127C chain
  { addr: 0x6340, val: 0x00, frame: POKE_FRAME, dur: 1 }, // sub_1dbd -> loc_1e49 (ret no-op)
  { addr: 0x639d, val: 0x00, frame: POKE_FRAME, dur: 1 }, // animation state 0 -> entry_128b
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER: expires this tick -> PROCEED
];

// The engine's factory: a DK Machine on this ROM with the force-128b poke loaded.
// Called with no argument for the baseline and with the wrapped override map for
// the optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously). A fresh copy
// of the poke per machine keeps each run independent.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_128B_POKE.map((p) => ({ ...p }));
  return m;
};

// entry_128b's FIRST store is the blinker cell 0x694D. The broken twin lands the
// correct value XOR 0xFF there (guaranteed to differ; 0x694D is a sprite scratch
// byte, not a dispatch index, so the run stays healthy). Intercepting exactly that
// one write lets sub_0018/sub_30bd and the rest of the routine run verbatim.
function broken_128b(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BLINK_CELL) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_128b(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized entry_128b matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_128b]]));

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

test("EQUAL (unit): idiomatic optimized entry_128b matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_128b, optimized_128b, { maxFrames: 150 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong blinker-cell store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_128b]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong blinker-cell store is CAUGHT and names 0x694D", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_128b, broken_128b, { maxFrames: 150 });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BLINK_CELL,
    `expected first diff at 0x${BLINK_CELL.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (synthesised per-branch teeth, incl. cycle totals) --

/**
 * Capture ONE real entry to entry_128b (via the engine's construction-time snapshot
 * override on the poke-driven host), then synthesise each branch from it. Reusing a
 * real captured entry gives a valid stack (the rst pops/unwinds it) and realistic RAM.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_128b(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(150);
  assert.ok(entry !== null, "failed to capture an entry_128b entry to synthesise branches from");
  return entry;
}

/**
 * Prove one branch EQUAL. Sets the deciding SUBSTATE_TIMER (0x6009) and, for the
 * PROCEED sub-value, the blinker cell's bit7 (0x694D). Runs oracle vs optimized on
 * two clones and asserts RAM + every register + pc identical, that the branch took
 * the expected path (non-vacuous), AND that both consumed the SAME total cycles
 * (the teeth on the collapsed cycle total). Cycles are measured as the m.cycles
 * delta -- a clone's frame machinery is neutralised (nextNmi = Infinity), so nothing
 * but the routine advances the clock.
 */
function proveBranch(entry, name, timer, blinkSeed, opts) {
  const seed = entry.clone();
  seed.mem.write8(SUBSTATE_TIMER, timer);
  if (blinkSeed != null) seed.mem.write8(BLINK_CELL, blinkSeed);
  const animBefore = seed.mem.read8(ANIM_STATE);
  const irqBefore = seed.mem.read8(SND_IRQ_TRIGGER);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized

  const aCyc0 = a.cycles;
  translated_128b(a);
  const oracleCycles = a.cycles - aCyc0;

  const bCyc0 = b.cycles;
  optimized_128b(b);
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
  const animAfter = a.mem.read8(ANIM_STATE);
  if (opts.expectProceed) {
    assert.equal(animAfter, (animBefore + 1) & 0xff, `${name}: PROCEED must inc 0x639D (${animBefore} -> ${animAfter})`);
    assert.equal(a.mem.read8(BLINK_CELL), opts.expectBlink, `${name}: blinker cell must be 0x${opts.expectBlink.toString(16)}`);
    assert.equal(a.mem.read8(SND_IRQ_TRIGGER), 0x03, `${name}: PROCEED must set 0x6088 = 3`);
  } else {
    assert.equal(animAfter, animBefore, `${name}: SKIP must leave 0x639D (${animBefore} -> ${animAfter})`);
    assert.equal(a.mem.read8(SND_IRQ_TRIGGER), irqBefore, `${name}: SKIP must leave 0x6088`);
  }
  console.log(
    `  BRANCH ${name}: EQUAL (RAM+regs+pc); ${oracleCycles}t both sides; ` +
      `0x639D ${animBefore} -> ${animAfter}`,
  );
}

test("BRANCH (SKIP): rst 0x18 not-expired skips the body — EQUAL + cycle total", () => {
  const entry = captureEntry();
  // 0x6009 = 2 -> sub_0018 dec's to 1 (not zero) -> discards remainder, body skipped.
  proveBranch(entry, "SKIP (timer survives)", 2, null, { expectProceed: false });
});

test("BRANCH (PROCEED): rst 0x18 expired runs the body — both blinker sub-values EQUAL + cycle total", () => {
  const entry = captureEntry();
  // 0x6009 = 1 -> sub_0018 dec's to 0 -> PROCEED. Blinker cell bit7 clear -> 0x78.
  proveBranch(entry, "PROCEED-lo (old bit7 clear)", 1, 0x00, { expectProceed: true, expectBlink: 0x78 });
  // Blinker cell bit7 set -> 0xF8.
  proveBranch(entry, "PROCEED-hi (old bit7 set)", 1, 0x80, { expectProceed: true, expectBlink: 0xf8 });
});
