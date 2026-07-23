// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for handler_123c (game-state-1 sub-state 2: seed the
 * attract-demo actor record). Like loc_127c it is dispatched from INSIDE the vblank
 * NMI, as entry 2 of handler_073c's 0x0748 rst-0x28 sub-state table (selected when
 * GAME_SUBSTATE 0x600A == 2), and gated by the `rst 0x18` sub-state countdown.
 *
 * Six jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized handler_123c reads EQUAL
 *      against its translated oracle, every frame.
 *   2. EQUAL (unit) -- EQUAL in RAM + every register (F included) + pc.
 *   3/4. TEETH (whole + unit) -- a deliberately-broken twin that lands a wrong value
 *      at the sprite-record mirror 0x694C (MARIO_SPRITE_RECORD, written once by the
 *      body; a pure display cell -- NOT a dispatch index -- so a wrong value gives a
 *      clean, persistent diff and never routes the run into an unimplemented handler)
 *      is CAUGHT: NOT-EQUAL, naming 0x694C.
 *   5/6. FULL BRANCH COVERAGE -- handler_123c has two data-dependent branches: the
 *      rst-0x18 SKIP (0x6009 still ticking) vs BODY, and within the BODY the BC
 *      constant selected by BOARD (0x6227==3 -> 0xE016 vs 0xF03F). Each is synthesised
 *      from a real captured entry and proven EQUAL (RAM + all registers + pc) AND
 *      proven to carry the SAME cycle TOTAL on both sides (teeth against a wrong or
 *      over-collapsed charge): SKIP, BODY-board!=3, BODY-board==3.
 *
 * WHY THIS TEST DRIVES A POKE (like 127c/084b, and cannot use the fixed harness.js
 * factory). handler_123c DOES dispatch from a plain boot -- but only deep in attract
 * (measured: first at frame 522, always with BOARD==1). Rather than run ~540 frames
 * twice, an IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke the board state to
 * reach a state for validation") forces it at frame 100: 0x6005=1 (GAME_STATE), 0x6001=0
 * (enable handler_073c's sub-state dispatch), 0x600A=2 (select handler_123c), and
 * 0x6009=1 (the rst-0x18 gate expires this tick, so the BODY runs -- the arm that
 * writes the 0x694C the teeth corrupt). The poke is threaded via a custom makeMachine
 * factory (m.pokes) driving the game-agnostic CORE engine, applied to baseline and
 * optimized alike so equivalence is preserved.
 *
 * THE CYCLE FINDING this routine confirms: handler_123c is ATOMIC (it runs inside the
 * NMI, whose mask is cleared for the whole handler, so no second NMI can land inside
 * it or its callees). Its body's ~22 per-instruction charges collapse to ONE total per
 * branch -- 255t (BOARD==3) / 265t (else) -- and whole-machine stays EQUAL, so the
 * distribution is unobservable. The TOTAL is still load-bearing (it is part of the
 * NMI's cost -> the main-loop spin count, README §2), so it is preserved exactly; the
 * per-arm cycle teeth below would catch a wrong total. No hardware (0x7Dxx) write
 * occurs, so there is no write-trace to preserve.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { handler_123c as translated_123c } from "../../translated/nmi.js";
import { handler_123c as optimized_123c } from "../handler_123c.js";
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

const TARGET = 0x123c;
const FRAMES = 130; // handler_123c is forced to dispatch at frame 100
const POKE_FRAME = 100;

// The first byte of the sprite-record mirror, written once by the BODY (`ld (hl),c`
// with HL=0x694C). A pure display cell (DMA'd to sprite RAM) -- NOT a dispatch index,
// no control-flow effect -- so a wrong value gives a clean, persistent diff and never
// crashes the run (unlike e.g. corrupting MARIO_Y, which steers into a stub).
const BROKEN_ADDR = 0x694c;

// Identical-both-sides poke: state-1 / sub-state-2 / rst-0x18 expires this tick, so
// handler_123c dispatches and its BODY runs (the arm that writes 0x694C). One-shot
// (dur 1) so the poke does not re-mask the bytes on the sampled frame.
const FORCE_123C_POKE = [
  { addr: 0x6005, val: 0x01, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 1
  { addr: 0x6001, val: 0x00, frame: POKE_FRAME, dur: 1 }, // enable sub-state dispatch (handler_073c)
  { addr: 0x600a, val: 0x02, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 2 -> handler_123c
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // rst-0x18 gate expires -> BODY runs
];

// The engine's factory: a DK Machine on this ROM with the force-123c poke loaded.
// Called with no argument for the baseline and with the wrapped override map for the
// optimized side (the core engine wraps each override with its own invocation counter,
// so an EQUAL that never dispatched cannot pass vacuously). A fresh copy of the poke
// per machine keeps each run independent.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_123C_POKE.map((p) => ({ ...p }));
  return m;
};

// The broken twin lands the wrong value at 0x694C (XOR 0xFF, guaranteed to differ) on
// the FIRST write there, letting every other write and every subroutine run verbatim --
// the representative "wrong value to one of the routine's own output addresses" bug the
// gate must catch.
function broken_123c(m) {
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
    return optimized_123c(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized handler_123c matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_123c]]));

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

test("EQUAL (unit): idiomatic optimized handler_123c matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_123c, optimized_123c, { maxFrames: 150 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x694C store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_123c]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong 0x694C store is CAUGHT and names 0x694C", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_123c, broken_123c, { maxFrames: 150 });

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
 * Capture ONE real entry to handler_123c (via the engine's construction-time snapshot
 * override on the poke-driven host), so the synthesised arms inherit a valid stack (the
 * rst pushes/pops unwind it) and realistic RAM.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_123c(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(150);
  assert.ok(entry !== null, "failed to capture a handler_123c entry to synthesise arms from");
  return entry;
}

/** Run a fn on a clone and return the T-states it consumed (clone() neutralises the
 * NMI/frame machinery, so the count is exactly the routine's own, callees included). */
function cyclesOf(seed, fn) {
  const c = seed.clone();
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

/**
 * Prove one arm EQUAL. Sets the deciding RAM on a clone of a captured entry, runs
 * oracle vs optimized on two further clones, and asserts: RAM + every register + pc
 * identical, the SAME cycle total on both sides (teeth against a wrong/over-collapsed
 * total), and -- non-vacuously -- that the arm actually took its intended path via
 * `check`.
 */
function proveArm(entry, name, setup, check) {
  const seed = entry.clone();
  setup(seed);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  translated_123c(a);
  optimized_123c(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, `${name}: pc must match`);

  // Cycle TOTAL teeth: the optimized routine must consume exactly the oracle's
  // T-states on this arm (a wrong or over-collapsed charge would differ).
  const cycT = cyclesOf(seed, translated_123c);
  const cycO = cyclesOf(seed, optimized_123c);
  assert.ok(cycT > 0, `${name}: oracle must consume cycles`);
  assert.equal(cycO, cycT, `${name}: cycle total ${cycO} != oracle ${cycT}`);

  // Non-vacuous: the synthesised entry actually reached the intended arm.
  check(seed, a, name);
  console.log(`  ARM ${name}: EQUAL (RAM+regs+pc); cycle total ${cycO}`);
}

const rd = (m, addr) => m.mem.read8(addr);

test("BRANCH (rst-0x18): SKIP (0x6009 still ticking) vs BODY — both EQUAL", () => {
  const entry = captureEntry();

  // SKIP: 0x6009=2 -> rst-0x18 decrements to 1 (nonzero) -> body skipped; 0x600A
  // (GAME_SUBSTATE) is untouched and no actor field is written.
  proveArm(entry, "SKIP (gate not expired)",
    (s) => { s.mem.write8(0x6009, 2); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x6009), 1, `${name}: expected 0x6009 decremented 2->1`);
      assert.equal(rd(a, 0x600a), rd(seed, 0x600a), `${name}: expected GAME_SUBSTATE untouched`);
    });

  // BODY: 0x6009=1 -> rst-0x18 expires -> body runs, advancing GAME_SUBSTATE by one.
  proveArm(entry, "BODY (gate expires)",
    (s) => { s.mem.write8(0x6009, 1); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x600a), (rd(seed, 0x600a) + 1) & 0xff, `${name}: expected GAME_SUBSTATE incremented once`);
    });
});

