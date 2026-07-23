// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_04a3 (a tail helper in the ATTRACT / intro
 * colour-cycle tree: `ld hl,0x75c4 / call 0x0514 / ld a,(0x6905)`, which writes one
 * colour-RAM column via sub_0514 and then loads the blink-state byte before falling
 * into loc_04ac). Its live caller path is loc_0486 <- loc_0413 <- entry_03fb <-
 * loc_197a, the per-frame in-game cascade, so -- like its parent entry_03fb -- it
 * needs a credited game to run and is driven with a coin+start inputTape.
 *
 * Jobs:
 *
 *   1. EQUAL (whole-machine) -- idiomatic optimized loc_04a3 (optimized/loc_04a3.js)
 *      reads EQUAL against its translated oracle every frame. loc_04a3 is reached
 *      each frame of board 1 through the colour cascade (loc_0486 routes into it on
 *      almost every path), first around frame ~1033. The override must actually fire
 *      (asserted) or EQUAL would be vacuous.
 *
 *   2. EQUAL (unit) -- translated vs optimized leave identical RAM + registers
 *      (incl. F) + pc from the captured entry state (first m.call of 0x04a3).
 *
 *   3. PATH + CYCLES (unit) -- loc_04a3 has NO data-dependent branch of its own
 *      (three straight-line instructions that tail-call loc_04ac); its single path
 *      is proven EQUAL incl. the CYCLE TOTAL on clones of the captured entry (so a
 *      wrong m.step in loc_04a3 has explicit teeth even though the driven run reaches
 *      it). The same path is re-proven with the incoming frame counter C poked to
 *      exercise EACH downstream loc_04ac exit (bit6 clear -> ret z; bit6 set & C&7 !=0
 *      -> ret nz; bit6 set & C&7 ==0 -> blink-flip + ret), identical poke both sides,
 *      to give the tail-call wiring (C passed through, 0x04ac reached) real teeth.
 *
 *   4+5. TEETH (whole + unit) -- a deliberately-broken twin whose first colour-RAM
 *      store (0x75C4, written on the path via sub_0514) lands the wrong value must be
 *      CAUGHT: NOT-EQUAL, naming 0x75C4.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Same reason as
 * entry_03fb / loc_197a: harness.js bakes a makeMachine on `{}` assets that drives NO
 * input, so it never credits a game and never dispatches loc_197a -> entry_03fb ->
 * loc_04a3. This test calls the SAME core unitEquivalence / wholeMachineEquivalence
 * directly, with a makeMachine factory that attaches an identical coin+start inputTape
 * to BOTH sides (the factory is shared, so any input/poke is applied identically to
 * baseline and optimized). A Machine built with no overrides runs the pure oracle.
 *
 * CYCLE FINDING. loc_04a3 is NON-ATOMIC and stays PER-INSTRUCTION, byte-identical to
 * the oracle. Its live caller loc_197a is the interruptible per-frame cascade (NMI
 * mask ENABLED), and loc_04a3 spans a call into sub_0514, so the vblank NMI can land
 * inside it -- its internal cycle distribution is observable. Per the ATOMICITY-IS-
 * PER-CALL-PATH rule a leaf reached from an interruptible caller is not atomic, so NO
 * collapse (same decision as entry_03fb / loc_0413 / loc_197a).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04a3 as translated_04a3 } from "../../translated/state0.js";
import { loc_04a3 as optimized_04a3 } from "../loc_04a3.js";
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

const TARGET = 0x04a3;
const FRAMES = 1300; // loc_04a3 runs per-frame via the colour cascade, ~f1033..f1230
const MAX_FRAMES = 1080; // loc_04a3 first reached at frame ~1033

// The incoming frame counter C (set by loc_0486) selects loc_04ac's exit, downstream
// of loc_04a3's tail-call. loc_04a3 passes it through untouched.
const CREG = "c";

