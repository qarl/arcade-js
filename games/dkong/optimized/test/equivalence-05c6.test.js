// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for handler_05c6 (task table entry 2: draw a BCD
 * counter). Its sibling equivalence.test.js covers handler_01c3, an NMI-path
 * routine; this one covers a MAIN-LOOP routine, dispatched by dispatchTask, and
 * it is what settled the open cycle-observability question (see below).
 *
 * Three jobs:
 *
 *   1. EQUAL — the idiomatic optimized handler_05c6 (optimized/handlers.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      is wired through dispatchTask (mainloop.js), the twin of the one already
 *      in dispatchGameState; both are inert when the override map is empty.
 *
 *   2. DISPATCH — the override must actually fire, or EQUAL is vacuous. It first
 *      dispatches at frame 5 (payload 2 then payload 0 — the tail_05da and
 *      draw_056b renderer arms respectively), so a 30-frame window covers both.
 *
 *   3. TEETH — a deliberately-broken twin (one render digit lands the wrong
 *      value) must be CAUGHT: NOT-EQUAL, naming the diverging VRAM address.
 *
 * THE RUNG-4 FINDING this routine proved: stripping ALL its m.step charges
 * DIVERGES at 0x6019 (SPIN_COUNT), frame 6, 65 vs 66 — the same address and
 * values as the handler_01c3 NMI case. A cheaper frame reaches the vblank spin
 * sooner and the main loop spins once more. So a routine's TOTAL cycle cost is
 * observable through the spin count no matter where it runs — NOT NMI-specific.
 * Collapsing the charges to a single per-branch TOTAL (what the shipped handler
 * does) stays EQUAL; dropping them entirely does not.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { handler_05c6 as translated_05c6 } from "../../translated/mainloop.js";
import { handler_05c6 as optimized_05c6 } from "../handlers.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x05c6;
const FRAMES = 30; // handler_05c6 first fires at frame 5 (payloads 2 and 0)

// The routine's only stores are the six render digits its renderer writes to
// VRAM. The first digit of the payload-2 (HIGH_SCORE) render lands at 0x7641,
// and payload 2 is the FIRST dispatch — so the unit harness captures exactly
// this path. 0x7641 is inside the compared state dump (video RAM 0x7400-0x77FF).
const BROKEN_ADDR = 0x7641;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x7641 lands a wrong value (the correct digit XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim — the representative "wrong value to one
 * of the routine's own output addresses" bug the gate must catch. handler_05c6
 * only fires at frame 5, so the corrupted cell is not rewritten and the diff
 * persists as a clean, observable catch.
 */
function broken_05c6(m) {
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
    return optimized_05c6(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized handler_05c6 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_05c6]]));

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

test("EQUAL (unit): idiomatic optimized handler_05c6 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_05c6, optimized_05c6);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong render store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_05c6]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong render store is CAUGHT and names 0x7641", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_05c6, broken_05c6);

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
