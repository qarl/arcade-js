// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_084b (game-state-1 sub-state 7: a two-
 * prescaler timed gate that clears GAME_SUBSTATE once both prescalers expire).
 * Unlike the main-loop routines (059b/0611), loc_084b is dispatched from INSIDE
 * the NMI, as entry 7 of handler_073c's 0x0748 sub-state table.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_084b (optimized/loc_084b.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *
 *   3. TEETH -- a deliberately-broken twin (the GAME_SUBSTATE store lands a wrong
 *      value) must be CAUGHT: NOT-EQUAL, naming the diverging RAM address (0x600A).
 *
 *   4/5. FULL BRANCH COVERAGE -- loc_084b has two branches from its own view:
 *      SKIP (rst 0x20 returns false, 0x600A untouched) and PROCEED (returns true,
 *      0x600A <- 0). Each is proven EQUAL (RAM + all registers + pc) on a
 *      SYNTHESISED entry, and shown to have actually taken that branch. Both SKIP
 *      sub-paths (fast-prescaler-only, and fast-expires-into-slow) are covered so
 *      every callee path through sub_0020/sub_0018 is exercised.
 *
 * WHY THIS TEST DRIVES A POKE (and, like 059b, cannot use games/dkong/optimized/
 * harness.js directly). loc_084b runs only while GAME_STATE (0x6005) == 1 and
 * GAME_SUBSTATE (0x600A) == 7 -- a transient sub-state that NEVER dispatches from
 * boot: measured 0 hits across 1200 frames of attract AND 3000 frames of driven
 * coin+start. So these tests force it with an IDENTICAL-BOTH-SIDES poke (Karl's
 * sanctioned "poke the board state to reach a state for validation" -- applied to
 * baseline and optimized alike, so equivalence is preserved): a one-shot poke at
 * frame 100 sets 0x6005=1, 0x6001=0 (enable the sub-state dispatch in handler_073c),
 * 0x600A=7 (select loc_084b), and both prescalers 0x6008=0x6009=1 (so BOTH expire
 * on this tick -> the PROCEED branch, which is the branch that actually stores).
 * These are threaded via a custom `makeMachine` factory (m.pokes) driving the
 * game-agnostic CORE engine (core/equivalence.js) -- the SAME construction-time
 * snapshot override the DK harness wrapper uses, just with a factory that can
 * carry the poke, which the wrapper's fixed (rom, assets) factory cannot. No
 * hand-rolled snapshot workaround: the reachability wiring is the engine's.
 *
 * WHY THE BROKEN VALUE IS 0x07, NOT `^0xff`. 0x600A is a dispatch INDEX: an out-
 * of-range value (0xFF) sends handler_073c's next-frame dispatch to an
 * unimplemented handler (0x2300) and the run stops early -- a crash, not a clean
 * diff. So the broken twin stores a WRONG-but-in-range index (7, re-dispatching
 * loc_084b, which is implemented and healthy). It is still wrong (correct is 0)
 * and is caught at the very next frame's state sample.
 *
 * THE COLLAPSE FINDING this routine adds: loc_084b is ATOMIC because it is
 * dispatched from inside the NMI, where the NMI mask is held -- the vblank NMI can
 * never land inside it. Collapsing its PROCEED-branch post-call charges (ld hl 10
 * + ld (hl) 10 + ret 10 = 30) into one m.ret(30) stays EQUAL whole-machine AND
 * unit (verified here). The TOTAL is preserved because it is still load-bearing:
 * the NMI's cumulative cycles feed mainLoop's vblank-spin count (the PRNG entropy,
 * README §2); only the internal DISTRIBUTION is free. (If the collapse had
 * diverged, the rule is to revert to per-instruction -- it did not.)
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_084b as translated_084b } from "../../translated/state0.js";
import { loc_084b as optimized_084b } from "../loc_084b.js";
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

const TARGET = 0x084b;
const FRAMES = 120; // loc_084b is forced to dispatch at frame 100
const GAME_SUBSTATE = 0x600a; // the routine's one output address
const POKE_FRAME = 100;

