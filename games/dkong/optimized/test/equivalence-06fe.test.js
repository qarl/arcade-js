// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_06fe (the in-game GAME_STATE==3 SUB-STATE
 * dispatcher: `ld a,(0x600a) / rst 0x28` through the 29-entry inline jump table at
 * ROM 0x0702). Reached from dispatchGameState (the NMI's rst 0x28 table at 0x00CA,
 * entry 3) once per frame while a credited game runs.
 *
 * Four jobs, as for entry_0611, plus an exhaustive branch sweep:
 *
 *   1. EQUAL -- the idiomatic optimized loc_06fe (optimized/loc_06fe.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_06fe
 *      does NOT run in attract: it needs GAME_STATE==3, so a plain boot never
 *      reaches it (0 dispatches over 6000 attract frames). Driven with a coin+start
 *      inputTape it first dispatches at frame 32 and then every frame, walking the
 *      state-3 sub-state sequence 0,1,5,6,7 (intro) -> 8 (how-high) -> 0xa (board
 *      setup) -> 0xb,0xc -> 0xd (gameplay, ~frame 1231). A 1300-frame window covers
 *      substates 0,1,5,6,7,8,a,b,c,d -- ten distinct dispatch payloads, all EQUAL.
 *
 *   3. TEETH -- a deliberately-broken twin (the first store on loc_06fe's path, the
 *      substate-0 screen fill's first VRAM cell 0x7400, lands the wrong value) must
 *      be CAUGHT: NOT-EQUAL, naming 0x7400.
 *
 *   4. BRANCH COVERAGE -- loc_06fe has NO internal data-dependent branch: it is
 *      straight-line (read 0x600A -> A, push table base 0x0702, call sub_0028). The
 *      only thing a payload changes is A (which table entry the CALLEE jp (hl)'s
 *      to). So the "branches" are the 29 table indices, and full coverage is an
 *      exhaustive payload sweep: for every index 0..28, synthesise the entry (poke
 *      0x600A), stub sub_0028 identically on both clones, and prove optimized ==
 *      translated (RAM+regs+pc) AND that the callee received A==index. This reaches
 *      the payloads the driven run never hits (death=0xe, board-advance=0x16) and
 *      the six null table slots (idx 9, 24-28), whose 0x0000 entries are a callee
 *      concern -- sub_0028 would jp (hl) to 0x0000 -> NotImplemented, exempt for
 *      loc_06fe; the sweep still proves loc_06fe hands them the correct A.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). The engine
 * that proves equivalence lives in core/equivalence.js; games/dkong/optimized/
 * harness.js is a thin wrapper that bakes in a `makeMachine` factory built on `{}`
 * assets -- which drives NO input, so it can never reach a credited game and never
 * dispatches loc_06fe. This test therefore calls the SAME core unitEquivalence /
 * wholeMachineEquivalence directly, passing a makeMachine factory that adds an
 * identical coin+start inputTape to BOTH the baseline and optimized machines (the
 * factory is the wrapper's only job). Nothing about the capture / clone / diff /
 * invocation-counter logic is re-implemented -- it is the standard engine, reached
 * the way harness.js reaches it, with the input the routine requires. Any poke/tape
 * is applied identically to both sides (the factory is shared).
 *
 * CYCLE FINDING this routine adds: loc_06fe is NON-ATOMIC (its m.call(0x0028)
 * dispatches into interruptible in-game handlers), so it stays PER-INSTRUCTION --
 * byte-identical to the oracle. See optimized/loc_06fe.js for the full decision
 * (incl. the honest note that a collapse to one m.step also happened to stay EQUAL,
 * but is not taken for a non-atomic routine whose rst push straddles its charges).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_06fe as translated_06fe } from "../../translated/state0.js";
import { loc_06fe as optimized_06fe } from "../loc_06fe.js";
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

const TARGET = 0x06fe;
const FRAMES = 1300; // reaches substates 0,1,5,6,7,8,a,b,c,d (gameplay ~f1231)
const MAX_FRAMES = 60; // loc_06fe first dispatches at frame 32

// A coin+start tape (identical to entry_06b8's driven supplement): coin on IN2
// bit7 at frame 10, start1 on IN2 bit2 at frame 30. This credits and starts a
// game so GAME_STATE reaches 3 and loc_06fe begins dispatching at frame 32.
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

// The first store on loc_06fe's path: the very first VRAM cell of the substate-0
// screen fill (0x7400 <- 0x10), inside the compared dump (video RAM 0x7400-0x77FF).
// The unit gate captures the FIRST loc_06fe entry, which is substate 0 (frame 32),
// so this cell is written on the captured path -- the whole-machine gate catches it
// at frame 32 too.
const BROKEN_ADDR = 0x7400;

/**
 * Deliberately-broken twin: behaviourally optimized_06fe EXCEPT the first store to
 * 0x7400 lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly that
 * one write lets the dispatch and every subroutine it calls run verbatim (no wrong
 * target, no early stop) -- the representative "wrong value to an address on the
 * routine's path" bug the gate must catch.
 */
function broken_06fe(m) {
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
    return optimized_06fe(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_06fe matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_06fe]]));

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
      `${r.invocations.get(TARGET)}x (in-game substates 0,1,5,6,7,8,a,b,c,d via coin+start)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_06fe matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_06fe, optimized_06fe, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first entry: substate 0, frame 32)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong store on the dispatch path is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, broken_06fe]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong store on the dispatch path is CAUGHT and names 0x7400", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_06fe, broken_06fe, { maxFrames: MAX_FRAMES });

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

// Capture the pristine machine state at loc_06fe's FIRST dispatch (substate 0,
// frame 32), via the same construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_06fe(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_06fe never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

test("BRANCH COVERAGE: every table index 0..28 dispatches EQUAL with the correct selector", () => {
  const entry = captureEntry();

  // loc_06fe is straight-line; the only per-payload variable is A (the sub-state
  // index handed to the callee). Sweep ALL 29 table indices -- including the ones
  // the driven run never reaches (death 0xe, board-advance 0x16) and the six null
  // slots (9, 24-28) -- proving optimized == translated (RAM+regs+pc) and that the
  // callee received A==index. sub_0028 is stubbed IDENTICALLY on both clones so the
  // sweep isolates loc_06fe's own contract (read the selector, push 0x0702, hand
  // the callee A) without depending on a coherent downstream game state; the REAL
  // callee is exercised for substates 0-0xd by the EQUAL/whole test above.
  for (let idx = 0; idx <= 28; idx++) {
    const a = entry.clone();
    const b = entry.clone();
    a.mem.write8(0x600a, idx);
    b.mem.write8(0x600a, idx);

    let sawA_a = -1;
    let sawA_b = -1;
    a.routines.set(0x0028, (mm) => { sawA_a = mm.regs.a; });
    b.routines.set(0x0028, (mm) => { sawA_b = mm.regs.a; });

    translated_06fe(a);
    optimized_06fe(b);

    const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.regs, b.regs);
    assert.equal(ram, null, ram ? `idx ${idx}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
    assert.equal(regs, null, regs ? `idx ${idx}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
    assert.equal(a.pc, b.pc, `idx ${idx}: pc mismatch`);
    assert.equal(sawA_a, idx, `idx ${idx}: translated handed callee A=${sawA_a}`);
    assert.equal(sawA_b, idx, `idx ${idx}: optimized handed callee A=${sawA_b}`);
  }
  console.log("  BRANCH COVERAGE: all 29 table indices (0..28) EQUAL, callee received the correct selector each time");
});
