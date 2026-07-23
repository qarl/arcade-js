// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_07cb (the attract "HOW HIGH" round-2 per-
 * frame countdown-animation task). Unlike the main-loop routines 05c6/0611,
 * loc_07cb is dispatched INSIDE the vblank NMI: handler_073c is the game-state-1
 * arm of the 0x00CA NMI table, and it sub-dispatches loc_07cb through the 0x0748
 * table (entry index 6) when GAME_SUBSTATE (0x600A) == 6 during attract. It only
 * begins at frame 2853 of a clean boot -- the point the attract loop reaches that
 * sub-state -- so the windows below are sized to reach it (no input/poke needed).
 *
 * Jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_07cb reads EQUAL against its
 *      translated oracle, whole-machine (3000 frames) and unit. The override
 *      routes through dispatchGameState's override consult (nmi.js).
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_07cb
 *      dispatches 97 times in the 3000-frame window (arm @2853, 95 countdown
 *      frames, finish @2949, then the attract loop moves on).
 *
 *   3. TEETH -- a deliberately-broken twin (the first store to the frame timer
 *      0x638A lands the wrong value) must be CAUGHT, naming 0x638A.
 *
 *   4. FULL BRANCH COVERAGE -- every data-dependent branch is proven EQUAL
 *      (RAM + all registers + pc + cycle TOTAL) on a synthesised entry: the
 *      arm/countdown fork, the countdown-finished fork, and both `rlc` carry
 *      arms (all four bit combinations). The natural first entry is the arm
 *      branch; the rest are reached by cloning it and poking 0x638A/0x638B.
 *
 * THE COLLAPSE FINDING this routine adds: loc_07cb is ATOMIC even though it makes
 * six sub-calls, because it runs inside the NMI with the mask (0x7D84) CLEAR --
 * the vblank NMI cannot re-enter it or its callees, and the whole NMI finishes
 * within a frame so no boundary is crossed inside it. So its per-instruction
 * m.step charges collapse to one-per-segment (and one per fill-loop ITERATION,
 * the counts being ROM-table-driven) and stay EQUAL. The TOTAL is still load-
 * bearing: stripping the charges entirely diverges at SPIN_COUNT 0x6019 on frame
 * 2853 (baseline 28 vs stripped 72) -- the NMI's total cost sets the post-NMI
 * main-loop spin count. Same mechanism as handler_01c3, loc_07cb's own numbers.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_07cb as translated_07cb } from "../../translated/state0.js";
import { loc_07cb as optimized_07cb } from "../loc_07cb.js";
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

const TARGET = 0x07cb;
const FRAMES = 3000; // loc_07cb runs 97x from frame 2853 in this window
const REACH = 2900; // maxFrames for the unit gate to reach the first entry (@2853)

// The frame-animation timer at 0x638A is written on EVERY branch (armed to 0x60
// on the first frame, decremented thereafter) and lives in the compared work-RAM
// dump (0x6000-0x6BFF). Corrupting its first store is caught by both gates; the
// corruption then propagates through the countdown, so the whole-machine diff
// persists rather than being repainted away.
const BROKEN_ADDR = 0x638a;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x638A lands a wrong value (correct XOR 0xFF, guaranteed to differ).
 * Intercepting exactly that one write lets the rest of the routine and every
 * subroutine it calls run verbatim.
 */
function broken_07cb(m) {
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
    return optimized_07cb(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_07cb matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_07cb]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_07cb matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_07cb, optimized_07cb, { maxFrames: REACH });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (natural arm-branch entry)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong frame-timer store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_07cb]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong frame-timer store is CAUGHT and names 0x638A", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_07cb, broken_07cb, { maxFrames: REACH });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});

// -- FULL BRANCH COVERAGE -----------------------------------------------------
// The natural unit entry (above) is the ARM branch, which also runs the body,
// the rlc1-CLEAR arm, and the rlc2-SET arm. The remaining data-dependent
// branches are synthesised by cloning that captured entry and poking the two
// bytes that decide them: 0x638A (arm vs countdown vs finish) and 0x638B (the
// pattern whose top two bits pick the rlc arms). Each is proven EQUAL in RAM +
// every register (incl. F) + pc AND cycle TOTAL — the last directly enforcing
// "collapse preserves each branch's total".

let CACHED_ENTRY = null;
function captureEntry() {
  if (CACHED_ENTRY) return CACHED_ENTRY;
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_07cb(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(REACH);
  if (entry === null) throw new Error(`0x${TARGET.toString(16)} never entered within ${REACH} frames`);
  CACHED_ENTRY = entry;
  return entry;
}

/** Clone the captured entry, poke the deciding bytes, run translated vs optimized
 *  on two independent clones, and diff RAM + regs + pc + cycle total. */
function branchEqual(v638a, v638b) {
  const entry = captureEntry();
  const a = entry.clone();
  const b = entry.clone();
  for (const mm of [a, b]) {
    if (v638a !== null) mm.mem.write8(0x638a, v638a);
    if (v638b !== null) mm.mem.write8(0x638b, v638b);
  }
  const ca = a.cycles, cb = b.cycles;
  translated_07cb(a);
  optimized_07cb(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
    cycTranslated: a.cycles - ca,
    cycOptimized: b.cycles - cb,
  };
}

function assertBranch(label, v638a, v638b) {
  const r = branchEqual(v638a, v638b);
  assert.equal(r.ram, null, r.ram ? `${label}: RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `${label}: reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, `${label}: pc diff`);
  assert.equal(
    r.cycOptimized,
    r.cycTranslated,
    `${label}: cycle TOTAL diverged (translated ${r.cycTranslated} vs optimized ${r.cycOptimized})`,
  );
  console.log(`  branch ${label.padEnd(30)} EQUAL (ram+regs+pc), total ${r.cycTranslated}t`);
}

test("BRANCH: arm vs countdown fork (0x638A == 0 vs != 0)", () => {
  assertBranch("arm (638A=0, natural C=0x5F)", null, null); // rlc1 clear, rlc2 set
  assertBranch("countdown+body (638A=0x30)", 0x30, 0x5f);
});

test("BRANCH: countdown-finished fork (timer hits 0 after decrement)", () => {
  // 638A=1 -> decrement to 0 -> the finish arm (advance the attract state machine).
  assertBranch("finish (638A=1)", 0x01, 0x5f);
});

test("BRANCH: both rlc carry arms, all four bit combinations", () => {
  // 638B top two bits pick the arms: bit7 -> rlc1 carry, bit6 -> rlc2 carry.
  assertBranch("rlc1=0 rlc2=0 (638B=0x00)", 0x30, 0x00);
  assertBranch("rlc1=0 rlc2=1 (638B=0x40)", 0x30, 0x40);
  assertBranch("rlc1=1 rlc2=0 (638B=0x80)", 0x30, 0x80);
  assertBranch("rlc1=1 rlc2=1 (638B=0xC0)", 0x30, 0xc0);
});
