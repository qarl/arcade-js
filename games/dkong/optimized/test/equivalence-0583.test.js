// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loop_0583 (expand packed-BCD bytes into on-screen
 * digits). ROM 0x0583-0x0592. A shared loop with three entry points: draw_0578 /
 * draw_056b fall in with B = 3 (a 3-byte score), and sub_0616 TAIL-JUMPS in with
 * B = 1 (the single credits byte). It is reached only via `m.call` / a tail jump,
 * never as a dispatch target — the construction-time override the harness installs
 * resolves those `m.call`s, so the standard `unitEquivalence` reaches it.
 *
 * Jobs:
 *   1. EQUAL (whole-machine) -- optimized loop_0583 reads EQUAL against its oracle
 *      every frame. The natural boot run dispatches it 3x within 10 frames with
 *      B = [3, 3, 1], so the whole-machine gate exercises BOTH the loop-many (B=3,
 *      score) and loop-once (B=1, credits) paths for real.
 *   2. EQUAL (unit) -- RAM + full register file (incl. F) + pc identical on the
 *      first captured entry (B = 3).
 *   3. BRANCH COVERAGE (unit, synthesised) -- loop 1 (immediate djnz-exit) / 2 / 3
 *      each proven EQUAL, with cycle TOTALS also asserted equal. The B = 0 -> 256
 *      djnz-WRAP edge is EXEMPT: it never occurs (every caller passes B = 1 or 3)
 *      and cannot be synthesised — the digit pointer (IX stepping -32 per digit)
 *      walks out of mapped VRAM after ~90 trips and BOTH impls throw the same
 *      UnmappedAccess, so it exercises the memory map, not equivalence.
 *   4. TEETH (whole + unit) -- a deliberately-broken twin (the routine's first
 *      digit store, done by its callee sub_0593 at (IX) = 0x7641, lands the wrong
 *      value) must be CAUGHT and name the address.
 *
 * THE CYCLE DECISION this routine records: loop_0583 keeps its charges PER-
 * INSTRUCTION (NOT collapsed). It is NOT atomic on either call path — reached via
 * sub_0616's tail jump on the same frame-6 chain that INTERRUPTS handler_05e9
 * mid-loop, and as an in-game main-loop task (handler_05c6), where the data-
 * dependent djnz (256 trips if entered with B = 0) is long enough for the NMI to
 * land inside. A per-ITERATION collapse happens to stay EQUAL over the short
 * attract run here (the NMI lands in handler_05e9, not loop_0583, on those
 * trajectories) — but per README §2 / the brief that is NOT proof of atomicity,
 * so the per-instruction charges are retained (same call as handler_05e9's
 * sibling loop and the sub_0020/loc_197a precedent). Per-instruction reads EQUAL
 * everywhere, which is what is committed below.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loop_0583 as translated_0583 } from "../../translated/mainloop.js";
import { loop_0583 as optimized_0583 } from "../loop_0583.js";
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

const TARGET = 0x0583;
const FRAMES = 30; // loop_0583 dispatches 3x within 10 frames (B = [3, 3, 1])

// The routine's first digit store is done by its callee sub_0593 to (IX): the
// first dispatch is the high-score draw (draw_0578, IX = 0x7641), so the first
// write lands at VRAM 0x7641 — inside the compared dump (video RAM 0x7400-0x77FF).
const BROKEN_ADDR = 0x7641;

/**
 * Deliberately-broken twin: behaviourally optimized_0583 EXCEPT the first store
 * to 0x7641 (made inside sub_0593) lands a wrong value (correct XOR 0xFF, so it
 * always differs). Breaking exactly one of the routine's own output writes and
 * letting everything else — including every sub_0593 call — run verbatim is the
 * representative "wrong value to an output address" defect the gate must catch.
 */
function broken_0583(m) {
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
    return optimized_0583(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// Capture the pristine machine state at loop_0583's first entry (reached via
// m.call / tail jump), for the synthesised-branch coverage below.
function captureEntry(maxFrames = FRAMES) {
  let entry = null;
  const snap = (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0583(mm); // let the host run proceed to a clean stop
  };
  const m = new Machine(ROM, { overrides: new Map([[TARGET, snap]]) });
  m.runFrames(maxFrames);
  if (entry === null) {
    throw new Error(`loop_0583 never dispatched within ${maxFrames} frames`);
  }
  return entry;
}

// Run one impl on a clone of the captured entry with B forced to `bVal`, counting
// the total cycles it charges (its own m.step + those of every callee).
function runWithB(entry, implFn, bVal) {
  const c = entry.clone();
  c.regs.b = bVal;
  let cyc = 0;
  const realStep = c.step.bind(c);
  c.step = (addr, t) => { cyc += t; return realStep(addr, t); };
  implFn(c);
  c.step = realStep;
  return { machine: c, cyc };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loop_0583 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0583]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (natural B = [3, 3, 1]: loop-many + loop-once)`,
  );
});

test("EQUAL (unit): idiomatic optimized loop_0583 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0583, optimized_0583);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, HL, IX) + pc identical (natural B = 3)");
});

// -- BRANCH COVERAGE (synthesised) --------------------------------------------

test("BRANCH COVERAGE (unit): loop 1 / 2 / 3 all EQUAL incl. cycle totals", () => {
  const entry = captureEntry();
  // B = 1 exercises the djnz taken=NO (immediate exit) branch; B = 2 and 3
  // exercise djnz taken=YES then not-taken (loop-many). The B = 0 -> 256 wrap is
  // exempt (see the file header): unreachable in the ROM and un-synthesisable
  // (the -32 digit pointer leaves mapped VRAM, both impls throw identically).
  const cases = [
    { b: 1, label: "1 (loop-once, credits)" },
    { b: 2, label: "2 (loop-twice)" },
    { b: 3, label: "3 (loop-many, score)" },
  ];
  for (const { b, label } of cases) {
    const a = runWithB(entry, translated_0583, b);
    const o = runWithB(entry, optimized_0583, b);
    const ram = firstStateDiff(a.machine.dumpState(), o.machine.dumpState(), (off) => a.machine.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.machine.regs, o.machine.regs);
    assert.equal(ram, null, ram ? `B=${label}: RAM diff at 0x${(ram.addr ?? 0).toString(16)} (${ram.a} vs ${ram.b})` : "");
    assert.equal(regs, null, regs ? `B=${label}: reg diff at ${regs && regs.reg}` : "");
    assert.equal(a.machine.pc, o.machine.pc, `B=${label}: pc must match`);
    assert.equal(o.cyc, a.cyc, `B=${label}: cycle total must match (oracle ${a.cyc} vs optimized ${o.cyc})`);
  }
  // Report the totals for the record (per-instruction, so optimized == oracle).
  const t = (b) => runWithB(entry, translated_0583, b).cyc;
  console.log(
    `  BRANCH/unit: B=1 ${t(1)}t, B=2 ${t(2)}t, B=3 ${t(3)}t (+185t/trip) ` +
      "— each EQUAL (RAM+regs+pc) and cycle-total-equal oracle vs optimized",
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong digit store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0583]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong digit store is CAUGHT and names 0x7641", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0583, broken_0583);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
