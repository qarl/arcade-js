// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_059b (task table entry 2: CLEAR a BCD score
 * slot, then render it by tail-jumping into handler_05c6). Like handler_05c6 and
 * entry_0611 it is a MAIN-LOOP routine dispatched by dispatchTask.
 *
 * Three jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_059b (optimized/loc_059b.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *
 *   3. TEETH -- a deliberately-broken twin (the first slot-clear store lands the
 *      wrong value) must be CAUGHT: NOT-EQUAL, naming the diverging RAM address.
 *
 * WHY THIS TEST DRIVES INPUT (and cannot use games/dkong/optimized/harness.js
 * directly). loc_059b clears a score slot to zero -- the score-RESET that happens
 * when a GAME STARTS, not the per-frame score REDRAW (that is handler_05c6, entry
 * 3). It therefore NEVER dispatches in attract mode: measured 0 hits across 12000
 * frames of boot/attract. It fires only once a credited game is in progress. So
 * these tests feed the machine the canonical coin+start input tape (the same
 * `tapes/coin_start.lua` contract the pixel gate uses: IN2 coin 0x80, then IN2
 * start1 0x04) via a custom `makeMachine` factory, and drive the game-agnostic
 * CORE equivalence engine (core/equivalence.js) with it. The DK harness wrapper
 * bakes `inputs` but not the timed `inputTape`, which is why the factory is built
 * here rather than reused. With this tape loc_059b dispatches EXACTLY ONCE, at
 * frame 151 (game start, payload 0 -> P1_SCORE 0x60B2). FRAMES = 170 covers it.
 *
 * THE COLLAPSE FINDING this routine adds: loc_059b is ATOMIC. It is a straight-
 * line "clear 3 bytes then tail-jump" with no interruptible call before the
 * tail-jump, so the vblank NMI never lands inside it. Collapsing its ~13 per-
 * instruction m.step charges to ONE per-branch TOTAL (payload 0/1/2 = 126/136/146
 * t) stays EQUAL whole-machine AND unit (verified here -- collapsing did NOT
 * diverge). The total is preserved because it is still load-bearing through the
 * tail-called handler_05c6 (README §2); only its internal DISTRIBUTION is dropped.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_059b as translated_059b } from "../../translated/mainloop.js";
import { loc_059b as optimized_059b } from "../loc_059b.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
  unitEquivalence as coreUnitEquivalence,
} from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x059b;
const FRAMES = 170; // loc_059b fires once, at frame 151 (game start)

// Canonical coin+start tape (tapes/coin_start.lua contract, early variant): pulse
// IN2 coin (0x80) then IN2 start1 (0x04), so the ROM's own credit/start logic
// starts a game. A fresh copy per machine (the factory maps it) keeps each run's
// tape independent.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded.
// Called with no argument for the baseline and with the wrapped override map for
// the optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously).
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// loc_059b's FIRST store is the clear of the selected slot's base byte. With this
// tape the single dispatch has payload 0, so the base is P1_SCORE (0x60B2) -- a
// byte inside the compared work-RAM dump (0x6000-0x6BFF). It is not rewritten in
// the run window (the fresh game has score 0), so a wrong value there persists.
const BROKEN_ADDR = 0x60b2;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x60B2 lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * handler_05c6 run verbatim -- the representative "wrong value to one of the
 * routine's own output addresses" bug the gate must catch.
 */
function broken_059b(m) {
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
    return optimized_059b(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_059b matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_059b]]));

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

test("EQUAL (unit): idiomatic optimized loc_059b matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_059b, optimized_059b, { maxFrames: 200 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong slot-clear store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_059b]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong slot-clear store is CAUGHT and names 0x60B2", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_059b, broken_059b, { maxFrames: 200 });

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
