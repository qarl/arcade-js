// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_04f1 (the colour-write + blink-OFF tail of the
 * intro/colour-cycle driver, ROM 0x04F1). It seeds a descending 3-cell colour-RAM
 * fill (sub_0514, seed 0xef, stride DE=0x20 from loc_0486) at 0x7583, then falls
 * straight into loc_04f9 which clears the blink bit7 of 0x6901/0x6905 and jp's back
 * to loc_04ac. Its ONE caller is loc_04be (`jp nc,0x04f1`), reached via loc_0486 <-
 * entry_03fb <- loc_197a — the per-frame in-game colour cascade — so it needs a
 * credited game AND loc_04be's branch B (BOARD 0x6227==4, frame-counter bit6 set,
 * MARIO_X >= 0x80).
 *
 * loc_04f1 is COLD/latent and even colder than its parent loc_04be: a driven board-1
 * game never sees BOARD==4, and even with BOARD=4 poked loc_04be only ever takes its
 * branch A (frame-counter bit6 clear here) so it never routes to 0x04f1. To exercise
 * it, three identical-both-sides pokes from frame 1040 force loc_04be's branch B:
 *   0x6227 = 4    (BOARD -- selects loc_0486's (0x6227)==4 arm -> loc_04be)
 *   0x6390 = 0x50 (frame counter; loc_0426 inc's it to 0x51, bit6 still SET, < 0x80)
 *   0x6203 = 0xc0 (MARIO_X >= 0x80 -> loc_04be's `cp 0x80 / jp nc,0x04f1`)
 * loc_04f1 then dispatches every frame from ~f1041 (261x in a 1300-frame window), and
 * the run stays healthy (reaches the vblank spin every frame). The pokes are
 * deterministic (oracle vs oracle-with-translated-override is byte-identical over
 * 1300 frames), so the whole-machine gate is meaningful, not vacuous.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) — idiomatic optimized loc_04f1 reads EQUAL against its
 *      translated oracle every frame, override firing 261x (asserted >= 1).
 *
 *   2. EQUAL (unit) — translated vs optimized leave identical RAM + all registers
 *      (incl. F, A, SP) + pc from the captured first-entry state (frame ~1041).
 *
 *   3. PATH (unit) — loc_04f1 is a SINGLE linear path (no internal data-dependent
 *      branch: load A=0xef, HL=0x7583, call sub_0514, fall into loc_04f9). That one
 *      path is proven EQUAL on a clone of the captured entry, asserting RAM + regs +
 *      pc AND the path's CYCLE TOTAL (kept per-instruction, so a wrong charge has
 *      explicit teeth), plus a colour-RAM / blink-bit SIGNATURE that proves the
 *      intended path actually ran: 0x7583=0xef (sub_0514's fill) and 0x6905 bit7
 *      CLEAR (loc_04f9, blink OFF).
 *
 *   4+5. TEETH (whole + unit) — a deliberately-broken twin whose first colour-RAM
 *      store (0x7583, sub_0514's first cell, on the routine's only path) lands the
 *      wrong value must be CAUGHT: NOT-EQUAL, naming 0x7583.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Same reason as
 * loc_04be / entry_03fb / loc_197a: harness.js bakes a makeMachine on `{}` assets
 * that drives NO input, so it never credits a game and never dispatches the loc_197a
 * -> ... -> loc_04be -> loc_04f1 cascade. This test calls the SAME core
 * unitEquivalence / wholeMachineEquivalence directly, with a makeMachine factory that
 * attaches an identical coin+start inputTape AND the identical branch-B pokes to BOTH
 * sides (the factory is shared, so every input/poke is applied identically to
 * baseline and optimized). A Machine built with no overrides runs the pure oracle.
 *
 * CYCLE FINDING this routine adds: loc_04f1 is NON-ATOMIC and stays PER-INSTRUCTION,
 * byte-identical to the oracle. It is reached only from loc_04be, which sits inside
 * the interruptible loc_197a -> entry_03fb per-frame cascade (NMI mask ENABLED), and
 * loc_04f1 falls into further interruptible colour-tree routines (sub_0514 / loc_04f9
 * / loc_04ac), so the vblank NMI can land inside it — its internal cycle distribution
 * is observable. Per the ATOMICITY-IS-PER-CALL-PATH rule a leaf reached from an
 * interruptible caller is not atomic, so NO collapse (same decision as loc_04be /
 * loc_04e1 / loc_04ac). The path's cycle TOTAL is asserted equal on clones anyway.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04f1 as translated_04f1 } from "../../translated/state0.js";
import { loc_04f1 as optimized_04f1 } from "../loc_04f1.js";
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

const TARGET = 0x04f1;
const FRAMES = 1300;    // loc_04f1 dispatches every frame from ~f1041 (261x) once branch B is forced
const MAX_FRAMES = 1080; // loc_04f1 first dispatches at frame ~1041

// The first colour-RAM store on the routine's only path — sub_0514's first cell
// (0x7583, value 0xef). It sits in the compared video-RAM dump (0x7400-0x77FF) and
// is write-only on this path (nothing reads it back before the routine returns), so
// a corruption there is a clean caught diff.
const BROKEN_ADDR = 0x7583;

// A coin+start tape (identical to the loc_04be sibling's): coin on IN2 bit7 at frame
// 10, start1 on IN2 bit2 at frame 30 — credits and starts a game so the loc_197a ->
// entry_03fb -> loc_0486 cascade runs.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// loc_04f1 is reached only via loc_04be's branch B; three identical-both-sides pokes
// held from frame 1040 force it: BOARD=4 (into loc_04be), frame-counter bit6 set
// (loc_0426 inc's 0x50->0x51, still bit6 & < 0x80), MARIO_X >= 0x80.
const BRANCH_B_POKES = [
  { addr: 0x6227, val: 0x04, frame: 1040, dur: null }, // BOARD -> loc_04be
  { addr: 0x6390, val: 0x50, frame: 1040, dur: null }, // frame counter, bit6 set after inc
  { addr: 0x6203, val: 0xc0, frame: 1040, dur: null }, // MARIO_X >= 0x80 -> jp nc,0x04f1
];

// The makeMachine factory the core engine drives, extended to attach BOTH the
// coin+start inputTape and the branch-B pokes. Called with no argument for the
// baseline (pure oracle) and with the wrapped override map for the optimized side —
// both get the SAME tape and the SAME pokes.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = BRANCH_B_POKES.map((p) => ({ ...p }));
  return m;
}

/**
 * Deliberately-broken twin: behaviourally optimized_04f1 EXCEPT the first store to
 * 0x7583 lands a wrong value (the correct byte XOR 0xFF, guaranteed to differ).
 * Intercepting exactly that one write lets the rest of the routine and every
 * subroutine it calls run verbatim — the representative "wrong value to an address
 * on the routine's path" bug the gate must catch.
 */
function broken_04f1(m) {
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
    return optimized_04f1(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_04f1 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_04f1]]));

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
      `${r.invocations.get(TARGET)}x (per-frame via loc_04be branch B, ~f1041.., pokes forced)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_04f1 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_04f1, optimized_04f1, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first entry: frame ~1041)");
});

// -- PATH COVERAGE (single linear path) ---------------------------------------

// Capture the pristine machine at loc_04f1's FIRST dispatch (frame ~1041), via the
// same construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_04f1(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_04f1 never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

test("PATH (unit): the single colour-fill + blink-OFF path EQUAL (RAM+regs+pc+cycles)", () => {
  const entry = captureEntry();
  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  const cA0 = a.cycles, cB0 = b.cycles;
  translated_04f1(a);
  optimized_04f1(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.ok(a.pc === b.pc, "pc must match");
  assert.equal(dA, dB, `cycle-total mismatch (translated ${dA} vs optimized ${dB})`);
  // Signature: sub_0514's fill wrote 0x7583=0xef, and loc_04f9 cleared the blink bit7.
  assert.equal(a.mem.read8(0x7583), 0xef, "path must run sub_0514's fill (0x7583=0xef)");
  assert.equal((a.mem.read8(0x6905) >> 7) & 1, 0, "path must clear the blink bit (loc_04f9, OFF)");
  console.log(`  PATH: colour-fill + blink-OFF EQUAL, 0x7583=0xef, blink OFF, cycles match (${dA} t)`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong colour-RAM store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, broken_04f1]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong colour-RAM store is CAUGHT and names 0x7583", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_04f1, broken_04f1, { maxFrames: MAX_FRAMES });

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
