// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0a53 (seed three fixed tiles into video RAM
 * at 0x7740/0x7720/0x7700). A LEAF routine reached only via `m.call` — never a
 * dispatch target — from the two setup handlers handler_01c3 (game state 0) and
 * handler_0779 (game state 1 sub-state 0). The harness installs the snapshot
 * override at construction, so it reaches this leaf however it is entered.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- idiomatic optimized sub_0a53 reads EQUAL against
 *      its translated oracle every frame. It dispatches EXACTLY TWICE from boot
 *      (frame 5 via handler_01c3, frame 6 via handler_0779), so a 30-frame window
 *      exercises BOTH of its call paths, not just one.
 *
 *   2. EQUAL (unit) -- RAM + every register (incl. F) + pc identical.
 *
 *   3. TEETH (whole-machine) -- a wrong store to one of the routine's own cells
 *      (0x7740) is CAUGHT: NOT-EQUAL, naming the diverging VRAM address.
 *
 *   4. TEETH (unit) -- the same wrong store is caught and names 0x7740.
 *
 *   5. CYCLE TOTAL -- sub_0a53 is ATOMIC (both call paths run inside the vblank
 *      NMI's rst-0x28 dispatch, mask cleared, so the NMI cannot land inside it),
 *      so its six per-instruction m.step charges collapse to ONE 60t charge. The
 *      collapse's TOTAL is load-bearing (it feeds the NMI cost -> spin count,
 *      README §2). The whole-machine gate already has cycle teeth here (a wrong
 *      total diverges at SPIN_COUNT 0x6019), but this test pins the collapsed
 *      total EXPLICITLY: optimized total == oracle total == 70t, on independent
 *      clones of the same captured entry. A mis-collapse to a wrong total fails it.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { sub_0a53 as translated_0a53 } from "../../translated/state0.js";
import { sub_0a53 as optimized_0a53 } from "../sub_0a53.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0a53;
const FRAMES = 30; // sub_0a53 fires at frames 5 (handler_01c3) and 6 (handler_0779)

// The first store on the routine's path (0x7740). sub_0a53 fires only at frames
// 5 and 6, and its cells are captured in those frame-boundary dumps before any
// maintainer heals them, so a wrong value here surfaces (and persists) in the
// whole-machine trace.
const BROKEN_ADDR = 0x7740;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x7740 lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine run
 * verbatim -- the representative "wrong value to one of the routine's own output
 * addresses" bug the gate must catch.
 */
function broken_0a53(m) {
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
    return optimized_0a53(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0a53 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0a53]]));

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
      `override fired ${r.invocations.get(TARGET)}x (both call paths)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0a53 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0a53, optimized_0a53);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong tile store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0a53]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong tile store is CAUGHT and names 0x7740", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0a53, broken_0a53);

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

// -- CYCLE TOTAL (teeth for the atomic collapse) ------------------------------

test("CYCLE TOTAL: the collapsed optimized total equals the oracle's (70t)", () => {
  // Capture the pristine machine state at the instant sub_0a53 is first entered,
  // the same way unitEquivalence does, then run oracle and optimized on two
  // independent clones and measure cycles across each.
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0a53(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(FRAMES);
  assert.ok(entry !== null, "sub_0a53 was never entered — cannot measure cycles");

  const a = entry.clone();
  const b = entry.clone();
  const ta = a.cycles; translated_0a53(a); const oracleTotal = a.cycles - ta;
  const tb = b.cycles; optimized_0a53(b); const optTotal = b.cycles - tb;

  assert.equal(oracleTotal, 70, `oracle total drifted: expected 70, got ${oracleTotal}`);
  assert.equal(
    optTotal,
    oracleTotal,
    `collapse changed the TOTAL: optimized ${optTotal} vs oracle ${oracleTotal}`,
  );
  console.log(`  CYCLE: oracle ${oracleTotal}t == optimized ${optTotal}t (60t body collapsed + 10t ret)`);
});
