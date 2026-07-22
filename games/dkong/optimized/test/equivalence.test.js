// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests.
 *
 * Two jobs, and the second matters as much as the first:
 *
 *   1. EQUAL — the VERBATIM optimized handler_01c3 (optimized/handlers.js) must
 *      read EQUAL against its translated oracle, both whole-machine and unit.
 *      This is the identity case: if a byte-for-byte copy does not pass, the
 *      harness is measuring the wrong thing.
 *
 *   2. TEETH — a deliberately-broken twin (one store lands the wrong value) must
 *      be CAUGHT: NOT-EQUAL, ideally naming the diverging address/frame. A gate
 *      that has never been seen to fail is not known to work; this is what proves
 *      it isn't vacuous.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { handler_01c3 as translated_01c3 } from "../../translated/state0.js";
import { handler_01c3 as optimized_01c3 } from "../handlers.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x01c3;
const FRAMES = 30; // handler_01c3 runs once, early; this covers it + downstream

/**
 * The deliberately-broken twin used for the TEETH tests: behaviourally the
 * optimized handler EXCEPT the store to 0x6229 lands 0x99 instead of the correct
 * 0x01. Implemented by intercepting exactly that one write, so the rest of the
 * routine and every subroutine it calls run verbatim — this is a "wrong value to
 * one of the routine's own addresses" bug, the representative failure the gate
 * must catch. (0x6229 is the level number; the game keeps running with the bad
 * value, so the divergence persists as level 0x99 vs 0x01 in the state trace
 * rather than crashing — a clean, observable catch.)
 */
function broken_01c3(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === 0x6229) {
      broke = true;
      return realWrite(addr, 0x99, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_01c3(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): verbatim optimized handler_01c3 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_01c3]]));

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

test("EQUAL (unit): verbatim optimized handler_01c3 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_01c3, optimized_01c3);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all 19 registers + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_01c3]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong store is CAUGHT and names 0x6229", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_01c3, broken_01c3);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    0x6229,
    `expected first diff at the broken address 0x6229, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
