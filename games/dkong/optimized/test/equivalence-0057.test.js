// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0057 -- the PRNG accumulator, run once per
 * vblank: RANDOM(0x6018) += FRAME(0x601A) + SPIN_COUNT(0x6019).
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized sub_0057 reads EQUAL
 *      against its translated oracle every frame. sub_0057 is called from the
 *      vblank NMI handler (entry_0066 @ ROM 0x00B9), so the override dispatches
 *      EVERY frame from boot -- no input driving needed.
 *
 *   2. EQUAL (unit) -- optimized == translated in RAM + the whole register file
 *      (incl. F and HL) + pc, on the captured entry state.
 *
 *   3. TEETH (whole-machine) -- a wrong write to RANDOM (0x6018) is CAUGHT. The
 *      seed feeds forward (RANDOM += ...), so one wrong byte diverges and stays
 *      diverged; the gate must report NOT-EQUAL naming an address.
 *
 *   4. TEETH (unit) -- the same wrong write is caught and names 0x6018 exactly.
 *
 *   5. ARITHMETIC + CYCLES (synthesised) -- sub_0057 has NO data-dependent
 *      branches (one straight-line path), so the natural run above already
 *      exercises "the" branch. This test instead pins the two things the
 *      per-routine brief flags as load-bearing on that single path: the WRAPPING
 *      8-bit sum + its Z80 add-flags, and the TOTAL cycle cost (70t). It seeds
 *      RANDOM/FRAME/SPIN_COUNT to carry/half-carry/zero/sign edge values, runs
 *      oracle vs optimized on independent clones, and asserts RAM+regs+pc EQUAL,
 *      the stored RANDOM == (r+f+s)&0xff, and that BOTH sides charge the same
 *      70t total -- so a wrong sum, a wrong residual flag, or a wrong total has
 *      teeth even though no whole-machine trajectory happens to stress the wrap.
 *
 * WHY PER-INSTRUCTION (not collapsed): atomicity is per-call-path, and sub_0057
 * is reached via m.call from MAIN-LOOP object logic (entry_2c41, sub_2523,
 * loc_2ea7, sub_306f) where the NMI mask is ENABLED, as well as from the NMI
 * handler. The vblank NMI can fire between its instructions on the main-loop
 * paths, so its cycle distribution is NOT free (a collapse would move a
 * mid-routine NMI's pushed PC + the live HL/A in diffed stack RAM). The charges
 * are kept one-per-instruction; see optimized/sub_0057.js for the full argument.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0057 as translated_0057 } from "../../translated/nmi.js";
import { sub_0057 as optimized_0057 } from "../sub_0057.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";
import { RANDOM, FRAME, SPIN_COUNT } from "../ram.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0057;
const FRAMES = 30; // sub_0057 fires every vblank; a short window is plenty.

// sub_0057's sole output store is RANDOM (0x6018), in the diffed work-RAM span.
const BROKEN_ADDR = RANDOM; // 0x6018

/**
 * Deliberately-broken twin: the optimized handler EXCEPT its store to RANDOM
 * lands a wrong value (correct byte XOR 0xFF, always different). Every dispatch
 * breaks its own write, so RANDOM diverges from frame 1 and never recovers.
 */
function broken_0057(m) {
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
    return optimized_0057(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0057 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0057]]));

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

test("EQUAL (unit): idiomatic optimized sub_0057 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0057, optimized_0057);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, HL) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong RANDOM store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0057]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong RANDOM store is CAUGHT and names 0x6018", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0057, broken_0057);

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

// -- ARITHMETIC + CYCLES (synthesised single path) ----------------------------

/** Capture the pristine machine state at sub_0057's first entry (the NMI call). */
function captureEntry(maxFrames = FRAMES) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0057(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error("sub_0057 never entered — cannot synthesise");
  return entry;
}

test("ARITHMETIC + CYCLES: wrap/flags/total match on carry/zero/sign edge seeds", () => {
  const entry = captureEntry();
  const TOTAL = 70; // 13+10+7+10+7+13 body + 10 ret

  // [RANDOM, FRAME, SPIN_COUNT] seeds exercising: first-add wrap+carry, second-
  // add wrap+carry, zero result (Z), sign (S), half-carry, and a plain case.
  const CASES = [
    [0xff, 0x01, 0x01], // 0xFF+1 -> 0x00 (carry), +1 -> 0x01
    [0x00, 0x00, 0x00], // all zero -> 0x00, Z set
    [0x80, 0x80, 0x00], // 0x80+0x80 -> 0x00 (carry/overflow), +0 -> 0x00
    [0x7f, 0x01, 0x00], // half-carry -> 0x80, sign set
    [0xaa, 0x55, 0x01], // 0xAA+0x55 -> 0xFF, +1 -> 0x00 (carry on 2nd add)
    [0x12, 0x34, 0x05], // plain -> 0x4B
  ];

  for (const [rnd, frm, spn] of CASES) {
    const seed = entry.clone();
    seed.mem.write8(RANDOM, rnd);
    seed.mem.write8(FRAME, frm);
    seed.mem.write8(SPIN_COUNT, spn);

    const a = seed.clone(); // oracle
    const b = seed.clone(); // optimized

    const ca = a.cycles; translated_0057(a); const dA = a.cycles - ca;
    const cb = b.cycles; optimized_0057(b); const dB = b.cycles - cb;

    const label = `r=0x${rnd.toString(16)} f=0x${frm.toString(16)} s=0x${spn.toString(16)}`;

    const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    assert.equal(ram, null, ram ? `[${label}] RAM diff at 0x${(ram.addr ?? 0).toString(16)}` : "");

    const rd = firstRegDiff(a.regs, b.regs);
    assert.equal(rd, null, rd ? `[${label}] reg diff at ${rd.reg}: 0x${(rd.a ?? 0).toString(16)} vs 0x${(rd.b ?? 0).toString(16)}` : "");

    assert.equal(a.pc, b.pc, `[${label}] pc must match`);

    // The arithmetic itself: wrapping 8-bit sum stored back to RANDOM.
    const want = (rnd + frm + spn) & 0xff;
    assert.equal(b.mem.read8(RANDOM), want, `[${label}] RANDOM should be (r+f+s)&0xff = 0x${want.toString(16)}`);

    // The total cycle cost is load-bearing (reseeds the PRNG via the spin count);
    // both sides must charge exactly 70t on the single path.
    assert.equal(dA, TOTAL, `[${label}] oracle total should be ${TOTAL}t, got ${dA}`);
    assert.equal(dB, TOTAL, `[${label}] optimized total should be ${TOTAL}t, got ${dB}`);
  }
  console.log(`  ARITH/cycles: ${CASES.length} edge seeds — wrap+flags+pc EQUAL, both charge 70t`);
});
