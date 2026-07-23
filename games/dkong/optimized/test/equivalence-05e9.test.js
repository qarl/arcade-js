// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for handler_05e9 (task table entry 3: draw a
 * doubly-indirected string vertically into VRAM). A MAIN-LOOP routine,
 * dispatched by dispatchTask -- the same path handler_05c6 uses, so the override
 * consult in dispatchTask (mainloop.js) drives it, and it is inert when the
 * override map is empty.
 *
 * Three jobs:
 *
 *   1. EQUAL -- the idiomatic optimized handler_05e9 (optimized/handler_05e9.js)
 *      reads EQUAL against its translated oracle, whole-machine and unit. The
 *      routine has NO callees (it inlines sub_0020's `pop hl / ret` tail), so
 *      there is nothing to import from translated/.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *      handler_05e9 is queued at power-on init (handler_01c3 enqueues a task
 *      with D=0x03 -> table index 3 -> ROM 0x05E9, payload 4) and again by the
 *      attract sequence, so it first dispatches at frame 5 (payload 4) and fires
 *      9x within the 30-frame window.
 *
 *   3. TEETH -- a deliberately-broken twin (the first character store lands the
 *      wrong value) must be CAUGHT: NOT-EQUAL, naming the diverging VRAM address.
 *
 * CYCLE CHARGES ARE PER-INSTRUCTION HERE, DELIBERATELY. The ladder's rung 3
 * (collapse the m.step charges to one TOTAL per path) does NOT stay EQUAL for
 * handler_05e9, even though the totals are correct (prologue 118, drawing iter
 * 93/98, terminator 44; the UNIT gate below, which has no interrupt, reads EQUAL
 * with them collapsed). The vblank NMI fires INSIDE the loop on a frame-6
 * dispatch and the oracle pushes PC 0x060d onto the stack; a per-iteration
 * charge pushes 0x0600 instead, so the WHOLE-machine trace diverges at frame 7,
 * addr 0x6bf2 (118 vs 86). handler_05e9 is long enough for the NMI to interrupt
 * it, so its cycle distribution is observable (README §2's "NMI lands mid-logic"
 * caveat) -- unlike handler_05c6. The handler therefore stays at rung 2.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { handler_05e9 as translated_05e9 } from "../../translated/mainloop.js";
import { handler_05e9 as optimized_05e9 } from "../handler_05e9.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built -- run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x05e9;
const FRAMES = 30; // handler_05e9 first fires at frame 5 (payload 4), 9x within 30

// The first character store of the FIRST dispatch (payload 4) lands at VRAM
// 0x7680; the string is drawn upward, -32 (one tilemap row) per char. This is
// the write the unit harness captures, and it is inside the compared state dump
// (video RAM 0x7400-0x77FF).
const BROKEN_ADDR = 0x7680;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x7680 lands a wrong value (the correct tile XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine run
 * verbatim -- the representative "wrong value to one of the routine's own output
 * cells" bug the gate must catch.
 */
function broken_05e9(m) {
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
    return optimized_05e9(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized handler_05e9 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_05e9]]));

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

test("EQUAL (unit): idiomatic optimized handler_05e9 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_05e9, optimized_05e9);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong character store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_05e9]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store -- it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong character store is CAUGHT and names 0x7680", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_05e9, broken_05e9);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store -- it is worthless");
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
