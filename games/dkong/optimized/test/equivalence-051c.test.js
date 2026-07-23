// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for entry_051c (task table entry 0: add a 3-byte BCD
 * amount to a score, then challenge the high score). Like handler_05c6/entry_0611
 * it is a MAIN-LOOP routine dispatched by dispatchTask.
 *
 * WHY THIS ROUTINE NEEDS MORE THAN THE 0611 TEMPLATE. entry_051c opens with an
 * ENABLE GUARD (rst 0x08 / sub_0008): during ATTRACT it discards its own return
 * and does nothing. The input-less whole-machine harness only ever runs in
 * attract, so EVERY natural dispatch (first at frame ~1137) takes the guard-SKIP
 * path and the scoring logic (BCD add + high-score compare/copy) never runs.
 * A skip-path dispatch writes nothing that survives to a frame boundary (its only
 * store is the discarded rst-return on the stack, promptly overwritten) -- so a
 * skip-path TEETH cannot be caught, and a skip-path EQUAL is nearly vacuous.
 *
 * So the four tests split the work by what each gate can reach:
 *
 *   1. EQUAL (whole-machine, natural)  -- proves the override DISPATCHES and the
 *      guard-skip path is byte-identical over the attract window. Uses the
 *      provided wholeMachineEquivalence, asserts the override fired.
 *
 *   2. EQUAL (unit, real scoring path) -- the substantive gate. Synthesises a
 *      CREDITED-GAME entry (ATTRACT bit0 clear) so the guard proceeds, drives the
 *      COPY path (BCD add + compare + copy + tail render = maximum coverage), and
 *      asserts RAM + all registers (incl F) + pc identical. attract can never
 *      credit a game, so this entry is built, not captured live.
 *
 *   3. TEETH (whole-machine, real path) -- pokes ATTRACT bit0 clear on BOTH sides
 *      (identically, so the comparison stays fair) so the natural frame-1137 task
 *      runs the REAL scoring path end-to-end. Asserts (a) the correct optimized
 *      is EQUAL to the oracle under that poke -- the real path is whole-machine
 *      verified under live NMI timing -- and (b) a broken score store is CAUGHT,
 *      naming the diverging address. wholeMachineEquivalence can't poke, so this
 *      one is hand-rolled on the same Machine + firstStateDiff the engine uses.
 *
 *   4. TEETH (unit, real path) -- a wrong first score store (0x60B2) is CAUGHT and
 *      named, on the synthesised real entry.
 *
 * CYCLE-COLLAPSE EVIDENCE. entry_051c collapses each straight-line run to one
 * m.step of its exact per-instruction SUM, charged right before the m.call it
 * feeds (callees are interruptible, so every call's entry cycle is preserved, not
 * just each branch's total). Test 3's poke-driven whole-machine EQUAL over 1200
 * frames -- with the frame-1137 dispatch running the full ~1071-cycle real path --
 * is what verifies that collapse under live NMI timing; the unit gate (isolated,
 * NMI masked) confirms RAM+regs+pc but is insensitive to cycle distribution.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { entry_051c as translated_051c } from "../../translated/mainloop.js";
import { entry_051c as optimized_051c } from "../entry_051c.js";
import { wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x051c;
const FRAMES = 1160; // entry_051c first dispatches (guard-skip) at frame ~1137

// -- RAM addresses this routine touches ---------------------------------------
const ATTRACT = 0x6007; // bit0 = the enable guard rst 0x08 tests
const P1P2_SELECT = 0x600d; // 0 -> score base 0x60B2, else 0x60B5
const P1_SCORE = 0x60b2; // 3-byte little-endian BCD; the add loop's first store
const HIGH_SCORE = 0x60b8; // 3-byte; the copy target

// -- shared helpers -----------------------------------------------------------

/**
 * Capture the machine at the first natural 0x051c dispatch (the guard-skip entry
 * in attract), snapshotting a pristine clone. The host run continues via the
 * translated oracle so it reaches a clean stop.
 */
function captureEntry(maxFrames = FRAMES) {
  const host = new Machine(ROM);
  let entry = null;
  host.overrides = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_051c(mm);
  }]]);
  host.runFrames(maxFrames);
  if (entry === null) throw new Error(`0x${TARGET.toString(16)} never dispatched in ${maxFrames} frames`);
  return entry;
}

/**
 * Turn a captured attract entry into a CREDITED-GAME scoring entry: clear the
 * ATTRACT enable bit (so the guard proceeds), select P1, load the award index
 * into A, and set the score / high-score triples. Everything else (SP, the stack,
 * the rest of RAM) comes from the live capture, so the routine runs realistically.
 */
function makeReal(base, { payload, score, high, sel = 0x00 }) {
  const s = base.clone();
  s.mem.write8(ATTRACT, 0x00);
  s.mem.write8(P1P2_SELECT, sel);
  s.regs.a = payload;
  for (let i = 0; i < 3; i++) s.mem.write8(P1_SCORE + i, score[i]);
  for (let i = 0; i < 3; i++) s.mem.write8(HIGH_SCORE + i, high[i]);
  return s;
}

// A copy-path scenario: P1 = 990000, high = 001000; award +500 -> 990500 > high,
// so the routine adds, finds itself higher, and copies over the high score, then
// tail-renders it. Exercises every arm except the early ret-c.
const COPY_SCENARIO = { payload: 5, score: [0x00, 0x00, 0x99], high: [0x00, 0x10, 0x00] };

