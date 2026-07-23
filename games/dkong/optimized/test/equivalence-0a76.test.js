// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0a76 (the opening Kong-climb cutscene STEP
 * dispatcher: `ld a,(0x6385) / rst 0x28` through the 8-entry inline jump table at
 * ROM 0x0A7A). It sits ONE m.call level below loc_06fe: while a credited game is in
 * its opening cutscene (GAME_SUBSTATE 0x600A == 7), loc_06fe vectors here every
 * frame, and loc_0a76 vectors on the cutscene step index INTRO_STEP (0x6385).
 *
 * Six jobs, as for loc_06fe / loc_08b2, plus an explicit cycle-collapse teeth:
 *
 *   1. EQUAL -- the idiomatic optimized loc_0a76 (optimized/loc_0a76.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      routes through dispatchGameState's override consult (nmi.js), inert when the
 *      map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_0a76
 *      does NOT run in attract: it needs an in-game cutscene (GAME_STATE==3,
 *      GAME_SUBSTATE==7), so a plain boot never reaches it. Driven with a coin+start
 *      inputTape it first dispatches at frame 36 (INTRO_STEP 0) and then every frame
 *      of the cutscene, walking INTRO_STEP 0,1,2,3,4,5,6,7 -- ALL EIGHT selector
 *      values -- across 769 dispatches over frames 36..804. An 810-frame window
 *      covers the whole cutscene.
 *
 *   3. TEETH -- a deliberately-broken twin (the first store on loc_0a76's step-0
 *      path, a cutscene VRAM cell 0x744D, lands the wrong value) must be CAUGHT:
 *      NOT-EQUAL, naming 0x744D, whole-machine and unit.
 *
 *   4. BRANCH COVERAGE -- loc_0a76 has NO internal data-dependent branch: it is
 *      straight-line (read 0x6385 -> A, push table base 0x0A7A, call sub_0028). The
 *      only thing a selector changes is A (which table entry the CALLEE jp (hl)'s
 *      to). So the "branches" are the 8 table indices, and full coverage is a sweep:
 *      for every index 0..7, synthesise the entry (poke 0x6385), stub sub_0028
 *      IDENTICALLY on both clones, and prove optimized == translated (RAM+regs+pc)
 *      AND that the callee received A==index. The driven EQUAL/whole test above
 *      already exercises the REAL callee for all 8 selectors; this localises each.
 *
 *   5. CYCLE-COLLAPSE TEETH -- loc_0a76 is ATOMIC (it runs inside the vblank NMI,
 *      which enters with the mask cleared, and unlike loc_06fe its m.call(0x0028)
 *      dispatches only to SHORT cutscene-step arms, never the interruptible gameplay
 *      handler), so its two prologue charges (ld a = 13, rst = 11) collapse to a
 *      single m.step of 24. That collapse is proven with teeth two ways: (a) the
 *      isolated own-cycle total (sub_0028 stubbed) is 24 for BOTH oracle and
 *      optimized across all 8 selectors; (b) a WRONG total (23) is CAUGHT whole-
 *      machine -- so the collapsed 24 is load-bearing, not free. This is the SAME
 *      idiom + decision as loc_08b2, NOT loc_06fe (kept per-instruction because it
 *      routes to gameplay). Stripping the 24 diverges at stack 0x6BFC (frame 36),
 *      a wrong 23 at stack 0x6BF4 (frame 38) -- both NMI-pushed PCs in diffed stack
 *      RAM, exactly the entry_0611 / loc_08b2 downstream-landing mechanism.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). The engine
 * that proves equivalence lives in core/equivalence.js; games/dkong/optimized/
 * harness.js is a thin wrapper that bakes in a `makeMachine` factory built on `{}`
 * assets -- which drives NO input, so it can never reach a credited game and never
 * dispatches loc_0a76. This test therefore calls the SAME core unitEquivalence /
 * wholeMachineEquivalence directly (they ARE the standard engine harness.js wraps),
 * passing a makeMachine factory that adds an identical coin+start inputTape to BOTH
 * the baseline and optimized machines (the factory is the wrapper's only job).
 * Nothing about the capture / clone / diff / invocation-counter logic is
 * re-implemented, and the snapshot override is still installed at CONSTRUCTION (the
 * factory passes it into `new Machine`), which is what reaches loc_0a76 however it
 * is entered. Any poke/tape is applied identically to both sides (the factory is
 * shared). Same pattern as equivalence-06fe.test.js.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a76 as translated_0a76 } from "../../translated/state0.js";
import { loc_0a76 as optimized_0a76 } from "../loc_0a76.js";
import { INTRO_STEP } from "../ram.js";
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

const TARGET = 0x0a76;
const FRAMES = 810; // covers INTRO_STEP 0..7, 769 dispatches over frames 36..804
const MAX_FRAMES = 60; // loc_0a76 first dispatches at frame 36 (INTRO_STEP 0)

// A coin+start tape (identical to loc_06fe's): coin on IN2 bit7 at frame 10, start1
// on IN2 bit2 at frame 30. This credits and starts a game so GAME_STATE reaches 3
// and its opening cutscene (GAME_SUBSTATE 7) begins dispatching loc_0a76 at frame 36.
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

