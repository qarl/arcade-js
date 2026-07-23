// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for handler_0763 (game-state-1 / attract sub-state 1:
 * the rst-0x20-gated TIMED ADVANCE that resets to the board-1 baseline and tail-
 * jumps into the board builder loc_0c92). ROM 0x0763-0x0778. Unlike the main-loop
 * task routines (0611/05c6/062a) this is an NMI-path handler, dispatched by
 * dispatchGameState via the 0x0748 sub-state table.
 *
 * Jobs:
 *
 *   1. EQUAL -- the idiomatic optimized handler_0763 reads EQUAL against its
 *      translated oracle, whole-machine and unit. In plain attract it dispatches
 *      EVERY frame from frame 7 through frame 518 (512 times): the two-level
 *      prescaler at 0x6008/0x6009 SKIPS the body on all of them EXCEPT the one
 *      frame both counters expire together (frame 518), which takes the PROCEED
 *      branch (stores + tail-jump into loc_0c92). A 520-frame window covers both.
 *
 *   2. BRANCH COVERAGE + DISPATCH -- the override must fire, and BOTH branches
 *      must be proven, or EQUAL is vacuous:
 *        - SKIP  : the natural unit entry is frame 7 (prescaler not expired), so
 *                  the standard unitEquivalence exercises it directly.
 *        - PROCEED: the natural run reaches it only at frame 518; the unit gate
 *                  captures the FIRST entry (frame 7, skip), so PROCEED is
 *                  SYNTHESISED -- both sides are wrapped to force 0x6008=1,0x6009=1
 *                  on the captured clone, which makes rst 0x20 expire and run the
 *                  body + loc_0c92. (unitEquivalence reaches handler_0763 through
 *                  dispatchGameState's construction-time override consult AND
 *                  m.call(0x0763); no open-coded workaround is needed.)
 *
 *   3. TEETH -- a deliberately-broken twin must be CAUGHT on each branch:
 *        - PROCEED: the store of LEVEL (0x6229) lands the wrong value -> NOT-EQUAL,
 *                  naming 0x6229, whole-machine (frame 518) AND unit. LEVEL is used
 *                  rather than the routine's first store (0x6392): loc_0c92, run
 *                  from the synthesised frame-7 entry, REWRITES 0x6392/0x63A0 back
 *                  to 0, so a corruption there does not survive the unit diff --
 *                  whereas it leaves LEVEL/LIVES untouched. LEVEL is also a named,
 *                  evidenced output (the fresh-game baseline this handler stamps),
 *                  and it survives to the frame boundary in the whole-machine trace.
 *                  Because 0x6229 is written ONLY on the proceed branch, this test
 *                  catching there is ALSO the proof the proceed branch is genuinely
 *                  exercised (non-vacuous).
 *        - SKIP  : the skip branch carries no routine-owned RAM store to corrupt --
 *                  it only delegates to m.call(0x0020) and early-returns -- so a
 *                  "wrong store" twin is not applicable. Its calling-convention IS
 *                  load-bearing, though: a twin that DROPS the push16(0x0764) that
 *                  balances the rst-0x20 push is CAUGHT (SP/stack/pc diverge). That
 *                  is the skip branch's committed teeth.
 *
 * CYCLE FINDING (see optimized/handler_0763.js for the full decision): handler_0763
 * runs INSIDE the vblank NMI, so no NMI can fire inside it -- it is ATOMIC and its
 * per-instruction charges COLLAPSE to one total per branch (skip 11t; proceed
 * 11+76+10 = 97t) while staying EQUAL whole-machine over 520 frames. The rst's own
 * 11t stays before m.call(0x0020) on both branches; the proceed branch folds the
 * body + tail-jump into a single m.step to the jump target. The TOTAL is still
 * load-bearing (it feeds the spin count), which the EQUAL/whole gate confirms.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { handler_0763 as translated_0763 } from "../../translated/nmi.js";
import { handler_0763 as optimized_0763 } from "../handler_0763.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { BOARD, LEVEL, LIVES } from "../ram.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0763;
const FRAMES = 520; // skip fires frames 7..517, proceed fires exactly at frame 518

// The two prescaler bytes the rst-0x20 gate decrements. Forcing both to 1 on the
// captured clone makes them expire together, so the routine takes the PROCEED
// branch that the natural first entry (frame 7) does not.
const SUBSTATE_TIMER_LO = 0x6008;
const SUBSTATE_TIMER = 0x6009;

