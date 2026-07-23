// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_055f (select the current player's 3-byte BCD
 * score base into DE: 0x600D==0 -> P1_SCORE 0x60B2, else P2_SCORE 0x60B5). It is
 * a LEAF reached ONLY by m.call(0x055f) from entry_051c (task-table entry 0), at
 * that routine's 0x051E and 0x0550 call sites.
 *
 * WHY THIS ROUTINE NEEDS MORE THAN THE 0611 TEMPLATE (and follows 051c instead).
 * entry_051c opens with an ENABLE GUARD (rst 0x08 / sub_0008): during ATTRACT it
 * discards its own return and does nothing -- so it never reaches `call 0x055f`.
 * The input-less whole-machine harness only ever runs in attract, so sub_055f is
 * NEVER naturally entered: a plain wholeMachineEquivalence override would report
 * invocations==0 (a vacuous EQUAL), and the standard unitEquivalence would throw
 * "never entered". Both the whole-machine gate and the unit entry must therefore
 * be DRIVEN past the guard, exactly as equivalence-051c.test.js does.
 *
 * The four tests, split by what each gate can reach:
 *
 *   1. EQUAL (whole-machine, ATTRACT poked clear) -- pokes ATTRACT bit0 clear on
 *      BOTH sides (identically, so the comparison stays fair) so entry_051c's
 *      natural frame-~1137 task runs the REAL scoring path and m.call's sub_055f
 *      under live NMI timing. Asserts the override actually fired and the optimized
 *      sub_055f is byte-identical to the oracle over the whole trace. This is what
 *      verifies the per-instruction cycle distribution under a live NMI.
 *
 *   2. EQUAL (unit, BOTH branches) -- attract never credits a game, so a real
 *      sub_055f entry is SYNTHESISED from a captured live machine: push the call's
 *      return address, set CURRENT_PLAYER, and diff translated vs optimized (RAM +
 *      all registers incl. F + pc). Runs sel=0 (ret-z -> P1_SCORE) AND sel=1
 *      (fall-through -> P2_SCORE): full branch coverage, one assertion per branch,
 *      each first asserting the oracle really reaches that branch's DE.
 *
 *   3. TEETH (whole-machine, poked) -- a broken sub_055f that returns the WRONG DE
 *      (its only output is the register, not a store) is CAUGHT downstream: the
 *      corrupted score base sends entry_051c's BCD add to the wrong triple, so the
 *      state trace diverges. Confirms the gate bites a wrong-result leaf.
 *
 *   4. TEETH (unit, real entry) -- the same wrong-DE twin is CAUGHT as a REGISTER
 *      diff at `e` (the low byte of DE, 0xB2 vs 0xB5). sub_055f writes no RAM, so
 *      the unit teeth land on the register file -- which is precisely the contract
 *      the unit gate guards.
 *
 * CYCLE DECISION. sub_055f is kept PER-INSTRUCTION (not collapsed): its sole
 * caller entry_051c is a main-loop routine (NMI mask enabled), so the vblank NMI
 * can land inside this leaf, and collapsing its charges would move that landing's
 * pushed PC (README §2, ATOMICITY-IS-PER-CALL-PATH). The charges here are copied
 * verbatim from the oracle, so Test 1's poke-driven whole-machine EQUAL under live
 * NMI timing holds by construction.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_055f as translated_055f, entry_051c as translated_051c } from "../../translated/mainloop.js";
import { sub_055f as optimized_055f } from "../sub_055f.js";
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

const CALLER = 0x051c; // entry_051c: the sole caller (task-table entry 0)
const TARGET = 0x055f; // sub_055f
const CAP_FRAMES = 1160; // entry_051c first dispatches at frame ~1137

// -- RAM this routine and its caller touch ------------------------------------
const ATTRACT = 0x6007; // bit0 = the enable guard entry_051c's rst 0x08 tests
const CURRENT_PLAYER = 0x600d; // 0 -> P1_SCORE base, else P2_SCORE base
const P1_SCORE = 0x60b2; // returned in DE when CURRENT_PLAYER == 0
const P2_SCORE = 0x60b5; // returned in DE when CURRENT_PLAYER != 0
const RET_ADDR = 0x0521; // entry_051c's return address for its 0x051E `call 0x055f`

