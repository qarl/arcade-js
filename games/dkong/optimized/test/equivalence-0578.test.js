// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for draw_0578 (render a 3-byte BCD counter up a VRAM
 * column). Like handler_05c6 / entry_0611 it is a MAIN-LOOP routine, reached via
 * dispatchTask -> handler_05c6 -> {tail_05da | draw_056b} -> here. But it is the
 * FIRST optimized routine that is PARAMETERISED: its ROM has two entry points and
 * the translation models the second as `draw_0578(m, enteredAt057C = true)`, which
 * machine.js `m.call` forwards.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized draw_0578 reads EQUAL
 *      against its translated oracle across every frame, on BOTH entry paths (they
 *      both fire at frame 5: payload 2 -> tail_05da -> 0x0578 with enteredAt057C
 *      FALSE, high score; payload 0 -> draw_056b -> 0x0578 with enteredAt057C TRUE,
 *      P1 score).
 *
 *   2. EQUAL (unit) -- RAM + full register file (incl. F) + pc identical when the
 *      routine is run in isolation from its first captured entry (the FALSE path).
 *
 *   3. TEETH (whole-machine) -- a deliberately-broken twin (the first render digit
 *      lands the wrong value) must be CAUGHT: NOT-EQUAL, naming a VRAM address.
 *
 *   4. TEETH (unit) -- the same wrong store, caught and localised to 0x7641.
 *
 *   5. FULL BRANCH COVERAGE (enteredAt057C = TRUE) -- the TRUE branch proven EQUAL
 *      in isolation (RAM + regs + pc) AND its cycle total shown equal to the
 *      oracle's, so a wrong branch total would have teeth.
 *
 * ★ WHY A CUSTOM whole-machine comparison instead of the shared harness.
 * The shared `wholeMachineEquivalence` wraps each override in an invocation
 * counter of shape `(mm) => { count; return fn(mm); }` -- which DROPS any extra
 * argument. For a parameterised routine that is fatal: on the enteredAt057C=TRUE
 * path (draw_056b) the baseline oracle receives `true` (machine.js `m.call`
 * forwards it) and skips `ld ix,0x7641`, keeping draw_056b's chosen column 0x7781;
 * but the arg-dropped optimized side sees `false`, overwrites IX with 0x7641, and
 * draws to the wrong column -- a FALSE divergence (measured: frame 5, VRAM 0x75C1,
 * baseline 5 vs optimized 0) that is an artefact of the harness wrapper, not a bug
 * in the rewrite. The SHIPPED game has no such issue: manifest overrides are
 * registered raw and `m.call(0x0578, true)` forwards the arg to the optimized
 * function directly. So the whole-machine gate here uses a local comparison whose
 * override wrapper FORWARDS args (`(mm, ...a) => fn(mm, ...a)`), which is faithful
 * to the shipped call convention and proves BOTH entry paths equal in situ. The
 * unit gate is unaffected: it invokes translatedFn/optimizedFn directly with no
 * extra arg, so it exercises the FALSE branch consistently on both sides.
 *
 * ATOMICITY: draw_0578 is kept PER-INSTRUCTION (NOT collapsed) -- it is a leaf
 * reached only from the main loop (NMI mask enabled) and its callee loop_0583 is
 * interruptible, so the oracle's exact cycle distribution is preserved. See the
 * routine's header for the full argument.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { draw_0578 as translated_0578 } from "../../translated/mainloop.js";
import { draw_0578 as optimized_0578 } from "../draw_0578.js";
import { unitEquivalence } from "../harness.js";
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

const TARGET = 0x0578;
const FRAMES = 30; // draw_0578 fires twice, both at frame 5 (FALSE then TRUE path)

// The first store on the routine's FALSE path (high-score render, which dispatches
// first) is the first BCD digit, written by sub_0593 to VRAM 0x7641 -- inside the
// compared state dump (video RAM 0x7400-0x77FF). draw_0578 fires only at frame 5,
// so the corrupted cell is not rewritten and the diff persists.
const BROKEN_ADDR = 0x7641;

/**
 * A whole-machine equivalence comparison whose override wrapper FORWARDS args --
 * mirrors core/equivalence.js's wholeMachineEquivalence except that the invocation
 * counter passes `...args` through, which is required for the parameterised
 * draw_0578 (see the file header). Baseline = raw oracle path (empty overrides);
 * optimized = `optFn` wired at `TARGET`. Returns the same shape the shared harness
 * does: { equal, framesCompared, invocations, frame?, addr?, baseline?, optimized? }.
 */