// The first store on loc_0a76's step-0 path: a cutscene VRAM cell (0x744D), inside
// the compared dump (video RAM 0x7400-0x77FF). INTRO_STEP 0 dispatches exactly once
// (frame 36), and the later steps do not rewrite this cell, so a single corruption
// persists as a clean state diff (control flow untouched, unlike the stack writes).
const BROKEN_ADDR = 0x744d;

/**
 * Deliberately-broken twin: behaviourally optimized_0a76 EXCEPT the first store to
 * 0x744D lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly that
 * one write lets the dispatch and every subroutine it calls run verbatim (no wrong
 * target, no early stop) -- the representative "wrong value to an address on the
 * routine's path" bug the gate must catch.
 */
function broken_0a76(m) {
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
    return optimized_0a76(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// A WRONG-total twin: identical to optimized_0a76 but charges 23 for the collapsed
// prologue instead of 24. Used to prove the collapsed total has teeth (a cheaper NMI
// shifts where a later frame's NMI lands in the diffed stack RAM).
function wrongTotal_0a76(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(INTRO_STEP);
  m.push16(0x0a7a);
  m.step(0x0028, 23); // WRONG: should be 24
  m.call(0x0028, "0x0A7A (0x6385 sequence)");
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0a76 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0a76]]));

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
      `${r.invocations.get(TARGET)}x (cutscene INTRO_STEP 0..7 via coin+start)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0a76 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0a76, optimized_0a76, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first entry: INTRO_STEP 0, frame 36)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong store on the dispatch path is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, broken_0a76]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong store on the dispatch path is CAUGHT and names 0x744D", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0a76, broken_0a76, { maxFrames: MAX_FRAMES });

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

// Capture the pristine machine state at loc_0a76's FIRST dispatch (INTRO_STEP 0,
// frame 36), via the same construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0a76(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_0a76 never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

test("BRANCH COVERAGE: every table index 0..7 dispatches EQUAL with the correct selector", () => {
  const entry = captureEntry();

  // loc_0a76 is straight-line; the only per-selector variable is A (the cutscene
  // step index handed to the callee). Sweep ALL 8 table indices, proving optimized
  // == translated (RAM+regs+pc) and that the callee received A==index. sub_0028 is
  // stubbed IDENTICALLY on both clones so the sweep isolates loc_0a76's own contract
  // (read the selector, push 0x0A7A, hand the callee A) without depending on a
  // coherent downstream cutscene state; the REAL callee is exercised for all 8
  // selectors by the EQUAL/whole test above.
  for (let idx = 0; idx <= 7; idx++) {
    const a = entry.clone();
    const b = entry.clone();
    a.mem.write8(0x6385, idx);
    b.mem.write8(0x6385, idx);

    let sawA_a = -1;
    let sawA_b = -1;
    a.routines.set(0x0028, (mm) => { sawA_a = mm.regs.a; });
    b.routines.set(0x0028, (mm) => { sawA_b = mm.regs.a; });

    translated_0a76(a);
    optimized_0a76(b);

    const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.regs, b.regs);
    assert.equal(ram, null, ram ? `idx ${idx}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
    assert.equal(regs, null, regs ? `idx ${idx}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
    assert.equal(a.pc, b.pc, `idx ${idx}: pc mismatch`);
    assert.equal(sawA_a, idx, `idx ${idx}: translated handed callee A=${sawA_a}`);
    assert.equal(sawA_b, idx, `idx ${idx}: optimized handed callee A=${sawA_b}`);
  }
  console.log("  BRANCH COVERAGE: all 8 table indices (0..7) EQUAL, callee received the correct selector each time");
});

// -- CYCLE-COLLAPSE TEETH -----------------------------------------------------

test("CYCLE (unit): the collapsed prologue charges 24 t on BOTH oracle and optimized, every selector", () => {
  const entry = captureEntry();

  // Isolate loc_0a76's OWN cycle contribution by stubbing sub_0028 to charge
  // nothing; the delta in m.cycles is then exactly the prologue total. The oracle
  // charges 13 (ld) + 11 (rst) = 24 per instruction; the optimized charges the same
  // 24 as one m.step. Both must equal 24 for every selector -- the collapse is a
  // redistribution of the SAME total, not a cheaper one.
  for (let idx = 0; idx <= 7; idx++) {
    const measure = (fn) => {
      const c = entry.clone();
      c.mem.write8(0x6385, idx);
      c.routines.set(0x0028, () => {}); // no-op, charges nothing
      const before = c.cycles;
      fn(c);
      return c.cycles - before;
    };
    assert.equal(measure(translated_0a76), 24, `idx ${idx}: oracle own-cycles != 24`);
    assert.equal(measure(optimized_0a76), 24, `idx ${idx}: optimized own-cycles != 24`);
  }
  console.log("  CYCLE/unit: prologue total = 24 t on oracle and optimized for all 8 selectors (distribution collapsed, total preserved)");
});

test("CYCLE (whole-machine): a WRONG collapsed total (23) is CAUGHT and NOT-EQUAL", () => {
  // The collapsed 24 is load-bearing: this frame's NMI cost sets the main-loop spin
  // count (PRNG entropy) and where a LATER frame's NMI lands in diffed stack RAM.
  // Charging 23 instead of 24 must therefore diverge -- proving the collapsed total
  // is not a free choice the gate ignores.
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, wrongTotal_0a76]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong collapsed total slipped through — the total has no teeth");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  CYCLE/whole: wrong total 23 caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});
