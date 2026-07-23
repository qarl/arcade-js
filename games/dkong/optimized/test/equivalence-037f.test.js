// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_037f -- the per-frame DIFFICULTY recompute,
 * behind two nested rate dividers:
 *   DIFFICULTY(0x6380) := min(LEVEL(0x6229) + (DIFFICULTY_CLOCK(0x6381) >> 3), 5)
 * gated so it runs once every 256 frames (DIFFICULTY_PRESCALER 0x6384) AND only
 * every 8th such tick (DIFFICULTY_CLOCK & 7 == 0).
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized sub_037f reads EQUAL
 *      against its translated oracle every frame. sub_037f is called once per
 *      serviced frame from mainLoop (ROM 0x02DB `call 0x037f`), so the override
 *      dispatches every serviced frame from boot -- no input driving needed.
 *
 *   2. EQUAL (unit) -- optimized == translated in RAM + the whole register file
 *      (incl. F, B, HL) + pc, on the captured entry state (which is the first
 *      natural entry: frame 5, branch C -- both counters 0, LEVEL 1).
 *
 *   3. TEETH (whole-machine) -- a wrong write to DIFFICULTY_PRESCALER (0x6384,
 *      stored EVERY call) is CAUGHT. The prescaler feeds itself forward, so one
 *      wrong byte diverges and stays diverged; the gate must report NOT-EQUAL
 *      naming an address.
 *
 *   4. TEETH (unit) -- the same wrong write is caught and names 0x6384 exactly.
 *
 *   5. BRANCH COVERAGE + CYCLES (synthesised) -- sub_037f has FOUR data-dependent
 *      exit paths; the natural run above reaches only two of them (C-keep once at
 *      frame 5, then A forever), so B and the C clamp arm are synthesised. Each
 *      branch is seeded on a clone of the captured entry, run oracle vs optimized,
 *      and asserted EQUAL in RAM+regs+pc AND charging the SAME per-branch cycle
 *      total (A 43t, B 87t, C-keep 160t, C-clamp 162t) -- so a wrong value, a
 *      wrong residual flag, OR a wrong per-instruction total on any arm has teeth,
 *      even the arms no short whole-machine trajectory stresses.
 *
 * WHY PER-INSTRUCTION (not collapsed): atomicity is per-call-path. sub_037f's
 * ONLY caller is mainLoop (ROM 0x02DB), which runs with the vblank NMI mask
 * ENABLED, so the NMI CAN land between its instructions -- it is NOT atomic. A
 * cycle collapse would move a mid-routine NMI's pushed PC / the F it stacks into
 * diffed work RAM, so the charges are kept one-per-instruction (each branch's
 * TOTAL and internal distribution both match). A short whole-machine run that
 * happens not to interrupt these ~43-162 T-states would NOT prove a collapse
 * safe; see optimized/sub_037f.js for the full argument.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_037f as translated_037f } from "../../translated/mainloop.js";
import { sub_037f as optimized_037f } from "../sub_037f.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";
import { DIFFICULTY, DIFFICULTY_CLOCK, DIFFICULTY_PRESCALER, LEVEL } from "../ram.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x037f;
const FRAMES = 30; // sub_037f fires every serviced frame; a short window is plenty.

// sub_037f stores DIFFICULTY_PRESCALER (0x6384) on EVERY call, in the diffed
// work-RAM span -- the always-written output to corrupt for the teeth tests.
const BROKEN_ADDR = DIFFICULTY_PRESCALER; // 0x6384

/**
 * Deliberately-broken twin: the optimized handler EXCEPT its first store to
 * 0x6384 lands a wrong value (correct byte XOR 0xFF, always different). The
 * prescaler feeds itself forward (each call reads it back), so 0x6384 diverges
 * and never recovers.
 */
function broken_037f(m) {
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
    return optimized_037f(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_037f matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_037f]]));

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

test("EQUAL (unit): idiomatic optimized sub_037f matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_037f, optimized_037f);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, B, HL) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong DIFFICULTY_PRESCALER store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_037f]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong DIFFICULTY_PRESCALER store is CAUGHT and names 0x6384", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_037f, broken_037f);

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

// -- BRANCH COVERAGE + CYCLES (synthesised) -----------------------------------