test("BRANCH (BOARD select): board!=3 -> BC=0xF03F and board==3 -> BC=0xE016 — both EQUAL", () => {
  const entry = captureEntry();

  // board != 3: BC = 0xF03F -> C=0x3F written to MARIO_X (0x6203), B=0xF0 to MARIO_Y
  // (0x6205). Collapsed body total 265t.
  proveArm(entry, "BODY board!=3 (BC=0xF03F)",
    (s) => { s.mem.write8(0x6009, 1); s.mem.write8(0x6227, 1); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x6227), 1, `${name}: precondition BOARD==1`);
      assert.equal(rd(a, 0x6203), 0x3f, `${name}: expected MARIO_X = C = 0x3F`);
      assert.equal(rd(a, 0x6205), 0xf0, `${name}: expected MARIO_Y = B = 0xF0`);
    });

  // board == 3: BC = 0xE016 -> C=0x16 to MARIO_X, B=0xE0 to MARIO_Y. Collapsed body
  // total 255t (10t less: the `ld bc,0xF03F` on the not-taken arm is skipped).
  proveArm(entry, "BODY board==3 (BC=0xE016)",
    (s) => { s.mem.write8(0x6009, 1); s.mem.write8(0x6227, 3); },
    (seed, a, name) => {
      assert.equal(rd(a, 0x6227), 3, `${name}: precondition BOARD==3`);
      assert.equal(rd(a, 0x6203), 0x16, `${name}: expected MARIO_X = C = 0x16`);
      assert.equal(rd(a, 0x6205), 0xe0, `${name}: expected MARIO_Y = B = 0xE0`);
    });
});