// -- shared helpers -----------------------------------------------------------

/**
 * Capture the machine at the first natural entry_051c dispatch (the guard-skip
 * entry in attract), snapshotting a pristine clone. The host run continues via
 * the translated oracle so it reaches a clean stop. We capture the CALLER (which
 * IS reachable) because sub_055f is never entered in attract.
 */
function captureCallerEntry(maxFrames = CAP_FRAMES) {
  const host = new Machine(ROM);
  let entry = null;
  host.overrides = new Map([[CALLER, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_051c(mm);
  }]]);
  host.runFrames(maxFrames);
  if (entry === null) throw new Error(`0x${CALLER.toString(16)} never dispatched in ${maxFrames} frames`);
  return entry;
}

/**
 * Synthesise a sub_055f entry from a captured live machine: select the player,
 * then push the return address entry_051c pushes before `call 0x055f`. sub_055f
 * reads only CURRENT_PLAYER and needs a valid stack for its `ret`, so this is a
 * faithful entry for either branch.
 */
function makeEntry(base, sel) {
  const s = base.clone();
  s.mem.write8(CURRENT_PLAYER, sel);
  s.push16(RET_ADDR); // the `call 0x055f` return address (entry_051c @ 0x051E)
  return s;
}

/** Run translated vs optimized on independent clones of `entry`; return the diffs. */
function unitDiff(entry, optFn = optimized_055f) {
  const a = entry.clone();
  const b = entry.clone();
  translated_055f(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
    de: b.regs.de,
    oracleDe: a.regs.de,
  };
}

/**
 * Broken twin: behaviourally optimized_055f, EXCEPT the returned DE is corrupted
 * (XOR 0x0007 swaps the two valid bases 0x60B2 <-> 0x60B5, so it is always wrong
 * whichever branch ran). sub_055f writes no RAM, so its representative bug is a
 * WRONG RESULT in DE -- caught as a register diff (unit) and, once the caller
 * bases its score writes on it, as downstream state drift (whole-machine).
 */
function broken_055f(m) {
  optimized_055f(m);
  m.regs.de = (m.regs.de ^ 0x0007) & 0xffff;
}

