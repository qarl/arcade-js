// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_06a8 (the per-frame BCD-decrement step of the
 * two-digit render value at 0x638C, reached ONLY as entry_062a branch B via
 * `m.call(0x06a8)`). loc_06a8 is a LEAF of a MAIN-LOOP task, so unlike a dispatch
 * target it is entered through a direct call, which the unit gate reaches because
 * it installs its snapshot override at CONSTRUCTION.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_06a8 (optimized/loc_06a8.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit. The override resolves
 *      through the routine registry for the m.call from entry_062a (inert when the
 *      map is empty).
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_06a8 is
 *      first m.call'd from entry_062a's branch-B decrement path at frame 587 (probed);
 *      a 600-frame window covers it once (A=0x50 -> the NZ, high-nibble arm).
 *
 *   3. BRANCH COVERAGE -- the natural run only ever takes the NZ arm (A never reaches
 *      1 in-window), so the reached-zero arm is SYNTHESISED: clone the captured entry,
 *      force A, and diff oracle vs optimized (RAM + all regs + pc + cycle total) for
 *      each of {Z arm A=1 (writes the 0x63B8 latch), NZ high-nibble A=0x50, NZ
 *      low-nibble A=0x10 (loc_066a's leading-zero-suppress arm)}.
 *
 *   4. TEETH -- a deliberately-broken twin (the store to 0x638C lands the wrong value)
 *      must be CAUGHT: NOT-EQUAL, naming 0x638C.
 *
 * THE CYCLE DECISION this routine records: loc_06a8 keeps its charges PER-INSTRUCTION,
 * NOT collapsed. Atomicity is per-call-path -- its sole caller entry_062a is a
 * MAIN-LOOP task (mask ENABLED), so the vblank NMI can in principle land between
 * loc_06a8's instructions; per the project rule a leaf reached via m.call from an
 * interruptible caller keeps per-instruction (a short attract run passing a collapse
 * is not proof the NMI never lands inside). Per-instruction is byte-identical to the
 * oracle's distribution, so the cycle-total assertion in the branch-coverage test
 * passes trivially -- it is there as teeth, not because a total was recomputed.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_06a8 as translated_06a8 } from "../../translated/mainloop.js";
import { loc_06a8 as optimized_06a8 } from "../loc_06a8.js";
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

const TARGET = 0x06a8;
const FRAMES = 600; // loc_06a8 is first m.call'd at frame 587
const MAX_FRAMES = 600; // the unit harness must run far enough to reach that entry

// loc_06a8's primary work-RAM output: the packed two-digit BCD it stores at 0x638C.
// It sits in the compared work-RAM dump (0x6000-0x6BFF); on the reached NZ arm
// loc_066a reads the value from register A (not RAM), so a corrupted store persists
// to the frame boundary and the diff stands. 0x638C is the lowest-address byte the
// routine writes on that arm, so it is also the first state-diff offset.
const BROKEN_ADDR = 0x638c;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x638C lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls (loc_066a via m.call) run verbatim -- the representative
 * "wrong value to one of the routine's own output addresses" bug the gate must catch.
 */
function broken_06a8(m) {
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
    return optimized_06a8(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Capture the pristine machine state at loc_06a8's FIRST entry, the same way the
 * unit gate does internally (snapshot override installed at construction so it
 * reaches the m.call), so the synthesised-branch test can clone a realistic entry
 * and force A to reach arms the natural run never takes.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_06a8(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(MAX_FRAMES);
  if (entry === null) {
    throw new Error(`loc_06a8 (0x${TARGET.toString(16)}) never entered within ${MAX_FRAMES} frames`);
  }
  return entry;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_06a8 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_06a8]]));

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

test("EQUAL (unit): idiomatic optimized loc_06a8 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_06a8, optimized_06a8, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (natural NZ arm)");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

test("EQUAL (unit, synthesised branches): both arms + both loc_066a tails match, cycles included", () => {
  const entry = captureEntry();

  // A=1     -> sub gives 0 -> Z arm: writes the 0x63B8 "reached zero" latch, stores 0.
  // A=0x50  -> daa 0x49 (natural), high nibble 4 -> loc_066a NON-zero tail.
  // A=0x10  -> daa 0x09, high nibble 0 -> loc_066a LEADING-ZERO-suppress tail.
  const cases = [
    { name: "Z arm (A=1, sets 0x63B8 latch)", a: 0x01 },
    { name: "NZ high-nibble arm (A=0x50)", a: 0x50 },
    { name: "NZ low-nibble arm (A=0x10, loc_066a leading-zero tail)", a: 0x10 },
  ];

  for (const c of cases) {
    const a = entry.clone();
    const b = entry.clone();
    a.regs.a = c.a;
    b.regs.a = c.a;
    const cyc0a = a.cycles;
    const cyc0b = b.cycles;
    translated_06a8(a);
    optimized_06a8(b);

    const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.regs, b.regs);
    assert.equal(ram, null, ram ? `${c.name}: RAM diff at 0x${(ram.addr ?? 0).toString(16)}` : "");
    assert.equal(regs, null, regs ? `${c.name}: reg diff at ${regs?.reg}` : "");
    assert.equal(a.pc, b.pc, `${c.name}: pc must match`);
    assert.equal(
      a.cycles - cyc0a,
      b.cycles - cyc0b,
      `${c.name}: cycle total must match (oracle ${a.cycles - cyc0a} vs optimized ${b.cycles - cyc0b})`,
    );
    console.log(`  branch OK: ${c.name} — RAM+regs+pc identical, ${b.cycles - cyc0b}t`);
  }
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x638C store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_06a8]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong 0x638C store is CAUGHT and names 0x638C", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_06a8, broken_06a8, { maxFrames: MAX_FRAMES });

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
