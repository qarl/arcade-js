// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_09ab (the in-game context-restore + board
 * re-derive + sub-state arm routine). Dispatched from loc_06fe's 0x0702 sub-state
 * table (GAME_STATE==3), itself reached through dispatchGameState (the vblank NMI's
 * rst-0x28 table at 0x00CA), when a game/board starts.
 *
 * Four jobs, as for entry_0611/loc_06fe, plus a per-branch coverage sweep:
 *
 *   1. EQUAL -- the idiomatic optimized loc_09ab (optimized/loc_09ab.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_09ab
 *      does NOT run in attract: it needs GAME_STATE==3, so a plain boot never reaches
 *      it (0 dispatches over 2000 attract frames). Driven with a coin+start inputTape
 *      it dispatches EXACTLY ONCE, at frame 33, on the game-start context restore,
 *      taking the 0x600F==0 branch (SUBSTATE_TIMER=1, GAME_SUBSTATE=5). A 60-frame
 *      window covers the fire and the downstream frames it seeds.
 *
 *   3. TEETH -- a deliberately-broken twin (the context restore's LEVEL store, 0x6229,
 *      lands the wrong value) must be CAUGHT: NOT-EQUAL, naming 0x6229, whole + unit.
 *
 *   4. BRANCH COVERAGE -- loc_09ab has ONE data-dependent branch, `jp z` on the 0x600F
 *      selector: ==0 arms (timer 1, sub-state 5); !=0 arms (timer 0x78, sub-state 2).
 *      The driven run only ever reaches the ==0 arm, so the !=0 arm is SYNTHESISED
 *      (poke 0x600F on a clone of the captured entry) and proven EQUAL (RAM+regs+pc).
 *      Both arms are CYCLE-COLLAPSED (one m.ret per branch), so -- per the four-rules
 *      README -- each synthesised arm ALSO asserts its cycle TOTAL equals the oracle's
 *      (310 t both), giving the collapsed !=0 arm the whole-machine run never reaches
 *      committed cycle teeth as well as state teeth.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Identical to
 * loc_06fe's reasoning: games/dkong/optimized/harness.js bakes a `makeMachine` on `{}`
 * assets that drives NO input, so it can never credit a game and never dispatches
 * loc_09ab. This test calls the SAME core unitEquivalence / wholeMachineEquivalence,
 * passing a makeMachine factory that attaches an identical coin+start inputTape to
 * BOTH sides (the factory is shared, so any input/poke is applied identically). The
 * core engine still installs its snapshot override at CONSTRUCTION -- reaching loc_09ab
 * however it is entered -- so nothing about the capture/clone/diff/counter logic is
 * re-implemented; it is the standard engine, given the input the routine requires.
 *
 * CYCLE FINDING this routine adds: loc_09ab is ATOMIC (it makes NO call at all), so
 * both branches are collapsed to a single per-branch total (310 t) and stay EQUAL
 * whole-machine AND unit. The total is kept, not dropped -- it runs in the NMI, whose
 * cost sets the spin count that seeds the PRNG (README §2). See optimized/loc_09ab.js.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_09ab as translated_09ab } from "../../translated/state0.js";
import { loc_09ab as optimized_09ab } from "../loc_09ab.js";
import { Machine } from "../../machine.js";
import {
  unitEquivalence,
  wholeMachineEquivalence,
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

const TARGET = 0x09ab;
const FRAMES = 60; // loc_09ab dispatches once at frame 33; window covers it + downstream
const MAX_FRAMES = 40; // loc_09ab first dispatches at frame 33

// A coin+start tape (identical to loc_06fe's): coin on IN2 bit7 at frame 10, start1
// on IN2 bit2 at frame 30. Credits and starts a game so GAME_STATE reaches 3 and the
// start-of-game sub-state dispatches loc_09ab at frame 33.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The makeMachine factory the core engine drives (the same shape harness.js's
// dkMachineFactory produces), extended to attach the coin+start inputTape. Called
// with no argument for the baseline and with the wrapped override map for the
// optimized side -- both get the SAME tape, so any input is applied identically.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
}