// The first colour-RAM store on loc_04a3's path (HL=0x75c4, then sub_0514's first
// `ld (hl),a`). It sits in the compared video-RAM dump (0x7400-0x77FF) and is
// write-only on this path (nothing reads it back before the routine returns), so a
// corruption there is a clean caught diff.
const BROKEN_ADDR = 0x75c4;

// A coin+start tape (identical to entry_03fb / loc_197a): coin on IN2 bit7 at frame
// 10, start1 on IN2 bit2 at frame 30. Credits and starts a game so the colour cascade
// (loc_197a -> entry_03fb -> ... -> loc_04a3) runs.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The makeMachine factory the core engine drives, extended to attach the coin+start
// inputTape. Called with no argument for the baseline (pure oracle) and with the
// wrapped override map for the optimized side -- both get the SAME tape.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
}

/**
 * Deliberately-broken twin: behaviourally optimized_04a3 EXCEPT the first store to
 * 0x75C4 lands a wrong value (the correct byte XOR 0xFF, guaranteed to differ).
 * Intercepting exactly that one write lets the rest of the routine and every
 * subroutine it calls run verbatim -- the representative "wrong value to an address
 * on the routine's path" bug the gate must catch.
 */
function broken_04a3(m) {
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
    return optimized_04a3(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_04a3 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_04a3]]));

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
      `${r.invocations.get(TARGET)}x (per-frame via the colour cascade)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_04a3 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_04a3, optimized_04a3, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first m.call, frame ~1033)");
});

// -- PATH + CYCLES ------------------------------------------------------------

// Capture the pristine machine at loc_04a3's FIRST entry (via the same construction-
// time snapshot the core unit gate uses; loc_04a3 is reached only by m.call).
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_04a3(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_04a3 never entered within ${MAX_FRAMES} frames`);
  return entry;
}

// Run oracle vs optimized on two clones of `entry`, optionally poking the frame
// counter C to `cval` (identical on both sides), and diff RAM + regs + pc + cycle
// total. `cval === null` leaves the captured C untouched (the natural path).
function diffPath(entry, cval) {
  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  if (cval !== null) {
    for (const c of [a, b]) c.regs[CREG] = cval;
  }
  const cA0 = a.cycles, cB0 = b.cycles;
  translated_04a3(a);
  optimized_04a3(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return { ram, regs, pcEq: a.pc === b.pc, dA, dB };
}

test("PATH (unit): loc_04a3's single straight-line path EQUAL incl. cycle total", () => {
  const r = diffPath(captureEntry(), null);
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, "pc must match");
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
  console.log(`  PATH: straight-line EQUAL, cycles match (${r.dA} t incl. sub_0514 + loc_04ac tail)`);
});

test("PATH (unit): each downstream loc_04ac exit (poked C) EQUAL through the tail-call", () => {
  const entry = captureEntry();
  // bit6=0 -> loc_04ac `ret z` (EXIT-1); bit6=1,&7!=0 -> `ret nz` (EXIT-2);
  // bit6=1,&7==0 -> blink-flip + `ret` (EXIT-3). loc_04a3 passes C through untouched.
  for (const [label, cval] of [["ret z", 0x00], ["ret nz", 0x43], ["flip+ret", 0x40]]) {
    const r = diffPath(entry, cval);
    assert.equal(r.ram, null, r.ram ? `[C=0x${cval.toString(16)} ${label}] RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
    assert.equal(r.regs, null, r.regs ? `[C=0x${cval.toString(16)} ${label}] reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
    assert.ok(r.pcEq, `[C=0x${cval.toString(16)} ${label}] pc must match`);
    assert.equal(r.dA, r.dB, `[C=0x${cval.toString(16)} ${label}] cycle-total mismatch (${r.dA} vs ${r.dB})`);
    console.log(`  PATH/C=0x${cval.toString(16)} (${label}): EQUAL, cycles match (${r.dA} t)`);
  }
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong colour-RAM store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, broken_04a3]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong colour-RAM store is CAUGHT and names 0x75C4", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_04a3, broken_04a3, { maxFrames: MAX_FRAMES });

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
