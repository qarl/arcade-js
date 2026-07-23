// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_07c3 (game state 1 / attract, sub-state 5:
 * a whole-screen re-init via sub_0874 followed by advancing the 0x600A sub-state).
 * Like handler_01c3 it is an NMI GAME-STATE dispatch target -- reached through
 * dispatchGameState's override consult (nmi.js), inert when the map is empty --
 * so it is the companion data point to entry_0611's MAIN-LOOP collapse: an NMI
 * routine whose per-branch total collapses because a second NMI cannot land inside
 * the one already running.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_07c3 (optimized/loc_07c3.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_07c3
 *      dispatches EXACTLY ONCE from boot in pure attract, at frame 2852 (the
 *      attract sub-state machine steps to 5). A 2860-frame window covers it; the
 *      unit gate is given maxFrames 2860 for the same reason.
 *
 *   3. COVERAGE -- loc_07c3 is a single straight-line path (call / ld hl / inc(hl)
 *      / ret; no conditional jump). Its one data dependency is the inc VALUE, which
 *      decides the flags the unit gate diffs. Every flag class -- ordinary, sign
 *      flip (0x7F->0x80, overflow), zero+half-carry (0xFF->0x00) -- is synthesised
 *      from the captured entry and proven EQUAL (RAM + regs + pc). (sub_0874's own
 *      internal loop branches are its concern, reached here via m.call.)
 *
 *   4+5. TEETH -- a deliberately-broken twin whose ONE store to the routine's own
 *      output (the 0x600A sub-state increment) lands the wrong value must be CAUGHT
 *      by both gates, naming 0x600A. The corruption flips the low bit (6->7, both
 *      valid sub-state slots) so the whole-machine run stays healthy and the catch
 *      is a clean NOT-EQUAL rather than a derailed dispatch.
 *
 * THE RUNG FINDING this routine adds: loc_07c3 is ATOMIC (an NMI dispatch target;
 * the vblank NMI cannot re-enter it, and its only callee sub_0874 is a memory-fill
 * leaf that m.calls nothing interruptible). Collapsing its tail `ld hl / inc(hl) /
 * ret` (10+11+10) into one m.ret(31) stays EQUAL whole-machine. The total is still
 * load-bearing: stripping loc_07c3's cycle charges ENTIRELY diverges at STACK/spin
 * 0x6019 (frame 2852, 116 vs 117) -- the spin-count mechanism (README §2), the same
 * "total observable, distribution free" law handler_05c6 hit through 0x6019 and
 * entry_0611 through the stack.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { loc_07c3 as translated_07c3 } from "../../translated/state0.js";
import { loc_07c3 as optimized_07c3 } from "../loc_07c3.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x07c3;
const FRAMES = 2860; // loc_07c3 fires exactly once, at attract frame 2852
const SUBSTATE = 0x600a; // GAME_SUBSTATE -- the routine's own output byte

// The routine's characteristic store is the 0x600A sub-state increment. Flipping
// its low bit (6 -> 7) is a guaranteed-different but still IN-RANGE sub-state
// (entry 7 = 0x084b exists), so the whole-machine run does not derail into an
// unimplemented dispatch -- the catch is a clean NOT-EQUAL naming 0x600A.
const BROKEN_ADDR = SUBSTATE;
const BROKEN_XOR = 0x01;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x600A lands a wrong value. Intercepting exactly that one write lets
 * sub_0874 and the rest of the routine run verbatim -- the representative "wrong
 * value to one of the routine's own output addresses" bug the gate must catch.
 */
function broken_07c3(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BROKEN_ADDR) {
      broke = true;
      return realWrite(addr, value ^ BROKEN_XOR, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_07c3(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_07c3 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_07c3]]));

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
      `override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_07c3 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_07c3, optimized_07c3, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- COVERAGE (the single path, across every inc-value flag class) ------------

/**
 * Capture the pristine machine state at loc_07c3's first natural entry (frame
 * 2852), once, so every value class clones from the SAME real entry. The snapshot
 * override delegates to the oracle so the host game proceeds to a clean stop --
 * the same construction-time capture unitEquivalence uses internally.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_07c3(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(FRAMES);
  assert.ok(entry !== null, `loc_07c3 never entered within ${FRAMES} frames`);
  return entry;
}

test("COVERAGE (unit): the single path is EQUAL for every inc-value flag class", () => {
  const entry = captureEntry();

  // 0x05 is the natural entry value; the rest exercise the inc(hl) flag classes:
  //   0x7F -> 0x80 (sign + overflow), 0xFE -> 0xFF (sign, no zero),
  //   0xFF -> 0x00 (zero + half-carry), 0x00 -> 0x01 (all clear).
  for (const v of [0x00, 0x05, 0x7e, 0x7f, 0xfe, 0xff]) {
    const a = entry.clone(); // translated
    const b = entry.clone(); // optimized
    a.mem.write8(SUBSTATE, v);
    b.mem.write8(SUBSTATE, v);

    translated_07c3(a);
    optimized_07c3(b);

    const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.regs, b.regs);
    assert.equal(ram, null, ram ? `class 0x${v.toString(16)}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
    assert.equal(regs, null, regs ? `class 0x${v.toString(16)}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
    assert.equal(a.pc, b.pc, `class 0x${v.toString(16)}: pc must match`);
    // Sanity: the increment actually happened and matches on both sides.
    assert.equal(a.mem.read8(SUBSTATE), (v + 1) & 0xff, `class 0x${v.toString(16)}: sub-state must advance`);
    assert.equal(b.mem.read8(SUBSTATE), a.mem.read8(SUBSTATE), `class 0x${v.toString(16)}: sub-state must match`);
  }
  console.log("  COVERAGE/unit: 6 inc-value classes (incl. sign flip + zero/half-carry) all EQUAL RAM + regs (F) + pc");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong sub-state store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_07c3]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong sub-state store is CAUGHT and names 0x600A", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_07c3, broken_07c3, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
