// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_004e (a 40-byte sprite-object-template block
 * copy into SPRITE_OBJ_BLOCK = 0x6908). A tiny, heavily-shared LEAF: `ld de,0x6908
 * / ld bc,0x28 / ldir / ret`, reached via `m.call(0x004e)` from 17 call sites with
 * the copy SOURCE supplied in HL by the caller.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized sub_004e (optimized/sub_004e.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit. sub_004e is a LEAF
 *      reached only through m.call, so the harness installs the snapshot override at
 *      CONSTRUCTION (see core/equivalence.js) -- that is what lets the override fire
 *      on an m.call target at all.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_004e is
 *      NOT reached in attract (0 dispatches over a plain boot -- verified), so it is
 *      driven by an identical-both-sides coin+start inputTape: the game credits,
 *      starts, and does board setup, whose loc_0abf calls sub_004e EXACTLY ONCE at
 *      frame ~100 with HL = ROM 0x388C. The tape is applied identically to baseline
 *      and optimized (the shared factory), so the ONLY difference between the two
 *      runs is which sub_004e implementation runs.
 *
 *   3. TEETH -- a deliberately-broken twin (the first byte of the copy, 0x6908,
 *      lands a wrong value) must be CAUGHT: NOT-EQUAL, naming 0x6908.
 *
 *   4. PATH COVERAGE -- sub_004e has NO data-dependent branch: it is straight-line,
 *      one path, a FIXED-length (0x28) unconditional copy. There is exactly one
 *      branch and the driven run + the unit gate both exercise it. For extra teeth on
 *      its one real degree of freedom -- the caller-supplied SOURCE in HL -- a
 *      SYNTHESISED entry copies from a DIFFERENT source (ROM 0x3A1F, loc_186f's
 *      source) and is proven EQUAL (RAM + regs + pc) on oracle vs optimized clones.
 *
 *   5. CYCLE TOTAL -- sub_004e is deliberately KEPT PER-INSTRUCTION (it is NOT atomic
 *      on every call path: main-loop callers like loc_07cb + the interruptible
 *      per-byte m.ldirAt), so its cycle total must match the oracle byte-for-byte.
 *      The synthesised-source run asserts the per-routine cycle total is IDENTICAL
 *      (oracle == optimized) as its cycle teeth.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's input-free wrappers).
 * Like loc_186f, sub_004e needs game state harness.js's input-free factory can never
 * reach, so this test calls the SAME core unitEquivalence / wholeMachineEquivalence,
 * passing a makeMachine factory that attaches an identical coin+start inputTape to
 * BOTH baseline and optimized machines. Nothing about the capture / clone / diff /
 * invocation-counter logic is re-implemented -- it is the standard engine, reached
 * the way harness.js reaches it (the snapshot override is installed at CONSTRUCTION
 * through the factory, so it reaches this leaf however it is first entered). Any
 * poke/tape is applied identically to both sides.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_004e as translated_004e } from "../../translated/state0.js";
import { sub_004e as optimized_004e } from "../sub_004e.js";
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

const TARGET = 0x004e;
const FRAMES = 110; // sub_004e first (and only) dispatches at frame ~100 on this tape
const MAX_FRAMES = 105; // enough to reach that first entry

const SPRITE_OBJ_BLOCK = 0x6908; // destination base; first byte of the copy

// A coin+start tape (identical to loc_186f's): coin on IN2 bit7 at frame 10, start1
// on IN2 bit2 at frame 30. This credits + starts a game so board setup runs and its
// loc_0abf calls sub_004e (HL = ROM 0x388C) exactly once around frame 100.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The makeMachine factory the core engine drives (the same shape harness.js's
// dkMachineFactory produces), extended to attach the coin+start inputTape. Called
// with no argument for the baseline and with the wrapped override map for the
// optimized side -- both get the SAME tape.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
}

// The first store on sub_004e's path that lands in the compared dump: the first byte
// of the 0x28-byte copy, 0x6908 <- (HL). sub_004e fires only at frame ~100 and does
// not run again in the window, so the corrupted cell persists to that frame's
// boundary and the whole-machine diff catches it.
const BROKEN_ADDR = SPRITE_OBJ_BLOCK;

/**
 * Deliberately-broken twin: behaviourally optimized_004e EXCEPT the first store to
 * 0x6908 lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly that
 * one write lets the rest of the copy run verbatim -- the representative "wrong value
 * to an address on the routine's path" bug the gate must catch.
 */
function broken_004e(m) {
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
    return optimized_004e(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_004e matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_004e]]));

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
      `${r.invocations.get(TARGET)}x (board-setup template copy -> 0x6908)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_004e matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_004e, optimized_004e, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, HL, DE, BC, SP) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong copy store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_004e]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong copy store is CAUGHT and names 0x6908", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_004e, broken_004e, { maxFrames: MAX_FRAMES });

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

// -- PATH COVERAGE (one path) + SOURCE-VARIATION + CYCLE TOTAL -----------------

// Capture the pristine machine state at sub_004e's FIRST dispatch (frame ~100),
// via the same construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_004e(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`sub_004e never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

// Run oracle vs optimized on two clones of `entry`, after forcing HL (the copy
// source) to `srcHL` identically on both. Diffs RAM + regs + pc AND the cycle total.
function runSource(entry, srcHL) {
  const a = entry.clone(); // translated (oracle)
  const b = entry.clone(); // optimized
  a.regs.hl = srcHL;
  b.regs.hl = srcHL;
  const startA = a.cycles;
  const startB = b.cycles;

  translated_004e(a);
  optimized_004e(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return {
    ram,
    regs,
    pcEqual: a.pc === b.pc,
    cyclesEqual: (a.cycles - startA) === (b.cycles - startB),
    aCycles: a.cycles - startA,
    bCycles: b.cycles - startB,
    dest: a.mem.read8(SPRITE_OBJ_BLOCK), // first copied byte, oracle
    destB: b.mem.read8(SPRITE_OBJ_BLOCK), // first copied byte, optimized
  };
}

test("PATH + SOURCE-VARIATION + CYCLE: the single copy path is EQUAL for two distinct sources", () => {
  const entry = captureEntry();

  // sub_004e has exactly ONE path; its only degree of freedom is the caller's HL
  // source. Prove EQUAL for the natural source (ROM 0x388C, loc_0abf) AND a distinct
  // one (ROM 0x3A1F, loc_186f) -- same fixed 0x28-byte copy, different bytes.
  const sources = [
    { name: "src 0x388C (loc_0abf)", hl: 0x388c },
    { name: "src 0x3A1F (loc_186f)", hl: 0x3a1f },
  ];

  for (const { name, hl } of sources) {
    const r = runSource(entry, hl);

    assert.equal(r.ram, null, r.ram ? `${name}: RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
    assert.equal(r.regs, null, r.regs ? `${name}: reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
    assert.ok(r.pcEqual, `${name}: pc mismatch`);
    // Prove the copy actually landed the source byte (oracle and optimized agree).
    assert.equal(r.dest, r.destB, `${name}: first copied byte differs (oracle ${r.dest} vs optimized ${r.destB})`);
    // Cycle teeth: KEPT PER-INSTRUCTION, so the total must match the oracle exactly.
    assert.ok(
      r.cyclesEqual,
      `${name}: cycle total differs (oracle ${r.aCycles} vs optimized ${r.bCycles})`,
    );
    console.log(`  PATH ${name}: EQUAL (RAM+regs+pc), first byte 0x${r.dest.toString(16)}, cycle total ${r.aCycles}t (oracle==optimized)`);
  }
});