/**
 * Hand-rolled whole-machine run with ATTRACT poked clear (the provided
 * wholeMachineEquivalence can't poke, and sub_055f is unreachable without the
 * poke). Returns the per-frame state trace and how many times sub_055f fired
 * through `handler`.
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

// -- 1. EQUAL (whole-machine, ATTRACT poked clear) ----------------------------

test("EQUAL (whole-machine): optimized sub_055f matches the oracle on the real path under a poke", () => {
  const base = pokedRun(translated_055f); // oracle, poked
  const good = pokedRun(optimized_055f); // optimized, poked

  assert.ok(base.fired >= 1, "poke did not drive sub_055f (no real-path dispatch)");
  assert.equal(base.fired, good.fired, "both sides must dispatch sub_055f the same number of times");

  let diff = null;
  const n = Math.min(base.frames.length, good.frames.length);
  for (let f = 0; f < n && !diff; f++) {
    const d = firstStateDiff(base.frames[f], good.frames[f], (o) => base.m.stateOffsetToAddr(o));
    if (d) diff = { frame: f, ...d };
  }
  assert.equal(diff, null, diff ? `diverged at frame ${diff.frame}, 0x${(diff.addr ?? 0).toString(16)} (${diff.a} vs ${diff.b})` : "");
  console.log(
    `  EQUAL/whole: ${n} frames identical, sub_055f fired ${good.fired}x (real path via ATTRACT poke)`,
  );
});

// -- 2. EQUAL (unit, BOTH branches) -------------------------------------------

test("EQUAL (unit): optimized sub_055f matches the oracle on BOTH branches (RAM + regs + pc)", () => {
  const base = captureCallerEntry();

  // Branch A: CURRENT_PLAYER == 0 -> ret z -> DE = P1_SCORE.
  {
    const entry = makeEntry(base, 0x00);
    const d = unitDiff(entry);
    assert.equal(d.oracleDe, P1_SCORE, `sel=0 must reach the P1 branch (oracle DE=0x${d.oracleDe.toString(16)})`);
    assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)} (${d.ram.a} vs ${d.ram.b})` : "");
    assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg} (${d.regs.a} vs ${d.regs.b})` : "");
    assert.equal(d.pc, null, "pc must match (P1 branch)");
  }

  // Branch B: CURRENT_PLAYER != 0 -> fall through -> DE = P2_SCORE.
  {
    const entry = makeEntry(base, 0x01);
    const d = unitDiff(entry);
    assert.equal(d.oracleDe, P2_SCORE, `sel=1 must reach the P2 branch (oracle DE=0x${d.oracleDe.toString(16)})`);
    assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)} (${d.ram.a} vs ${d.ram.b})` : "");
    assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg} (${d.regs.a} vs ${d.regs.b})` : "");
    assert.equal(d.pc, null, "pc must match (P2 branch)");
  }

  console.log("  EQUAL/unit: both branches (P1 ret-z + P2 fall-through) — RAM + all registers (incl. F) + pc identical");
});

// -- 3. TEETH (whole-machine, poked) ------------------------------------------

test("TEETH (whole-machine): a wrong DE result is CAUGHT downstream", () => {
  const base = pokedRun(translated_055f); // oracle, poked
  const broken = pokedRun(broken_055f); // wrong-DE twin, poked

  assert.ok(base.fired >= 1, "poke did not drive a real-path dispatch");
  assert.ok(broken.fired >= 1, "broken override must have dispatched");
  // NOTE: fire counts may DIFFER here (unlike the good path in Test 1). The wrong
  // DE swaps the score base, which flips entry_051c's high-score-compare branch,
  // so the broken twin can take the 0x0550 copy arm (a SECOND sub_055f call) when
  // the oracle did not. That divergence in behaviour is itself the caught bug.

  let caught = null;
  const n = Math.min(base.frames.length, broken.frames.length);
  for (let f = 0; f < n && !caught; f++) {
    const d = firstStateDiff(base.frames[f], broken.frames[f], (o) => base.m.stateOffsetToAddr(o));
    if (d) caught = { frame: f, ...d };
  }
  assert.ok(caught, "harness FAILED to catch a wrong DE result — it is worthless");
  assert.ok(caught.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: wrong DE caught at frame ${caught.frame}, 0x${caught.addr.toString(16)} (${caught.a} vs ${caught.b})`,
  );
});

// -- 4. TEETH (unit, real entry) ----------------------------------------------

test("TEETH (unit): a wrong DE result is CAUGHT as a register diff at `e`", () => {
  const entry = makeEntry(captureCallerEntry(), 0x00); // sel=0 -> oracle DE=0x60B2
  const d = unitDiff(entry, broken_055f);

  assert.equal(d.ram, null, "sub_055f writes no RAM, so the RAM dump must stay identical");
  assert.ok(d.regs != null, "harness FAILED to catch a wrong DE — it is worthless");
  assert.equal(
    d.regs.reg,
    "e",
    `expected the wrong result to diverge at register e (DE low byte), got ${d.regs.reg}`,
  );
  assert.equal(d.regs.a, P1_SCORE & 0xff, "oracle e must be 0xB2 (P1_SCORE low byte)");
  assert.equal(d.regs.b, P2_SCORE & 0xff, "broken e must be 0xB5 (corrupted to P2_SCORE low byte)");
  console.log(`  TEETH/unit: caught at register ${d.regs.reg} (oracle 0x${d.regs.a.toString(16)} vs broken 0x${d.regs.b.toString(16)})`);
});