// Identical-both-sides poke that forces state-1 / sub-state-7 / both-prescalers-
// expire on a SINGLE frame, so loc_084b dispatches once and takes the PROCEED
// branch (the branch that stores GAME_SUBSTATE). One-shot (dur 1) so the cleared
// value is NOT re-masked by the poke on the frame it is sampled.
const FORCE_084B_POKE = [
  { addr: 0x6005, val: 0x01, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 1
  { addr: 0x6001, val: 0x00, frame: POKE_FRAME, dur: 1 }, // enable sub-state dispatch (handler_073c)
  { addr: 0x600a, val: 0x07, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 7 -> loc_084b
  { addr: 0x6008, val: 0x01, frame: POKE_FRAME, dur: 1 }, // fast prescaler: expires this tick
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // slow prescaler: expires this tick
];

// The engine's factory: a DK Machine on this ROM with the force-084b poke loaded.
// Called with no argument for the baseline and with the wrapped override map for
// the optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously). A fresh copy
// of the poke per machine keeps each run independent.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_084B_POKE.map((p) => ({ ...p }));
  return m;
};

// loc_084b's ONLY store is GAME_SUBSTATE <- 0 (PROCEED branch). The broken twin
// lands a WRONG-but-in-range value (7) there; 7 is caught at the next frame sample
// yet keeps the sub-state dispatcher healthy (see file header). Intercepting
// exactly that one write lets sub_0020/sub_0018 and the rest run verbatim.
const WRONG_VAL = 0x07;
function broken_084b(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === GAME_SUBSTATE) {
      broke = true;
      return realWrite(addr, WRONG_VAL, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_084b(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_084b matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_084b]]));

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

test("EQUAL (unit): idiomatic optimized loc_084b matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_084b, optimized_084b, { maxFrames: 150 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong GAME_SUBSTATE store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_084b]]));

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
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_084b, broken_084b, { maxFrames: 150 });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    GAME_SUBSTATE,
    `expected first diff at 0x${GAME_SUBSTATE.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (synthesised per-branch teeth) ----------------------

/**
 * Capture ONE real entry to loc_084b (via the engine's construction-time snapshot
 * override on the poke-driven host), then for each branch: clone that pristine
 * entry, set the deciding prescalers 0x6008/0x6009, and diff the translated oracle
 * against the optimized rewrite on two further clones. Reusing a real captured
 * entry gives a valid stack (the rst pops/unwinds it) and realistic RAM.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_084b(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(150);
  assert.ok(entry !== null, "failed to capture a loc_084b entry to synthesise branches from");
  return entry;
}

/**
 * Prove one branch EQUAL. Sets the prescalers, runs oracle vs optimized on clones,
 * asserts RAM + every register + pc identical, and asserts the branch took the
 * expected path (so the teeth are not vacuous): SKIP leaves GAME_SUBSTATE
 * untouched, PROCEED zeroes it.
 */
function proveBranch(entry, name, r6008, r6009, expectCleared) {
  const seed = entry.clone();
  seed.mem.write8(0x6008, r6008);
  seed.mem.write8(0x6009, r6009);
  const before = seed.mem.read8(GAME_SUBSTATE);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  translated_084b(a);
  optimized_084b(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, `${name}: pc must match`);

  // Non-vacuous: confirm the synthesised entry actually reached the intended branch.
  const after = a.mem.read8(GAME_SUBSTATE);
  if (expectCleared) {
    assert.equal(after, 0, `${name}: expected PROCEED to zero GAME_SUBSTATE (was ${before}, is ${after})`);
  } else {
    assert.equal(after, before, `${name}: expected SKIP to leave GAME_SUBSTATE (was ${before}, is ${after})`);
  }
  console.log(`  BRANCH ${name}: EQUAL (RAM+regs+pc); GAME_SUBSTATE ${before} -> ${after}`);
}

test("BRANCH (SKIP): rst 0x20 not-expired leaves GAME_SUBSTATE untouched — both sub-paths EQUAL", () => {
  const entry = captureEntry();
  // A1: fast prescaler alone survives (0x6008 2->1) -> sub_0020 pops+returns false.
  proveBranch(entry, "SKIP-shallow (fast prescaler survives)", 2, 5, false);
  // A2: fast prescaler expires into the slow one, which survives (0x6008 1->0
  // tail-jumps sub_0018; 0x6009 3->2) -> sub_0018 inc-sp's and returns false.
  proveBranch(entry, "SKIP-deep (fast expires, slow survives)", 1, 3, false);
});

test("BRANCH (PROCEED): rst 0x20 both-expired zeroes GAME_SUBSTATE — EQUAL", () => {
  const entry = captureEntry();
  // B: both prescalers expire on this tick (0x6008 1->0 tail-jumps sub_0018;
  // 0x6009 1->0 returns true) -> loc_084b clears GAME_SUBSTATE.
  proveBranch(entry, "PROCEED (both prescalers expire)", 1, 1, true);
});
