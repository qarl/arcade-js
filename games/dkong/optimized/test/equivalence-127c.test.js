// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_127c (game-state-1 sub-state 4: a two-step
 * DISPATCH SEQUENCER -- `call 0x1dbd` then fall through into entry_127f). Like
 * loc_084b it is dispatched from INSIDE the NMI, as entry 4 of handler_073c's
 * 0x0748 sub-state table (selected when GAME_SUBSTATE 0x600A == 4).
 *
 * What makes loc_127c unusual among the optimized routines: it reads and writes
 * NO work RAM of its own. Its whole body is one instruction (`call 0x1dbd`, 17 t)
 * plus a fall-through into entry_127f, and every RAM effect on the path is made by
 * the callees (sub_1dbd, then one of entry_128b / loc_12ac / loc_12de). So the
 * "wrong store" the teeth must catch necessarily lands in a callee's output -- as
 * it does for entry_0611, whose first store is also inside a subroutine.
 *
 * Six jobs:
 *
 *   1. EQUAL (whole-machine) -- the optimized loc_127c reads EQUAL against its
 *      translated oracle, every frame.
 *   2. EQUAL (unit) -- EQUAL in RAM + every register (F included) + pc.
 *   3/4. TEETH (whole + unit) -- a deliberately-broken twin that lands a wrong
 *      value at the sub-state countdown 0x639E (written once by entry_128b, a plain
 *      data cell, NOT a dispatch index -> a clean diff that never crashes the run)
 *      is CAUGHT: NOT-EQUAL, naming 0x639E.
 *   5/6. FULL BRANCH COVERAGE -- loc_127c has no branch of its OWN, but it routes
 *      through entry_127f's rst-0x28 arms. Each reachable arm is synthesised from a
 *      real captured entry and proven EQUAL (RAM + all registers + pc) AND proven to
 *      carry the SAME cycle TOTAL on both sides (measured across the routine on two
 *      clones -- the teeth against a wrong/collapsed total): entry_128b BODY and
 *      SKIP (0x639D==0), loc_12ac ANIMATE and TAIL (0x639D==1), loc_12de (0x639D==2).
 *
 * WHY THIS TEST DRIVES A POKE (like 084b, and cannot use the fixed harness.js
 * factory). loc_127c NEVER dispatches from boot: measured 0 hits across 1200 frames
 * of attract. So an IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke the board
 * state to reach a state for validation") forces it at frame 100: 0x6005=1
 * (GAME_STATE), 0x6001=0 (enable handler_073c's sub-state dispatch), 0x600A=4
 * (select loc_127c), and 0x6009=1 (the rst-0x18 gate expires this tick, so
 * entry_128b's BODY runs -- the path that writes the 0x639E the teeth corrupt).
 * The poke is threaded via a custom makeMachine factory (m.pokes) driving the
 * game-agnostic CORE engine, applied to baseline and optimized alike so
 * equivalence is preserved. No hand-rolled snapshot workaround: the reachability
 * wiring is the engine's construction-time override.
 *
 * THE CYCLE FINDING this routine adds: loc_127c's cycles are NOT collapsed because
 * there is nothing to collapse -- one own instruction (17 t), one path. The single
 * charge already IS the total, and it is LOAD-BEARING: dropping the 17 t diverges
 * at stack 0x6BF6 (frame 102, 25 vs 131), the downstream-NMI-push mechanism of
 * entry_0611 (entry_127f's handlers are interruptible). Kept verbatim.
 *
 * EXEMPT ARMS (delegated identically by construction, so no divergence in loc_127c
 * is possible; not separately synthesised): entry_127f arm 3 (0x639D==3 -> the
 * 0x0000 reset vector, untranslated) and sub_1dbd's non-zero arms (0x6340==1/2/3 ->
 * finale-latent states whose RAM pointers are uninitialised at a state-1 entry, so
 * the oracle itself faults on an unmapped write when synthesised there). Both
 * loc_127c versions reach them via the identical `m.call`, so either both fault
 * identically or both run identically -- there is no arm on which they can differ.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_127c as translated_127c } from "../../translated/state0.js";
import { loc_127c as optimized_127c } from "../loc_127c.js";
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

const TARGET = 0x127c;
const FRAMES = 130; // loc_127c is forced to dispatch from frame 100 on
const POKE_FRAME = 100;

// entry_128b's inner sub-state countdown, written exactly once (to 0x0D) on the
// entry_128b BODY arm. A plain data cell -- NOT a dispatch index -- so a wrong
// value there gives a clean, persistent diff and never routes the run into an
// unimplemented handler (which would crash instead of diff, per 084b's note).
const BROKEN_ADDR = 0x639e;

// Identical-both-sides poke: state-1 / sub-state-4 / rst-0x18 expires this tick,
// so loc_127c dispatches and entry_128b's BODY runs (the arm that writes 0x639E).
// One-shot (dur 1) so the poke does not re-mask the bytes on the sampled frame.
const FORCE_127C_POKE = [
  { addr: 0x6005, val: 0x01, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 1
  { addr: 0x6001, val: 0x00, frame: POKE_FRAME, dur: 1 }, // enable sub-state dispatch (handler_073c)
  { addr: 0x600a, val: 0x04, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 4 -> loc_127c
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // rst-0x18 gate expires -> entry_128b BODY
];

// The engine's factory: a DK Machine on this ROM with the force-127c poke loaded.
// Called with no argument for the baseline and with the wrapped override map for
// the optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously). A fresh copy
// of the poke per machine keeps each run independent.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_127C_POKE.map((p) => ({ ...p }));
  return m;
};

// loc_127c makes no store of its own; its path's representative output is
// entry_128b's 0x639E := 0x0D. The broken twin lands the wrong value there (XOR
// 0xFF, guaranteed to differ) on the FIRST write to 0x639E, letting every callee
// otherwise run verbatim -- the "wrong value to one of the routine's own output
// addresses" bug the gate must catch.
function broken_127c(m) {
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
    return optimized_127c(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_127c matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_127c]]));

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

