// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for draw_056b (ROM 0x056B): pick the score's VRAM
 * tilemap column from A, then tail-join the BCD renderer draw_0578.
 *
 * draw_056b is a LEAF reached only via `m.call(0x056b)` from two MAIN-LOOP tasks
 * (entry_051c @0x053B, handler_05c6 @0x05D7). Being main-loop-reached it is
 * NON-ATOMIC, so its cycle charges are kept PER-INSTRUCTION (optimized/draw_056b.js
 * header explains why: a mid-routine NMI would push a different PC/F if the
 * charges were collapsed). These tests prove the idiomatic rewrite is byte-equal
 * to its oracle anyway.
 *
 * Jobs:
 *   1. EQUAL (whole-machine) — the idiomatic draw_056b reads EQUAL against its
 *      oracle every frame; the override must actually fire (it dispatches once,
 *      at frame 5, drawing the P1 score in attract).
 *   2. EQUAL (unit) — RAM + all registers (incl. F) + pc identical on the
 *      NATURAL entry (A == 0, the P1 / Z-branch).
 *   3. BRANCH COVERAGE — the natural run only exercises A == 0. The A != 0
 *      (P2 / not-Z, IX = 0x7521) branch is SYNTHESISED by cloning the captured
 *      entry and forcing A, then diffing oracle vs optimized RAM+regs+pc. Both
 *      branches are asserted EQUAL. (No branch is collapsed, so no per-branch
 *      cycle-total assertion is owed — but the test measures cycles anyway and
 *      asserts each branch's total matches the oracle, as belt-and-braces.)
 *   4. TEETH (whole + unit) — a deliberately-broken twin whose first VRAM store
 *      (the P1 score's first digit at 0x7781) lands a wrong value must be CAUGHT.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { draw_056b as translated_056b } from "../../translated/mainloop.js";
import { draw_056b as optimized_056b } from "../draw_056b.js";
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

const TARGET = 0x056b;
const FRAMES = 30; // draw_056b fires exactly once, at frame 5

// The first store on the routine's rendered path is the P1 score's most-
// significant digit, written by sub_0593 (reached through draw_0578 -> loop_0583)
// to VRAM 0x7781 -- inside the compared state dump (video RAM 0x7400-0x77FF).
// draw_056b fires only at frame 5, so the corrupted cell is not rewritten and
// the diff persists. (0x7781 is the P1 column base; A==0 selects it.)
const BROKEN_ADDR = 0x7781;

/**
 * Deliberately-broken twin: behaviourally the optimized draw_056b EXCEPT the
 * first store to 0x7781 lands a wrong value (correct char XOR 0xFF, guaranteed
 * to differ). Every other write — and every subroutine it tail-joins — runs
 * verbatim, so this is the representative "wrong value to one of the routine's
 * own output cells" bug the gate must catch.
 */
function broken_056b(m) {
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
    return optimized_056b(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// Capture the pristine machine at the first entry of draw_056b, so a branch the
// natural run does not reach can be SYNTHESISED by cloning it and forcing A.
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_056b(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(FRAMES);
  assert.ok(entry !== null, `draw_056b never entered within ${FRAMES} frames`);
  return entry;
}

// Measure the T-states one implementation charges across a single run on `base`
// (with A forced to `aVal`), and return { cycles, machine } for a state diff.
function runBranch(base, aVal, fn) {
  const mm = base.clone();
  mm.regs.a = aVal;
  const before = mm.cycles;
  fn(mm);
  return { cycles: mm.cycles - before, machine: mm };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized draw_056b matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_056b]]));

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

test("EQUAL (unit): idiomatic optimized draw_056b matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_056b, optimized_056b);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (natural entry, A==0)");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

test("BRANCH COVERAGE: both A==0 (P1/0x7781) and A!=0 (P2/0x7521) columns prove EQUAL", () => {
  const entry = captureEntry();
  const oracleDumps = {}; // keep each branch's oracle dump to prove they diverge

  for (const [label, aVal, colCell] of [
    ["A==0 (Z taken, P1 column)", 0x00, 0x7781],
    ["A!=0 (Z not taken, P2 column)", 0x01, 0x7521],
  ]) {
    const oracle = runBranch(entry, aVal, translated_056b);
    const opt = runBranch(entry, aVal, optimized_056b);

    const ram = firstStateDiff(
      oracle.machine.dumpState(),
      opt.machine.dumpState(),
      (off) => oracle.machine.stateOffsetToAddr(off),
    );
    const regs = firstRegDiff(oracle.machine.regs, opt.machine.regs);

    assert.equal(ram, null, ram ? `${label}: RAM diff at 0x${ram.addr.toString(16)}` : "");
    assert.equal(regs, null, regs ? `${label}: reg diff at ${regs.reg}` : "");
    assert.equal(oracle.machine.pc, opt.machine.pc, `${label}: pc must match`);
    // Not required (no branch is collapsed), but assert the totals match the
    // oracle so a mistaken cycle change on either branch has teeth too.
    assert.equal(opt.cycles, oracle.cycles, `${label}: cycle total must match the oracle`);
    // Sanity: this branch really rendered into ITS column base cell (draw_0578
    // walks IX away from the base afterwards, so read the tilemap cell itself,
    // not IX). The oracle and optimized read identical here already, so read
    // from the optimized machine.
    assert.equal(
      opt.machine.mem.read8(colCell),
      oracle.machine.mem.read8(colCell),
      `${label}: column base cell 0x${colCell.toString(16)} must match the oracle`,
    );
    oracleDumps[aVal] = oracle.machine.dumpState();
    console.log(`  BRANCH ${label}: EQUAL (RAM+regs+pc), ${opt.cycles} T on both sides`);
  }

  // The two branches must genuinely diverge, or "coverage" is an illusion: A==0
  // draws into the P1 column region and A!=0 into the P2 column region.
  const branchesDiffer = firstStateDiff(oracleDumps[0x00], oracleDumps[0x01]);
  assert.ok(
    branchesDiffer != null,
    "the A==0 and A!=0 branches produced identical memory — they were not both exercised",
  );
  console.log(
    `  BRANCH divergence confirmed: A==0 vs A!=0 dumps differ at offset ${branchesDiffer.offset}`,
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong score-digit store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_056b]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong score-digit store is CAUGHT and names 0x7781", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_056b, broken_056b);

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