function wholeMachineForwarding(rom, nFrames, optFn) {
  const base = new Machine(rom, {});
  const baseFrames = base.runFrames(nFrames);
  assert.ok(!base.stoppedBy, `baseline stopped early: ${base.stoppedBy}`);
  assert.equal(baseFrames.length, nFrames, "baseline did not reach every vblank spin");

  let invocations = 0;
  const overrides = new Map([[TARGET, (mm, ...args) => {
    invocations++;
    return optFn(mm, ...args);
  }]]);
  const opt = new Machine(rom, { overrides });
  const optFrames = opt.runFrames(nFrames);
  assert.ok(!opt.stoppedBy, `optimized stopped early: ${opt.stoppedBy}`);
  assert.equal(optFrames.length, nFrames, "optimized did not reach every vblank spin");

  const framesCompared = Math.min(baseFrames.length, optFrames.length);
  for (let f = 0; f < framesCompared; f++) {
    const d = firstStateDiff(baseFrames[f], optFrames[f], (o) => base.stateOffsetToAddr(o));
    if (d) {
      return { equal: false, frame: f, addr: d.addr, baseline: d.a, optimized: d.b, framesCompared, invocations };
    }
  }
  return { equal: true, framesCompared, invocations };
}

/**
 * Deliberately-broken twin: behaviourally the optimized routine EXCEPT the first
 * store to 0x7641 lands a wrong value (the correct digit XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim -- the representative "wrong value to one
 * of the routine's own output addresses" bug the gate must catch. Args are
 * forwarded so the twin honours enteredAt057C exactly like the real routine.
 */
function broken_0578(m, ...args) {
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
    return optimized_0578(m, ...args);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Capture the machine state at draw_0578's first entry, delegating to the oracle so
 * the host run proceeds normally -- the same technique the shared unit gate uses,
 * open-coded here only so the TRUE-branch test can seed its own registers.
 */
function captureEntry(rom, maxFrames = 240) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm, ...args) => {
    if (entry === null) entry = mm.clone();
    return translated_0578(mm, ...args);
  }]]);
  const host = new Machine(rom, { overrides: snapshot });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error("draw_0578 never entered within the window");
  return entry;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized draw_0578 matches translated every frame (both entry paths)", () => {
  const r = wholeMachineForwarding(ROM, FRAMES, optimized_0578);

  // The override must actually have run, or EQUAL would be vacuous.
  assert.ok(r.invocations >= 1, `override at 0x${TARGET.toString(16)} never dispatched (invocations=${r.invocations})`);
  assert.equal(
    r.equal,
    true,
    r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
  assert.equal(r.framesCompared, FRAMES);
  console.log(`  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations}x (FALSE + TRUE paths)`);
});

test("EQUAL (unit): idiomatic optimized draw_0578 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0578, optimized_0578);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (FALSE-path entry)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong render store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineForwarding(ROM, FRAMES, broken_0578);

  assert.ok(r.invocations >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(`  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} (baseline ${r.baseline} vs optimized ${r.optimized})`);
});

test("TEETH (unit): a wrong render store is CAUGHT and names 0x7641", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0578, broken_0578);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});

// -- FULL BRANCH COVERAGE (enteredAt057C = TRUE) ------------------------------

test("BRANCH (unit): enteredAt057C=TRUE path proven EQUAL (RAM + regs + pc) with matching cycle total", () => {
  const entry = captureEntry(ROM);

  // Seed a representative TRUE-path entry: draw_056b has already chosen IX (0x7781,
  // P1 column) and DE points at the P1 score MSB. Set IDENTICALLY on both clones.
  const a = entry.clone(); // oracle
  const b = entry.clone(); // optimized
  for (const c of [a, b]) { c.regs.ix = 0x7781; c.regs.de = 0x60b4; }

  const ca = a.cycles;
  const cb = b.cycles;
  translated_0578(a, true);
  optimized_0578(b, true);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(a.pc, b.pc, "pc must match on the TRUE branch");

  // Cycle-total teeth: the TRUE branch must charge the oracle's exact total (a
  // wrong branch total would be caught here). Kept per-instruction, so this is the
  // sum of the oracle's own charges.
  const oracleCycles = a.cycles - ca;
  const optCycles = b.cycles - cb;
  assert.equal(optCycles, oracleCycles, `TRUE-branch cycle total ${optCycles} != oracle ${oracleCycles}`);
  console.log(`  BRANCH/unit(TRUE): RAM + regs + pc identical; cycle total ${optCycles} == oracle ${oracleCycles}`);
});
