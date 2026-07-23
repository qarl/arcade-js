// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0977 (ROM 0x0977: consume one credit --
 * BCD-decrement CREDITS at 0x6001 -- then enqueue task 0x0400 via sub_309f).
 *
 * sub_0977 is a LEAF routine reached only by `m.call` from loc_08f8 (the
 * game-state-2 start-select machine), which runs inside the vblank NMI. It does
 * NOT dispatch from a boot/attract run: it fires only after a credit is inserted
 * and a start button accepted. So this file DRIVES a coin + 1-player start
 * (early_start timing: coin@10, start1@16), which makes sub_0977 fire exactly
 * once at frame 17. The DK harness wrappers (harness.js) construct the machine
 * internally and cannot attach an input tape, so the tests build their own
 * makeMachine factory -- identical to harness.js's dkMachineFactory except it
 * sets `inputTape` -- and drive the game-agnostic core gate with it. The tape is
 * applied IDENTICALLY to the baseline and optimized sides (the factory sets it
 * unconditionally), so it never advantages one side.
 *
 * Four jobs (+ a branch/value-coverage teeth test):
 *
 *   1. EQUAL -- the idiomatic optimized sub_0977 reads EQUAL against its
 *      translated oracle, whole-machine and unit. The override resolves through
 *      the routine registry at every m.call site (leaf swap).
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_0977
 *      fires EXACTLY ONCE from the driven coin+start, at frame 17.
 *
 *   3. TEETH -- a deliberately-broken twin (the CREDITS store lands the wrong
 *      value) must be CAUGHT: NOT-EQUAL, naming 0x6001.
 *
 *   4. BRANCH/VALUE COVERAGE -- sub_0977 is fully straight-line (ONE path), but
 *      the stored byte and flags are data-dependent on CREDITS through the
 *      add-0x99 + daa BCD-decrement idiom. Each of several CREDITS values
 *      (including the 0x00 -> 0x99 wrap and a non-canonical byte) is proven EQUAL
 *      in full RAM + registers + pc, AND the branch's CYCLE TOTAL is asserted
 *      equal to the oracle's -- the teeth for the collapsed-cycle total on the
 *      one path.
 *
 * THE CYCLE FINDING: sub_0977 is ATOMIC (its only call path runs inside the NMI
 * with the mask cleared, and the NMI handler never spans a frame boundary, so no
 * state is sampled mid-routine and no nested NMI fires). Its per-instruction
 * m.step charges therefore collapse to one per-branch total (45t leading + 17t
 * CALL folded into m.step(0x309f,62), + 10t ret = 72t), and it stays EQUAL. The
 * total is still load-bearing -- a variant that STRIPS the charges diverges at
 * stack 0x6BEA, frame 17 -- so the collapse preserves it exactly.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { sub_0977 as translated_0977 } from "../../translated/state0.js";
import { sub_0977 as optimized_0977 } from "../sub_0977.js";
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

const TARGET = 0x0977;
const FRAMES = 30; // sub_0977 fires once, at frame 17 (see below)
const FIRE_FRAME = 17;

// Coin + 1-player start, early_start timing. The 1P arm (loc_0906) calls sub_0977
// exactly once. Applied identically to baseline and optimized by the factory.
const TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // IN2 bit7 = coin1
  { port: 0x7d00, bits: 0x04, frame: 16, dur: 6 }, // IN2 bit2 = start1 (1-player)
];

// Same construction as harness.js's dkMachineFactory, plus the input tape --
// which the standard wrappers cannot attach (it is set post-construction).
function makeMachine(overrides) {
  const mm = new Machine(ROM, overrides ? { overrides } : {});
  mm.inputTape = TAPE;
  return mm;
}

// The routine's own output store is CREDITS (0x6001). A wrong value there is the
// representative "wrong value to one of the routine's own output addresses" bug.
const BROKEN_ADDR = 0x6001;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x6001 lands a wrong value (correct byte XOR 0xFF, guaranteed to
 * differ). Every subroutine it calls still runs verbatim.
 */
function broken_0977(m) {
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
    return optimized_0977(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0977 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0977]]));

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
      `override fired ${r.invocations.get(TARGET)}x (at frame ${FIRE_FRAME})`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0977 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0977, optimized_0977, { maxFrames: 40 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, H) + pc identical");
});

// -- BRANCH / VALUE COVERAGE --------------------------------------------------

test("COVERAGE (synthesised): BCD-decrement + flags + cycle total EQUAL across CREDITS values", () => {
  // Capture a pristine entry to sub_0977 from the driven run, then replay it with
  // CREDITS forced to each interesting value on independent clones.
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0977(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = TAPE;
  host.runFrames(40);
  assert.ok(entry !== null, "sub_0977 was never entered within the driven run");

  // 0x01->0x00, 0x00->0x99 wrap, mid values, 0x99 max, 0x1f/0x9a non-canonical BCD.
  const cases = [0x00, 0x01, 0x02, 0x10, 0x50, 0x99, 0x1f, 0x9a];
  for (const cr of cases) {
    const a = entry.clone();
    const b = entry.clone();
    a.mem.write8(0x6001, cr);
    b.mem.write8(0x6001, cr);
    const aStart = a.cycles, bStart = b.cycles;
    translated_0977(a);
    optimized_0977(b);

    const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.regs, b.regs);
    assert.equal(ram, null, ram ? `cr=0x${cr.toString(16)}: RAM diff at 0x${(ram.addr ?? 0).toString(16)} (${ram.a} vs ${ram.b})` : "");
    assert.equal(regs, null, regs ? `cr=0x${cr.toString(16)}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
    assert.equal(a.pc, b.pc, `cr=0x${cr.toString(16)}: pc diff`);
    // The collapsed branch's TOTAL cycle cost must match the oracle's exactly.
    assert.equal(
      b.cycles - bStart,
      a.cycles - aStart,
      `cr=0x${cr.toString(16)}: cycle total diverged (opt ${b.cycles - bStart} vs oracle ${a.cycles - aStart})`,
    );
  }
  console.log(`  COVERAGE: ${cases.length} CREDITS values -- RAM + regs + pc + cycle total all EQUAL`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong CREDITS store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0977]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong CREDITS store is CAUGHT and names 0x6001", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0977, broken_0977, { maxFrames: 40 });

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
