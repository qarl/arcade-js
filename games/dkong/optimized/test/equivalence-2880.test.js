// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_2880 (board-1 collision search: three fixed
 * entry_2913 sweeps over object lists 0x6700 / 0x6400 / 0x66A0). It is reached
 * via sub_286f's 0x2874 collision-dispatch table and runs INSIDE the NMI
 * (dispatchGameState -> gameplay loc_197a -> sub_2808 -> sub_286f -> here).
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized sub_2880 (optimized/sub_2880.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      routes through the rst-0x28 dispatch consult, inert when the map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. During
 *      the attract demo (which plays board 1) sub_2880 dispatches many times
 *      after ~frame 586; a 700-frame window covers it.
 *
 *   3. TEETH -- a deliberately-broken twin (the LAST store to the count scratch
 *      0x63B9 lands the wrong value) must be CAUGHT: NOT-EQUAL, naming 0x63B9.
 *      (The FIRST/second stores are overwritten by later sweeps, so only the last
 *      persists -- this is the store that has observable teeth.)
 *
 *   4. BRANCH COVERAGE (full teeth). The natural run only ever takes the ALL-MISS
 *      fall-through branch (verified: 316/316 dispatches miss all three sweeps).
 *      The three HIT branches (a hit on sweep 1, 2, or 3) never occur naturally,
 *      so each is SYNTHESISED: clone the captured entry, force entry_2913 to hit
 *      on the chosen sweep (identical fake on both clones -- it reproduces
 *      entry_2913's real hit/miss stack+register epilogue), and diff oracle vs
 *      optimized RAM + registers + pc. Because these branches are collapsed and
 *      NOT reached whole-machine, each ALSO asserts its CYCLE TOTAL matches the
 *      oracle (the collapse's teeth on the un-exercised arms). The fall-through's
 *      collapse is likewise given an explicit cycle-total check on top of its
 *      whole-machine coverage.
 *
 * THE COLLAPSE FINDING this routine adds: sub_2880 is ATOMIC (it runs inside the
 * NMI and its only callee entry_2913 makes no interruptible call, so the vblank
 * NMI never lands inside it). Collapsing its per-instruction m.step charges to
 * one total per sweep (75 / 62 / 62, + 10 for the all-miss ret) stays EQUAL
 * whole-machine across every natural dispatch, and the synthesised hit branches
 * confirm each collapsed total equals the oracle's. Its TOTAL is still load-
 * bearing (the NMI's cost feeds the main-loop spin count, README §2); only the
 * internal DISTRIBUTION is free.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_2880 as translated_2880 } from "../../translated/state0.js";
import { sub_2880 as optimized_2880 } from "../sub_2880.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
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

const TARGET = 0x2880;
const FRAMES = 700; // sub_2880 first dispatches ~frame 586; 700 gives a comfortable margin
const COUNT_ADDR = 0x63b9; // the search-count scratch this routine writes each sweep

// The LAST of sub_2880's three stores to 0x63B9 (sweep 3, value 0x01) is the one
// that survives -- the first two are overwritten by later sweeps. Corrupting it
// is the representative "wrong value to one of the routine's own output
// addresses" bug the gate must catch. Intercepting exactly the 3rd write lets
// every sweep and subroutine run verbatim otherwise.
function broken_2880(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let n = 0;
  m.mem.write8 = (addr, value, busOffset) => {
    if (addr === COUNT_ADDR) {
      n++;
      if (n === 3) return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_2880(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_2880 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_2880]]));

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

test("EQUAL (unit): idiomatic optimized sub_2880 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_2880, optimized_2880, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong count store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_2880]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong count store is CAUGHT and names 0x63B9", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_2880, broken_2880, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    COUNT_ADDR,
    `expected first diff at 0x${COUNT_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- BRANCH COVERAGE (synthesised; RAM + regs + pc + cycle totals) ------------

// Capture the pristine machine state at sub_2880's first entry (the natural
// fall-through entry -- every natural dispatch misses all three sweeps).
let CAPTURED = null;
function capturedEntry() {
  if (CAPTURED) return CAPTURED;
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_2880(mm); // let the host proceed to a clean stop
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(FRAMES);
  assert.ok(entry !== null, `0x${TARGET.toString(16)} never entered within ${FRAMES} frames`);
  CAPTURED = entry;
  return CAPTURED;
}

/**
 * Patch a clone's m.call so entry_2913 (0x2913) is FORCED to hit on the
 * `hitOnCall`-th sweep (1-based) and miss before it -- reproducing entry_2913's
 * OWN observable epilogue on each path (README §"Flags"): a MISS returns true
 * after `xor a` (A=0) and a `ret` to our continuation; a HIT returns false after
 * `ld a,0x01`, discards our pushed return address (inc sp; inc sp) and `ret`s to
 * the caller's caller. The same fake is installed on both clones, so it isolates
 * sub_2880's own per-branch behaviour. hitOnCall = 0 means never hit (fall-through
 * uses the REAL registry entry_2913, so no patch is applied for that case).
 */
function installForceHit(clone, hitOnCall) {
  let n = 0;
  clone.call = (addr) => {
    assert.equal(addr, 0x2913, `sub_2880 called an unexpected routine 0x${addr.toString(16)}`);
    n++;
    const { regs } = clone;
    if (n === hitOnCall) {
      regs.a = 0x01; // ld a,0x01
      regs.sp = (regs.sp + 2) & 0xffff; // inc sp; inc sp -- discard our pushed retaddr
      clone.ret(); // ret -> caller's caller
      return false; // HIT (sub_0008 convention)
    }
    regs.xor(regs.a); // xor a -> A=0
    clone.ret(); // ret -> our continuation
    return true; // MISS
  };
}

/**
 * Run oracle vs optimized on two clones of the captured entry, forcing a hit on
 * `hitOnCall` (0 = natural fall-through with the real entry_2913). Returns the
 * RAM/reg/pc diffs and both clones' cycle deltas.
 */
function runBranch(hitOnCall) {
  const entry = capturedEntry();
  const a = entry.clone(); // oracle
  const b = entry.clone(); // optimized
  const c0 = entry.cycles;
  if (hitOnCall > 0) {
    installForceHit(a, hitOnCall);
    installForceHit(b, hitOnCall);
  }
  translated_2880(a);
  optimized_2880(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
    oracleCycles: a.cycles - c0,
    optCycles: b.cycles - c0,
  };
}

function assertBranchEqual(label, hitOnCall) {
  const r = runBranch(hitOnCall);
  assert.equal(r.ram, null, r.ram ? `${label}: RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `${label}: reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, r.pc ? `${label}: pc ${r.pc.a} vs ${r.pc.b}` : "");
  assert.equal(
    r.optCycles,
    r.oracleCycles,
    `${label}: cycle total ${r.optCycles} != oracle ${r.oracleCycles} (collapse changed the branch total)`,
  );
  console.log(`  BRANCH ${label}: RAM+regs+pc identical, cycle total ${r.optCycles} == oracle ${r.oracleCycles}`);
}

test("BRANCH (fall-through, all miss): RAM + regs + pc + cycle total identical", () => {
  assertBranchEqual("fall-through", 0);
});

test("BRANCH (hit on sweep 1): RAM + regs + pc + cycle total identical", () => {
  assertBranchEqual("hit-sweep-1", 1);
});

test("BRANCH (hit on sweep 2): RAM + regs + pc + cycle total identical", () => {
  assertBranchEqual("hit-sweep-2", 2);
});

test("BRANCH (hit on sweep 3): RAM + regs + pc + cycle total identical", () => {
  assertBranchEqual("hit-sweep-3", 3);
});