// A store on loc_09ab's own output path: the restored LEVEL byte (0x6229), written
// by the 8-byte context ldir. It is inside the compared work-RAM dump (0x6000-0x6BFF),
// persists (LEVEL only changes on level-complete), and -- unlike the LIVES byte 0x6228,
// whose corruption drives the lives-display redraw out of bounds -- corrupting it
// diverges cleanly without throwing. loc_09ab fires once (frame 33), so the corrupted
// cell is never rewritten and the diff persists.
const BROKEN_ADDR = 0x6229;

/**
 * Deliberately-broken twin: behaviourally optimized_09ab EXCEPT the first store to
 * 0x6229 lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly that
 * one write lets the rest of the routine run verbatim -- the representative "wrong
 * value to one of the routine's own output addresses" bug the gate must catch.
 */
function broken_09ab(m) {
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
    return optimized_09ab(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_09ab matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_09ab]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (game-start context restore at frame 33, 0x600F==0 branch)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_09ab matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_09ab, optimized_09ab, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, BC, DE, HL, SP) + pc identical (first entry: frame 33)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong context-restore store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_09ab]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong context-restore store is CAUGHT and names 0x6229", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_09ab, broken_09ab, { maxFrames: MAX_FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- BRANCH COVERAGE ----------------------------------------------------------

// Capture the pristine machine at loc_09ab's dispatch (frame 33), via the same
// construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_09ab(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_09ab never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

// Run one implementation on a clone with the 0x600F selector forced to `sel`, and
// return the post-run dump/regs/pc plus the routine's measured cycle total.
function runArm(entry, sel, fn) {
  const c = entry.clone();
  c.mem.write8(0x600f, sel);
  const before = c.cycles;
  fn(c);
  return { dump: c.dumpState(), regs: c.regs, pc: c.pc, cycles: c.cycles - before, c };
}

test("BRANCH COVERAGE: both 0x600F arms (==0 and !=0) EQUAL, incl. collapsed cycle totals", () => {
  const entry = captureEntry();

  // The natural/driven run only reaches the ==0 arm; assert that so the coverage
  // claim is grounded in what the whole-machine test actually exercised.
  assert.equal(entry.mem.read8(0x600f), 0, "the driven entry is expected on the 0x600F==0 arm");

  // Selector values: 0 (==0 arm, timer 1 / sub-state 5) and 1, 0xFF (!=0 arm, timer
  // 0x78 / sub-state 2 -- the arm the driven run never reaches).
  const cases = [
    { name: "0x600F==0 (timer 1, sub-state 5)", sel: 0x00, expTimer: 0x01, expSub: 0x05 },
    { name: "0x600F!=0 (timer 0x78, sub-state 2)", sel: 0x01, expTimer: 0x78, expSub: 0x02 },
    { name: "0x600F!=0 (0xFF, same arm)", sel: 0xff, expTimer: 0x78, expSub: 0x02 },
  ];

  for (const { name, sel, expTimer, expSub } of cases) {
    const t = runArm(entry, sel, translated_09ab);
    const o = runArm(entry, sel, optimized_09ab);

    const ram = firstStateDiff(t.dump, o.dump, (off) => entry.stateOffsetToAddr(off));
    const regs = firstRegDiff(t.regs, o.regs);
    assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
    assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
    assert.equal(t.pc, o.pc, `${name}: pc mismatch`);

    // The armed outputs land as expected (sanity that the arm actually ran).
    assert.equal(o.c.mem.read8(0x6009), expTimer, `${name}: SUBSTATE_TIMER`);
    assert.equal(o.c.mem.read8(0x600a), expSub, `${name}: GAME_SUBSTATE`);

    // Collapsed branch: its single per-branch charge must equal the oracle's total.
    // This is the committed cycle teeth for the !=0 arm the driven run never reaches.
    assert.equal(o.cycles, t.cycles, `${name}: cycle total ${o.cycles} != oracle ${t.cycles}`);
    assert.equal(o.cycles, 310, `${name}: expected 310 t total, got ${o.cycles}`);
  }
  console.log("  BRANCH COVERAGE: ==0 and !=0 arms EQUAL (RAM+regs+pc); both cycle totals = 310 t (oracle-matched)");
});