test("EQUAL (unit): idiomatic optimized loc_127c matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_127c, optimized_127c, { maxFrames: 150 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x639E store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_127c]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong 0x639E store is CAUGHT and names 0x639E", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_127c, broken_127c, { maxFrames: 150 });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (synthesised per-arm teeth incl. cycle totals) -------

/**
 * Capture ONE real entry to loc_127c (via the engine's construction-time snapshot
 * override on the poke-driven host), so the synthesised arms inherit a valid stack
 * (the rst pushes/pops unwind it) and realistic RAM.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_127c(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(150);
  assert.ok(entry !== null, "failed to capture a loc_127c entry to synthesise arms from");
  return entry;
}

/** Run a fn on a clone and return the T-states it consumed (clone() neutralises
 * the NMI/frame machinery, so the count is exactly the routine's own). */
function cyclesOf(seed, fn) {
  const c = seed.clone();
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

/**
 * Prove one arm EQUAL. Sets the deciding RAM on a clone of a captured entry, runs
 * oracle vs optimized on two further clones, and asserts: RAM + every register +
 * pc identical, the SAME cycle total on both sides (teeth against a wrong total),
 * and -- non-vacuously -- that the arm actually took its intended path via `check`.
 */
function proveArm(entry, name, setup, check) {
  const seed = entry.clone();
  setup(seed);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  translated_127c(a);
  optimized_127c(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, `${name}: pc must match`);

  // Cycle TOTAL teeth: the optimized routine must consume exactly the oracle's
  // T-states on this arm (a wrong or over-collapsed charge would differ).
  const cycT = cyclesOf(seed, translated_127c);
  const cycO = cyclesOf(seed, optimized_127c);
  assert.ok(cycT > 0, `${name}: oracle must consume cycles`);
  assert.equal(cycO, cycT, `${name}: cycle total ${cycO} != oracle ${cycT}`);

  // Non-vacuous: the synthesised entry actually reached the intended arm.
  check(seed, a, name);
  console.log(`  ARM ${name}: EQUAL (RAM+regs+pc); cycle total ${cycO}`);
}

const rd = (m, addr) => m.mem.read8(addr);

test("BRANCH (0x639D==0, entry_128b): BODY (rst-0x18 expires) and SKIP (does not) — both EQUAL", () => {
  const entry = captureEntry();

  // BODY: 0x6009=1 -> rst-0x18 expires -> entry_128b advances the sub-state 0->1
  // and seeds the 0x639E countdown to 0x0D.
  proveArm(entry, "128b-BODY (advance 0x639D 0->1)",
    (s) => { s.mem.write8(0x6340, 0); s.mem.write8(0x639d, 0); s.mem.write8(0x6009, 1); },
    (seed, a, name) => {
      assert.equal(rd(seed, 0x639d), 0, `${name}: precondition 0x639D==0`);
      assert.equal(rd(a, 0x639d), 1, `${name}: expected 0x639D advanced 0->1`);
      assert.equal(rd(a, 0x639e), 0x0d, `${name}: expected 0x639E seeded to 0x0D`);
    });

  // SKIP: 0x6009=2 -> rst-0x18 does NOT expire -> entry_128b decrements 0x6009
  // only and returns; the sub-state (0x639D) is untouched.
  proveArm(entry, "128b-SKIP (gate not expired)",
    (s) => { s.mem.write8(0x6340, 0); s.mem.write8(0x639d, 0); s.mem.write8(0x6009, 2); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x639d), rd(seed, 0x639d), `${name}: expected 0x639D untouched`);
      assert.equal(rd(a, 0x6009), 1, `${name}: expected 0x6009 decremented 2->1`);
    });
});

