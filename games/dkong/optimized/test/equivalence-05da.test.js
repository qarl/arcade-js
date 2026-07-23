// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for tail_05da (the shared two-instruction tail of
 * handler_05c6: `ld de,0x60ba` / `jp 0x0578`, re-render the high score). It is a
 * LEAF reached only via m.call(0x05da) — from handler_05c6's payload-2 arm and
 * from entry_051c's 0x055C tail jump — never a dispatch target, so the whole-
 * machine override fires THROUGH those callers (their oracle bodies call 0x05da).
 *
 * Four jobs:
 *
 *   1. EQUAL -- the idiomatic optimized tail_05da (optimized/tail_05da.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override at
 *      0x05da resolves through the registry at CONSTRUCTION, so it reaches this
 *      m.call-only leaf (not just dispatch points).
 *
 *   2. DISPATCH -- the override must actually run, or EQUAL is vacuous. tail_05da is
 *      entered when handler_05c6 dispatches with payload 2 (the high-score arm),
 *      which happens at frame 5 from boot — the same frame the 05c6 gate observes.
 *      A 30-frame window covers it.
 *
 *   3. TEETH -- tail_05da has NO store of its own; its entire contract is "put the
 *      RIGHT pointer in DE so the RIGHT score renders." So the representative bug is
 *      a WRONG pointer: a broken twin that loads DE=0x60B2 (P1_SCORE) instead of
 *      0x60BA (HIGH_SCORE MSB) makes draw_0578 render the wrong bytes into the
 *      high-score VRAM cells. That divergence MUST be caught, whole-machine and unit,
 *      naming a VRAM address.
 *
 *   4. BRANCH COVERAGE -- tail_05da is STRAIGHT-LINE: no data-dependent branch, no
 *      loop, one exit. The single natural/driven path IS full coverage; there is no
 *      unreached arm to synthesise. (Atomicity is per-instruction — see the routine
 *      header — so there is no collapsed branch whose cycle total needs its own teeth.)
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { tail_05da as translated_05da } from "../../translated/mainloop.js";
import { tail_05da as optimized_05da } from "../tail_05da.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x05da;
const FRAMES = 30; // tail_05da first fires at frame 5 (handler_05c6 payload 2)
const VRAM_LO = 0x7400; // tilemap RAM 0x7400-0x77FF — where draw_0578 renders
const VRAM_HI = 0x77ff;

/**
 * Deliberately-broken twin: behaviourally the optimized tail EXCEPT it loads the
 * WRONG pointer into DE (0x60B2 = P1_SCORE) instead of 0x60BA (HIGH_SCORE MSB).
 * The callee draw_0578 then renders from the wrong source region into the high-
 * score display cells — the representative "wrong pointer, wrong render" bug for a
 * routine whose whole job is choosing that pointer. Per-instruction steps are kept
 * identical so ONLY the pointer differs.
 */
function broken_05da(m) {
  const { regs } = m;
  regs.de = 0x60b2; // WRONG: should be 0x60ba
  m.step(0x05dd, 10);
  m.step(0x0578, 10);
  return m.call(0x0578);
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized tail_05da matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_05da]]));

  // The override must actually have run through a caller, or EQUAL would be vacuous.
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

test("EQUAL (unit): idiomatic optimized tail_05da matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_05da, optimized_05da);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong DE pointer (wrong score rendered) is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_05da]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong DE pointer — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong DE pointer is CAUGHT and names a VRAM cell", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_05da, broken_05da);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong DE pointer — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.ok(
    r.ram.addr >= VRAM_LO && r.ram.addr <= VRAM_HI,
    `expected the first diff in tilemap VRAM 0x${VRAM_LO.toString(16)}-0x${VRAM_HI.toString(16)}, ` +
      `got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