/** Run translated and optimized on independent clones of `entry`; return the diffs. */
function unitDiff(entry, optFn = optimized_051c) {
  const a = entry.clone();
  const b = entry.clone();
  translated_051c(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
  };
}

/**
 * Broken twin: behaviourally optimized_051c EXCEPT the first store to P1_SCORE
 * (the low byte of the BCD add) lands a wrong value (correct XOR 0xFF, guaranteed
 * to differ). Intercepting exactly that one write lets the rest run verbatim --
 * the representative "wrong value to one of the routine's own outputs" bug.
 */
function broken_051c(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === P1_SCORE) {
      broke = true;
      return realWrite(addr, (value ^ 0xff) & 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_051c(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Hand-rolled whole-machine run with ATTRACT poked clear on both sides (the
 * provided wholeMachineEquivalence can't poke). Returns the per-frame state trace
 * and how many times 0x051c dispatched through `handler`.
 */
function pokedRun(handler) {
  let fired = 0;
  const m = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => { fired += 1; return handler(mm); }]]),
  });
  m.pokes = [{ addr: ATTRACT, val: 0x00, frame: 1100, dur: 100 }];
  const frames = m.runFrames(1200);
  return { frames, fired, m };
}

// -- 1. EQUAL (whole-machine, natural = guard-skip path) ----------------------

test("EQUAL (whole-machine): optimized entry_051c matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_051c]]));

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
      `override fired ${r.invocations.get(TARGET)}x (guard-skip path; attract never credits a game)`,
  );
});

// -- 2. EQUAL (unit, real scoring path) ---------------------------------------

test("EQUAL (unit): optimized entry_051c matches translated on the real copy path (RAM + regs + pc)", () => {
  const entry = makeReal(captureEntry(), COPY_SCENARIO);

  // Confirm the scenario really drives the copy path: translated must overwrite
  // the high score (990500 > 001000), or this test would be checking a no-op.
  const check = entry.clone();
  translated_051c(check);
  assert.notEqual(check.mem.read8(HIGH_SCORE + 1), 0x10, "scenario did not reach the high-score copy path");

  const d = unitDiff(entry);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)} (${d.ram.a} vs ${d.ram.b})` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg} (${d.regs.a} vs ${d.regs.b})` : "");
  assert.equal(d.pc, null, "pc must match");
  console.log("  EQUAL/unit: real copy path — RAM + all registers (incl. F) + pc identical");
});

// -- 3. TEETH (whole-machine, real path via identical ATTRACT poke) -----------

test("TEETH (whole-machine): a wrong score store on the real path is CAUGHT (and the correct one is EQUAL)", () => {
  const base = pokedRun(translated_051c); // oracle, poked
  const good = pokedRun(optimized_051c); // correct optimized, poked
  const broken = pokedRun(broken_051c); // broken optimized, poked

  assert.ok(base.fired >= 1, "poke did not drive a real-path dispatch");
  assert.equal(base.fired, broken.fired, "both sides must dispatch the same number of times");

  // (a) the correct optimized is byte-identical to the oracle under the poke —
  //     the scoring path is whole-machine verified under live NMI timing.
  let goodDiff = null;
  const nGood = Math.min(base.frames.length, good.frames.length);
  for (let f = 0; f < nGood && !goodDiff; f++) {
    const d = firstStateDiff(base.frames[f], good.frames[f], (o) => base.m.stateOffsetToAddr(o));
    if (d) goodDiff = { frame: f, ...d };
  }
  assert.equal(goodDiff, null, goodDiff ? `optimized diverged from oracle under poke at frame ${goodDiff.frame}, 0x${(goodDiff.addr ?? 0).toString(16)}` : "");

  // (b) the broken store is caught, naming the address.
  let caught = null;
  const nBrk = Math.min(base.frames.length, broken.frames.length);
  for (let f = 0; f < nBrk && !caught; f++) {
    const d = firstStateDiff(base.frames[f], broken.frames[f], (o) => base.m.stateOffsetToAddr(o));
    if (d) caught = { frame: f, ...d };
  }
  assert.ok(caught, "harness FAILED to catch a wrong score store — it is worthless");
  assert.equal(caught.addr, P1_SCORE, `expected first diff at 0x${P1_SCORE.toString(16)}, got 0x${(caught.addr ?? 0).toString(16)}`);
  console.log(
    `  TEETH/whole: correct path EQUAL over ${nGood} frames (real scoring path); ` +
      `broken store caught at frame ${caught.frame}, 0x${caught.addr.toString(16)} (${caught.a} vs ${caught.b})`,
  );
});

// -- 4. TEETH (unit, real path) -----------------------------------------------

test("TEETH (unit): a wrong score store is CAUGHT and names 0x60B2", () => {
  const entry = makeReal(captureEntry(), COPY_SCENARIO);
  const d = unitDiff(entry, broken_051c);

  assert.ok(d.ram != null, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(
    d.ram.addr,
    P1_SCORE,
    `expected first diff at the broken address 0x${P1_SCORE.toString(16)}, got 0x${d.ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${d.ram.addr.toString(16)} (translated ${d.ram.a} vs broken ${d.ram.b})`);
});
