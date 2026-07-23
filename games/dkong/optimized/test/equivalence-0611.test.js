// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for entry_0611 (task table entry 8: an enable-gated
 * string draw + BCD expansion). Like handler_05c6 it is a MAIN-LOOP routine
 * dispatched by dispatchTask, and it is the second data point on the cycle-
 * collapse rule -- but it reaches the same conclusion by a DIFFERENT mechanism.
 *
 * Three jobs:
 *
 *   1. EQUAL -- the idiomatic optimized entry_0611 (optimized/handlers.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      routes through dispatchTask's override consult (mainloop.js), inert when
 *      the map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *      entry_0611 dispatches EXACTLY ONCE from boot, at frame 6 (0x6007's enable
 *      bit is set, so it takes the fall-through-into-sub_0616 branch -- the only
 *      branch reachable in the run window). A 30-frame window covers it.
 *
 *   3. TEETH -- a deliberately-broken twin (the first string-draw store lands the
 *      wrong value) must be CAUGHT: NOT-EQUAL, naming the diverging VRAM address.
 *
 * THE RUNG-3 FINDING this routine adds: entry_0611 is ATOMIC. Collapsing its
 * per-instruction m.step charges to one per-branch TOTAL (guard-clear 28, fall-
 * through 22) stays EQUAL -- the vblank NMI never lands inside its 3-instruction
 * prologue. But the total is still load-bearing: stripping the charges ENTIRELY
 * diverges at STACK 0x6bf2 (frame 7, 118 vs 86), not at 0x6019 like handler_05c6.
 * The reason is instructive -- entry_0611's fall-through calls sub_0616, which is
 * itself INTERRUPTIBLE (handler_05e9). A cheaper prologue shifts the cumulative
 * cycle count, so the NMI lands at a different instruction inside sub_0616 and
 * pushes a different PC. Preserving each branch's total keeps that landing
 * identical. So a routine's TOTAL cost is observable whether it reaches the spin
 * count (05c6) or shifts a downstream NMI (0611); only its DISTRIBUTION is free.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { entry_0611 as translated_0611 } from "../../translated/mainloop.js";
import { entry_0611 as optimized_0611 } from "../handlers.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0611;
const FRAMES = 30; // entry_0611 fires exactly once, at frame 6

// The first store on the routine's path is the first character of string 5,
// written by handler_05e9 (reached through sub_0616) to VRAM 0x759F -- inside
// the compared state dump (video RAM 0x7400-0x77FF). entry_0611 fires only at
// frame 6, so the corrupted cell is not rewritten and the diff persists.
const BROKEN_ADDR = 0x759f;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x759F lands a wrong value (the correct char XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim -- the representative "wrong value to
 * one of the routine's own output addresses" bug the gate must catch.
 */
function broken_0611(m) {
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
    return optimized_0611(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized entry_0611 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0611]]));

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

test("EQUAL (unit): idiomatic optimized entry_0611 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0611, optimized_0611);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong string-draw store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0611]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong string-draw store is CAUGHT and names 0x759F", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0611, broken_0611);

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
