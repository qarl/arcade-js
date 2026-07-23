// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0a1b (a board-setup step: index 4 of the
 * GAME_STATE==3 sub-state jump table at ROM 0x0702, dispatched by loc_06fe /
 * dispatchGameState inside the vblank NMI). It clears the palette bank, queues two
 * draw tasks, runs the shared VRAM fragment sub_09ee, and advances GAME_SUBSTATE
 * (0x600A) to 5. See optimized/sub_0a1b.js for the full behaviour docstring.
 *
 * Four jobs, plus the single-branch cycle assertion:
 *
 *   1. EQUAL -- the idiomatic optimized sub_0a1b (optimized/sub_0a1b.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_0a1b
 *      is index 4 of the 0x0702 table, which is on the TWO-PLAYER board-setup chain
 *      (loc_0986 -> 0x600A=3 sub_09fe -> 4 THIS -> 5 sub_0a37); the single-player
 *      25m path uses its twin sub_09d6 (index 2) and NEVER hits index 4. So it does
 *      not dispatch in attract (0 over 3000 attract frames) NOR in a one-player game
 *      (0 over 4000 coin+start1 frames). Driven with a TWO-coin + start2 inputTape
 *      it dispatches EXACTLY ONCE, at frame 1662 (P2's first board setup). A 1700-
 *      frame window covers it.
 *
 *   3. TEETH -- a deliberately-broken twin (the first VRAM cell drawn by sub_09ee on
 *      sub_0a1b's path, 0x74E0, lands the wrong value) must be CAUGHT: NOT-EQUAL,
 *      naming 0x74E0 (inside the compared dump's video RAM 0x7400-0x77FF). This cell
 *      is cosmetic, so the broken run keeps running healthily -- the divergence, not
 *      a crash, is what the gate reports.
 *
 *   4. SINGLE BRANCH + CYCLE TEETH -- sub_0a1b is STRAIGHT-LINE: it has exactly one
 *      path, no data-dependent branch of its own (any variation, e.g. sub_309f
 *      dropping a task on a full ring, lives inside the m.call'd callee, identical on
 *      both sides). That one path is proven EQUAL above; because its cycles are
 *      COLLAPSED to one charge per call segment, this test ALSO asserts the routine's
 *      total T-state cost equals the oracle's -- a wrong collapsed total would shift
 *      the main-loop spin count (README §2) and is the failure the cycle teeth guard.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (as in equivalence-06fe.test.js). harness.js
 * bakes in a `{}`-assets factory that drives NO input, so it can never credit a
 * two-player game and never dispatches sub_0a1b. This test calls the SAME core
 * unitEquivalence / wholeMachineEquivalence directly, with a makeMachine factory that
 * attaches an identical two-player coin+start tape to BOTH baseline and optimized
 * machines (the factory is the wrapper's only job -- capture/clone/diff/invocation
 * counting are the standard engine). Any input is thus applied identically to both sides.
 *
 * CYCLE FINDING: sub_0a1b is ATOMIC (dispatched inside the NMI, callees are leaf
 * routines that call nothing interruptible), so its cycle distribution is collapsed
 * to one charge per call segment (57/27/17/tail 30 = 131, the oracle's own total)
 * and stays EQUAL whole-machine. See optimized/sub_0a1b.js for the decision.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0a1b as translated_0a1b } from "../../translated/state0.js";
import { sub_0a1b as optimized_0a1b } from "../sub_0a1b.js";
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

const TARGET = 0x0a1b;
const FRAMES = 1700;     // sub_0a1b dispatches once, at frame 1662 (P2's board setup)
const MAX_FRAMES = 1700; // unit gate must run far enough to reach that first entry

// A TWO-PLAYER coin+start tape: two coins on IN2 bit7 (frames 10, 20) then start2
// on IN2 bit3 (frame 40). Two credits + a 2-player start sends the setup down the
// P2 chain (loc_0986 sees 0x600E != 0), which is the only path that reaches index 4.
const TWO_PLAYER_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin 1 (IN2 bit7)
  { port: 0x7d00, bits: 0x80, frame: 20, dur: 6 }, // coin 2 (IN2 bit7)
  { port: 0x7d00, bits: 0x08, frame: 40, dur: 6 }, // start2 (IN2 bit3)
];

// The makeMachine factory the core engine drives (same shape as harness.js's
// dkMachineFactory), extended to attach the two-player tape. Called with no argument
// for the baseline and with the wrapped override map for the optimized side -- both
// get the SAME tape, so any input is applied identically.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = TWO_PLAYER_TAPE.map((t) => ({ ...t }));
  return m;
}

// The first store by sub_09ee (called on sub_0a1b's path): VRAM cell 0x74E0 <- 0x02,
// inside the compared dump (video RAM 0x7400-0x77FF). A cosmetic cell -- corrupting
// it does not change control flow, so the broken run stays healthy and the gate
// reports the divergence rather than a crash.
const BROKEN_ADDR = 0x74e0;

/**
 * Deliberately-broken twin: behaviourally optimized_0a1b EXCEPT the first store to
 * 0x74E0 lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly that
 * one write lets the rest of the routine and every subroutine it calls run verbatim --
 * the representative "wrong value to an address on the routine's path" bug the gate
 * must catch.
 */
function broken_0a1b(m) {
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
    return optimized_0a1b(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0a1b matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0a1b]]));

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
      `${r.invocations.get(TARGET)}x (two-player board-setup index 4 at frame 1662)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0a1b matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0a1b, optimized_0a1b, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong store on the routine's path is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0a1b]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong store on the routine's path is CAUGHT and names 0x74E0", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0a1b, broken_0a1b, { maxFrames: MAX_FRAMES });

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

// -- SINGLE BRANCH + CYCLE TEETH ----------------------------------------------

// Capture the pristine machine state at sub_0a1b's dispatch (frame 1662), via the
// same construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0a1b(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`sub_0a1b never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

test("SINGLE BRANCH + CYCLE: the one straight-line path is EQUAL and its collapsed T-state total matches", () => {
  const entry = captureEntry();

  // sub_0a1b has NO data-dependent branch -- one path. Prove it EQUAL (RAM+regs+pc)
  // AND that the routine's TOTAL cycle cost matches the oracle. The cycles are
  // collapsed per call segment, so a wrong total is the failure mode the whole-
  // machine spin count would surface downstream; pinning it here gives the single
  // (collapsed) branch explicit, local cycle teeth.
  const a = entry.clone();
  const b = entry.clone();
  const cyc0a = a.cycles;
  const cyc0b = b.cycles;
  translated_0a1b(a);
  optimized_0a1b(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, "pc mismatch");

  const cyclesTranslated = a.cycles - cyc0a;
  const cyclesOptimized = b.cycles - cyc0b;
  assert.equal(
    cyclesOptimized,
    cyclesTranslated,
    `collapsed cycle total ${cyclesOptimized} != oracle ${cyclesTranslated}`,
  );
  console.log(
    `  SINGLE BRANCH: straight-line path EQUAL (RAM+regs+pc); cycle total ${cyclesOptimized} t == oracle ${cyclesTranslated} t`,
  );
});