/** Capture the pristine machine state at sub_037f's first entry (frame 5, branch C). */
function captureEntry(maxFrames = FRAMES) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_037f(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error("sub_037f never entered — cannot synthesise");
  return entry;
}

test("BRANCH COVERAGE + CYCLES: all four exit paths match RAM+regs+pc and per-branch total", () => {
  const entry = captureEntry();

  // Each case forces one exit path by seeding the two counters (and LEVEL). `poke`
  // is applied identically to both the oracle and optimized clones. `total` is the
  // oracle's per-instruction T-state sum along that branch (independently checked
  // against BOTH sides). `want` is the DIFFICULTY value the C paths must store.
  const CASES = [
    // Branch A: prescaler != 0 -> `ret nz` at 0x0385. No recompute; 0x6380 untouched.
    { name: "A (prescaler!=0)", poke: [[DIFFICULTY_PRESCALER, 5]], total: 43, want: null },
    // Branch B: prescaler == 0 but (clock & 7) != 0 -> `ret nz` at 0x038e. No recompute.
    { name: "B (clock&7!=0)", poke: [[DIFFICULTY_PRESCALER, 0], [DIFFICULTY_CLOCK, 3]], total: 87, want: null },
    // Branch C-keep: both gates pass, LEVEL + (clock>>3) < 5 -> `jr c` taken, keep A.
    { name: "C-keep lvl1", poke: [[DIFFICULTY_PRESCALER, 0], [DIFFICULTY_CLOCK, 0], [LEVEL, 1]], total: 160, want: 1 },
    // Branch C-keep at the boundary A==4 (< 5, still kept): clock 0x18>>3=3, +1 = 4.
    { name: "C-keep A=4", poke: [[DIFFICULTY_PRESCALER, 0], [DIFFICULTY_CLOCK, 0x18], [LEVEL, 1]], total: 160, want: 4 },
    // Branch C-clamp via LEVEL: 5 + 0 = 5 -> `jr c` NOT taken, clamp to 5.
    { name: "C-clamp lvl5", poke: [[DIFFICULTY_PRESCALER, 0], [DIFFICULTY_CLOCK, 0], [LEVEL, 5]], total: 162, want: 5 },
    // Branch C-clamp via the shift: clock 0x20>>3=4, +1 = 5 -> clamp to 5.
    { name: "C-clamp shift", poke: [[DIFFICULTY_PRESCALER, 0], [DIFFICULTY_CLOCK, 0x20], [LEVEL, 1]], total: 162, want: 5 },
  ];

  for (const { name, poke, total, want } of CASES) {
    const seed = entry.clone();
    for (const [addr, val] of poke) seed.mem.write8(addr, val);

    const a = seed.clone(); // oracle
    const b = seed.clone(); // optimized

    const ca = a.cycles; translated_037f(a); const dA = a.cycles - ca;
    const cb = b.cycles; optimized_037f(b); const dB = b.cycles - cb;

    const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    assert.equal(ram, null, ram ? `[${name}] RAM diff at 0x${(ram.addr ?? 0).toString(16)} (oracle ${ram.a} vs opt ${ram.b})` : "");

    const rd = firstRegDiff(a.regs, b.regs);
    assert.equal(rd, null, rd ? `[${name}] reg diff at ${rd.reg}: 0x${(rd.a ?? 0).toString(16)} vs 0x${(rd.b ?? 0).toString(16)}` : "");

    assert.equal(a.pc, b.pc, `[${name}] pc must match`);

    if (want !== null) {
      assert.equal(b.mem.read8(DIFFICULTY), want, `[${name}] DIFFICULTY should be ${want}`);
    }

    // Per-branch cycle total is load-bearing (observed via the main-loop spin count,
    // and it fixes where a mid-routine NMI would land). Both sides must charge it.
    assert.equal(dA, total, `[${name}] oracle total should be ${total}t, got ${dA}`);
    assert.equal(dB, total, `[${name}] optimized total should be ${total}t, got ${dB}`);
  }
  console.log(`  BRANCH/cycles: ${CASES.length} synthesised paths (A/B/C-keep/C-clamp) — RAM+regs+pc EQUAL, totals 43/87/160/162t`);
});
