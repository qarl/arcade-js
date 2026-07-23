// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for entry_062a (task table entry 10: render the two
 * BCD digits of 0x638C, with a once-per-board seed-and-label first pass). Like
 * handler_05c6 / entry_0611 it is a MAIN-LOOP routine dispatched by dispatchTask.
 *
 * Three jobs:
 *
 *   1. EQUAL -- the idiomatic optimized entry_062a (optimized/entry_062a.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      routes through dispatchTask's override consult (mainloop.js), inert when
 *      the map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. Unlike
 *      0611 (which fires at boot frame 6), entry_062a is a board-display task: it
 *      first dispatches in the ATTRACT demo board at frame ~521 via the full
 *      divide+LDIR seed path (branch D, 1157t incl. callees), then repeatedly from
 *      frame ~587 via the BCD-decrement path (branch B, 179t). A 600-frame window
 *      covers branch D and the first branch B (2 dispatches).
 *
 *   3. TEETH -- a deliberately-broken twin (the seed store to 0x638C lands the
 *      wrong value) must be CAUGHT: NOT-EQUAL, naming 0x638C.
 *
 * THE CYCLE FINDING this routine adds: entry_062a is ATOMIC and COLLAPSED. A
 * boot+attract probe dispatched it 14x over 2400 frames -- including the 1157t
 * branch-D path -- with the vblank NMI landing INSIDE it ZERO times (it calls
 * nothing interruptible within its own body and finishes ~36000t before the frame
 * boundary). So each branch charges its per-instruction tstate SUM in a SINGLE
 * m.step (A=14, B=41, C=69, D=975+18q). Whole-machine EQUAL confirms the totals
 * exactly -- a wrong total would diverge at SPIN_COUNT 0x6019, as it did for
 * handler_05c6 when stripped. See optimized/entry_062a.js for the full decision.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { entry_062a as translated_062a } from "../../translated/mainloop.js";
import { entry_062a as optimized_062a } from "../entry_062a.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x062a;
const FRAMES = 600; // branch D fires at frame ~521, branch B at ~587
const MAX_FRAMES = 600; // the unit harness must run far enough to reach the first dispatch

// entry_062a's primary work-RAM output on the seed path (branch D): the packed
// two-digit BCD it stores at 0x638C. It sits in the compared work-RAM dump
// (0x6000-0x6BFF), it is written once per dispatch (not rewritten per-frame -- the
// only other writer, board-init loc_0c92, runs once), and on branch D loc_066a
// reads it from register A rather than re-reading RAM, so a corrupted store
// persists and the diff stands.
const BROKEN_ADDR = 0x638c;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x638C lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim -- the representative "wrong value to one
 * of the routine's own output addresses" bug the gate must catch.
 */
function broken_062a(m) {
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
    return optimized_062a(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized entry_062a matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_062a]]));

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

test("EQUAL (unit): idiomatic optimized entry_062a matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_062a, optimized_062a, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong seed store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_062a]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong seed store is CAUGHT and names 0x638C", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_062a, broken_062a, { maxFrames: MAX_FRAMES });

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