// Broken-twin target: LEVEL (0x6229), a named output the proceed branch stamps to
// 1. It is written ONLY on that branch, loc_0c92 does not overwrite it, and it
// survives to the frame boundary -- so it is caught by BOTH gates naming 0x6229.
const BROKEN_ADDR = LEVEL;

// Wrap an implementation so the captured clone takes the PROCEED branch: force the
// two-level prescaler to expire (0x6008=1, 0x6009=1) before running. Applied
// IDENTICALLY to both sides, so it cannot mask a real divergence.
const forceProceed = (fn) => (m) => {
  m.mem.write8(SUBSTATE_TIMER_LO, 1);
  m.mem.write8(SUBSTATE_TIMER, 1);
  return fn(m);
};

/**
 * Deliberately-broken twin (PROCEED branch): behaviourally optimized_0763 EXCEPT
 * the first store to LEVEL (0x6229) lands a wrong value (correct XOR 0xFF).
 * Intercepting exactly that one write lets the rest of the routine and loc_0c92
 * run verbatim -- the representative "wrong value to one of the routine's own
 * output addresses" bug the gate must catch.
 */
function broken_0763(m) {
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
    return optimized_0763(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Deliberately-broken twin (SKIP branch): identical to optimized_0763 EXCEPT it
 * DROPS the push16(0x0764) that balances the rst-0x20 stack push. On the skip
 * path sub_0020's `pop hl` then pops the wrong word and SP/pc/stack diverge -- a
 * real calling-convention regression the gate must catch.
 */
function brokenSkip_0763(m) {
  const { regs, mem } = m;
  // push16(0x0764) deliberately omitted.
  m.step(0x0020, 11);
  if (!m.call(0x0020)) return;
  regs.xor(regs.a);
  mem.write8(0x6392, regs.a);
  mem.write8(0x63a0, regs.a);
  regs.a = 0x01;
  mem.write8(BOARD, regs.a);
  mem.write8(LEVEL, regs.a);
  mem.write8(LIVES, regs.a);
  m.step(0x0c92, 86);
  m.call(0x0c92);
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized handler_0763 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0763]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, ` +
      `override fired ${r.invocations.get(TARGET)}x (511 SKIP frames 7..517 + 1 PROCEED at frame 518)`,
  );
});

test("EQUAL (unit, SKIP branch): natural first entry matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0763, optimized_0763);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit SKIP: RAM + all registers (incl. F) + pc identical (prescaler not expired)");
});

test("EQUAL (unit, PROCEED branch): synthesised entry matches translated in RAM + registers", () => {
  const r = unitEquivalence(
    ROM, {}, TARGET,
    forceProceed(translated_0763),
    forceProceed(optimized_0763),
  );

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit PROCEED: RAM + all registers (incl. F) + pc identical (forced 0x6008=1,0x6009=1 -> body + loc_0c92)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong LEVEL store on the proceed frame is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0763]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  assert.equal(
    r.addr,
    BROKEN_ADDR,
    `expected divergence at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${(r.addr ?? 0).toString(16)}`,
  );
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit, PROCEED branch): a wrong LEVEL store is CAUGHT and names 0x6229", () => {
  const r = unitEquivalence(
    ROM, {}, TARGET,
    forceProceed(translated_0763),
    forceProceed(broken_0763),
  );

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  // 0x6229 is written ONLY on the proceed branch, so catching it here also proves
  // the synthesised entry genuinely PROCEEDED (the EQUAL/unit PROCEED test is not vacuous).
  console.log(
    `  TEETH/unit PROCEED: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

test("TEETH (unit, SKIP branch): a dropped rst-0x20 push16 is CAUGHT", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0763, brokenSkip_0763);

  assert.equal(r.equal, false, "harness FAILED to catch a calling-convention regression — it is worthless");
  assert.ok(
    r.ram != null || r.regs != null || r.pc != null,
    "a caught divergence must name RAM, a register, or pc",
  );
  console.log(
    `  TEETH/unit SKIP: caught (ram ${r.ram ? "0x" + r.ram.addr.toString(16) : "-"}, ` +
      `reg ${r.regs ? r.regs.reg : "-"}, pc ${r.pc ? "diff" : "-"})`,
  );
});
