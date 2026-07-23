// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0689 (the shared two-digit STAMP tail of
 * loc_066a: it writes the two BCD character tiles handed to it in A and B into
 * video-RAM cells 0x74E6 and 0x74C6). loc_0689 is a LEAF reached only via
 * `m.call(0x0689)` from loc_066a, which runs only inside entry_062a — a MAIN-LOOP
 * task (task-table entry 10, dispatched by dispatchTask). The unit harness installs
 * its snapshot override at CONSTRUCTION, so it captures the entry however the leaf
 * is first reached (here: via m.call, not a dispatch point).
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_0689 (optimized/loc_0689.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_0689
 *      does not run in the boot/attract prologue; it first fires once entry_062a
 *      starts drawing the attract demo board's two-digit field (~frame 521), then a
 *      couple more times as that field is redrawn. A 700-frame window covers 3
 *      dispatches (observed A/B on entry: A in {5,4}, B in {0,9,8}).
 *
 *   3. TEETH -- a deliberately-broken twin (the first store, A -> 0x74E6, lands the
 *      wrong value) must be CAUGHT: NOT-EQUAL, naming VRAM 0x74E6.
 *
 *   4. INPUT/CYCLE COVERAGE -- loc_0689 is straight-line (NO data-dependent branch),
 *      so its single path is proven across a spread of register inputs the natural
 *      run doesn't all reach -- including the loc_066a leading-zero-suppress arm's
 *      A = 0x10 register state and arbitrary F -- each EQUAL in RAM+regs+pc, and each
 *      side charging the same 40t per-instruction total.
 *
 * CYCLE DECISION: PER-INSTRUCTION, not collapsed. loc_0689 is a leaf on a MAIN-LOOP
 * call path (entry_062a task 10 -> loc_066a -> loc_0689), so per the brief's
 * ATOMICITY-IS-PER-CALL-PATH rule the per-instruction charges stay — the collapse
 * win on a 3-charge routine is nil and per-instruction is always correct. Whole-
 * machine EQUAL over 700 frames confirms the totals; the two stores are VIDEO RAM
 * (not 0x7Dxx latches) so they carry no write-trace bus-cycle constraint.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0689 as translated_0689 } from "../../translated/mainloop.js";
import { loc_0689 as optimized_0689 } from "../loc_0689.js";
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

const TARGET = 0x0689;
const FRAMES = 700; // loc_0689 first fires ~frame 521; 700 covers 3 dispatches
const MAX_FRAMES = 700; // the unit harness must run far enough to reach the first entry

// loc_0689's first output store: A -> VRAM cell 0x74E6 (video RAM 0x7400-0x77FF, in
// the compared state dump). It is written once per dispatch and the display cell is
// not read back by CPU logic, so a corrupted store persists to the frame dump.
const BROKEN_ADDR = 0x74e6;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x74E6 lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine run
 * verbatim -- the representative "wrong value to one of the routine's own output
 * addresses" bug the gate must catch.
 */
function broken_0689(m) {
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
    return optimized_0689(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// Capture the machine at loc_0689's first entry (reached via m.call from loc_066a),
// exactly as the unit harness does, so the input-coverage test can re-run the
// routine on clones with synthesised register inputs.
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0689(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(MAX_FRAMES);
  if (entry === null) {
    throw new Error(`loc_0689 never entered within ${MAX_FRAMES} frames`);
  }
  return entry;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0689 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0689]]));

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

test("EQUAL (unit): idiomatic optimized loc_0689 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0689, optimized_0689, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x74E6 stamp is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0689]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong 0x74E6 stamp is CAUGHT and names 0x74E6", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0689, broken_0689, { maxFrames: MAX_FRAMES });

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

// -- INPUT + CYCLE COVERAGE ---------------------------------------------------

test("INPUT COVERAGE + CYCLES: the single path matches RAM+regs+pc and the 40t total across register inputs", () => {
  const entry = captureEntry();

  // loc_0689 has no data-dependent branch — one path — so "coverage" here is a
  // spread of register inputs (A = first tile, B = second tile, F = incoming flags
  // it must pass through untouched). Each is applied identically to both clones.
  // TOTAL is the oracle's per-instruction T-state sum: 13 + 4 + 13 + 10(ret) = 40t,
  // independently checked against BOTH sides.
  const TOTAL = 40;
  const CASES = [
    // Natural first-fire register state (high nibble nonzero arm).
    { name: "A=5,B=0 (natural)", a: 0x05, b: 0x00, f: 0x14 },
    // Second natural fire.
    { name: "A=4,B=9 (natural)", a: 0x04, b: 0x09, f: 0x10 },
    // loc_066a leading-zero-SUPPRESS arm register state (A=0x10), never hit naturally.
    { name: "A=0x10,B=0x0a (suppress arm)", a: 0x10, b: 0x0a, f: 0x00 },
    // Extremes with A != B and an arbitrary F, to prove both stores + F pass-through.
    { name: "A=0x00,B=0xff", a: 0x00, b: 0xff, f: 0xab },
    { name: "A=0xff,B=0x00", a: 0xff, b: 0x00, f: 0x55 },
  ];

  for (const { name, a: ra, b: rb, f: rf } of CASES) {
    const seed = entry.clone();
    seed.regs.a = ra;
    seed.regs.b = rb;
    seed.regs.f = rf;

    const a = seed.clone(); // oracle
    const b = seed.clone(); // optimized

    const ca = a.cycles; translated_0689(a); const dA = a.cycles - ca;
    const cb = b.cycles; optimized_0689(b); const dB = b.cycles - cb;

    const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    assert.equal(ram, null, ram ? `[${name}] RAM diff at 0x${(ram.addr ?? 0).toString(16)} (oracle ${ram.a} vs opt ${ram.b})` : "");

    const rd = firstRegDiff(a.regs, b.regs);
    assert.equal(rd, null, rd ? `[${name}] reg diff at ${rd.reg}: 0x${(rd.a ?? 0).toString(16)} vs 0x${(rd.b ?? 0).toString(16)}` : "");

    assert.equal(a.pc, b.pc, `[${name}] pc must match`);

    // The two output cells must hold exactly the two input tiles, in order.
    assert.equal(b.mem.read8(0x74e6), ra, `[${name}] 0x74E6 should hold A`);
    assert.equal(b.mem.read8(0x74c6), rb, `[${name}] 0x74C6 should hold B`);
    // F is passed through untouched (loc_0689 has no flag-affecting instruction).
    assert.equal(b.regs.f, rf, `[${name}] F must be unchanged`);

    assert.equal(dA, TOTAL, `[${name}] oracle total should be ${TOTAL}t, got ${dA}`);
    assert.equal(dB, TOTAL, `[${name}] optimized total should be ${TOTAL}t, got ${dB}`);
  }
  console.log(`  INPUT/cycles: ${CASES.length} register inputs (incl. suppress-arm A=0x10) — RAM+regs+pc EQUAL, 40t each side`);
});