test("BRANCH (0x639D==1, loc_12ac): ANIMATE (0x639E survives) and TAIL (0x639E hits 0) — both EQUAL", () => {
  const entry = captureEntry();

  // ANIMATE: 0x639E=2 -> dec to 1 (nonzero) -> toggle the 0x694D/0x694E blinker.
  proveArm(entry, "12ac-ANIMATE (blinker toggle)",
    (s) => { s.mem.write8(0x6340, 0); s.mem.write8(0x639d, 1); s.mem.write8(0x6009, 1); s.mem.write8(0x639e, 2); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x639e), 1, `${name}: expected 0x639E decremented 2->1`);
      assert.equal(rd(a, 0x639d), 1, `${name}: expected 0x639D untouched (no tail)`);
    });

  // TAIL: 0x639E=1 -> dec to 0 -> tail12cb advances the sub-state 0x639D 1->2.
  proveArm(entry, "12ac-TAIL (advance 0x639D 1->2)",
    (s) => { s.mem.write8(0x6340, 0); s.mem.write8(0x639d, 1); s.mem.write8(0x6009, 1); s.mem.write8(0x639e, 1); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x639e), 0, `${name}: expected 0x639E decremented 1->0`);
      assert.equal(rd(a, 0x639d), 2, `${name}: expected 0x639D advanced 1->2`);
    });
});

test("BRANCH (0x639D==2, loc_12de): advances GAME_SUBSTATE 0x600A — EQUAL", () => {
  const entry = captureEntry();

  // 0x6009=1 -> rst-0x18 expires -> loc_12de increments 0x600A (player 1: one inc).
  proveArm(entry, "12de (advance 0x600A)",
    (s) => { s.mem.write8(0x6340, 0); s.mem.write8(0x639d, 2); s.mem.write8(0x6009, 1); s.mem.write8(0x600e, 0); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x600a), (rd(seed, 0x600a) + 1) & 0xff, `${name}: expected 0x600A incremented once`);
    });
});
