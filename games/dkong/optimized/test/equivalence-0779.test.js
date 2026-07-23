// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for handler_0779 (game state 1 / attract, sub-state 0:
 * build the title/attract screen and arm the next sub-state). It is an NMI
 * GAME-STATE handler, dispatched from boot through the rst 0x28 sub-state table at
 * 0x0748 (state 0 sets GAME_STATE=1/substate 0; the next attract NMI dispatches
 * sub-state 0 here). Its own last write increments GAME_SUBSTATE, so it runs
 * EXACTLY ONCE.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) — the idiomatic optimized handler_0779
 *      (optimized/handler_0779.js) reads EQUAL against its translated oracle every
 *      frame. The override routes through dispatchGameState's override consult
 *      (reached via the rst 0x28 sub-state dispatch → dispatchGameState), inert
 *      when the map is empty.
 *
 *   2. DISPATCH — the override must actually fire, or EQUAL is vacuous.
 *      handler_0779 dispatches EXACTLY ONCE from boot (early, in the attract
 *      ramp-up). A 30-frame window covers it.
 *
 *   3. EQUAL (unit) — translated vs optimized leave identical RAM + registers
 *      (incl. F) + pc from the captured entry state. Correctness of F is by
 *      construction: both end on the same m.call(0x07ad) (the oracle sub_07ad),
 *      so the whole register file on return is whatever it leaves.
 *
 *   4. BRANCH COVERAGE — handler_0779's one data-dependent branch is the
 *      `cp 0x01 / call z 0x09EE` guard on 0x600F. The natural run reaches one arm;
 *      the other is SYNTHESISED by poking 0x600F identically on BOTH sides before
 *      running (an identical-both-sides poke), so each arm has committed teeth:
 *        - 0x600F == 1  (call z TAKEN — sub_09ee drawn, 256 t branch)
 *        - 0x600F != 1  (call z NOT taken, 249 t branch)
 *
 *   5. TEETH (whole + unit) — a deliberately-broken twin whose SUBSTATE_TIMER
 *      (0x6009) store lands the wrong value must be CAUGHT: NOT-EQUAL, naming the
 *      diverging address.
 *
 *   6. WRITE-TRACE — handler_0779 makes its OWN hardware writes (the two palette-bank
 *      latch clears 0x7D86/0x7D87, its first two stores). The RAM+regs gate cannot see
 *      the emit.js --writes trace's cycle column, so this proves the two writes land at
 *      the oracle's exact write-bus cycle (0x7D86 @ +17, 0x7D87 @ +33 — 16 t apart, not
 *      collapsed onto one) — and that a flat-collapse would shift them (teeth).
 *
 * THE CYCLE FINDING this routine adds: handler_0779 is ATOMIC even though it is an
 * NMI handler with SEVEN callees. The NMI handler clears io.nmiMask on entry so no
 * NMI re-fires inside it; and the NMI fires at cycle N·CYCLES_PER_FRAME (right
 * after that frame's boundary capture) and completes far short of the next
 * boundary — so no frame boundary crosses mid-routine and its internal cycle
 * distribution is unobservable. Collapsing the per-instruction m.step charges to
 * one per-branch TOTAL (not-taken 249, taken 256) stays EQUAL whole-machine AND
 * unit. The TOTAL is still load-bearing (it is the NMI's cost → the main-loop spin
 * count → the PRNG entropy), so it is preserved exactly; only the distribution is
 * dropped.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { handler_0779 as translated_0779 } from "../../translated/state0.js";
import { handler_0779 as optimized_0779 } from "../handler_0779.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0779;
const FRAMES = 30; // handler_0779 fires exactly once, early in the attract ramp

// The routine's first store into diffed work RAM is SUBSTATE_TIMER (0x6009) = 2
// (the palette latches at 0x7D86/0x7D87 are board control, outside the state dump).
// It fires exactly once, so the corrupted cell is not rewritten within the window
// and the diff persists.
const BROKEN_ADDR = 0x6009;

// Branch selector: `ld a,(0x600F) / cp 0x01 / call z 0x09EE`.
const SELECTOR = 0x600f;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to SUBSTATE_TIMER lands a wrong value (correct value XOR 0xFF, guaranteed
 * to differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim — the representative "wrong value to one
 * of the routine's own output addresses" bug the gate must catch.
 */
function broken_0779(m) {
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
    return optimized_0779(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/** Wrap a routine so it pokes `addr = value` (identically on both sides) before running. */
function pokeThen(addr, value, fn) {
  return (m) => {
    m.mem.write8(addr, value);
    return fn(m);
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized handler_0779 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0779]]));

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

test("EQUAL (unit): idiomatic optimized handler_0779 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0779, optimized_0779);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

test("BRANCH (unit): 0x600F == 1 — call z TAKEN (sub_09ee) proven EQUAL", () => {
  const r = unitEquivalence(
    ROM,
    {},
    TARGET,
    pokeThen(SELECTOR, 0x01, translated_0779),
    pokeThen(SELECTOR, 0x01, optimized_0779),
    { maxFrames: 40 },
  );
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  BRANCH/taken: 0x600F=1 -> call z 0x09EE taken, EQUAL");
});

test("BRANCH (unit): 0x600F != 1 — call z NOT taken proven EQUAL", () => {
  const r = unitEquivalence(
    ROM,
    {},
    TARGET,
    pokeThen(SELECTOR, 0x00, translated_0779),
    pokeThen(SELECTOR, 0x00, optimized_0779),
    { maxFrames: 40 },
  );
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  BRANCH/not-taken: 0x600F=0 -> call z skipped, EQUAL");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SUBSTATE_TIMER store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0779]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong SUBSTATE_TIMER store is CAUGHT and names 0x6009", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0779, broken_0779);

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

// -- WRITE-TRACE (the hardware-write bus cycle the RAM gate cannot see) --------

/** Capture the pristine machine the instant handler_0779 is first dispatched (once,
 *  early in attract). A constructor override snapshots the entry; the host run
 *  continues via the translated oracle so it reaches a clean stop. */
function captureEntry(maxFrames = 40) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0779(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error(`0x${TARGET.toString(16)} never dispatched in ${maxFrames} frames`);
  return entry;
}

/** Run `fn` on a fresh clone of `entry` with the hardware write-trace recording.
 *  Cycles are reported RELATIVE to entry so they are base-independent. */
function traceClone(entry, fn) {
  const c = entry.clone();
  c.mem.writeTrace = []; // clock is () => c.cycles (installed by the constructor)
  const c0 = c.cycles;
  fn(c);
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

test("WRITE-TRACE: the two palette-bank writes land at the oracle's exact bus cycle", () => {
  const entry = captureEntry();
  const oracleTrace = traceClone(entry, translated_0779);
  const optTrace = traceClone(entry, optimized_0779);

  // handler_0779's OWN hardware writes are the two palette-bank latch clears; they are
  // its first two stores, so they trace at fixed offsets from entry regardless of the
  // dispatch cycle. Its seven callees write only work/sprite/video RAM (no hardware
  // writes), and its own later stores (SUBSTATE_TIMER 0x6009, GAME_SUBSTATE 0x600A)
  // are work RAM — none appear in the hardware-write trace.
  assert.deepEqual(
    oracleTrace,
    [{ rel: 17, addr: 0x7d86, value: 0 }, { rel: 33, addr: 0x7d87, value: 0 }],
    "oracle hardware-write trace is not the two palette-bank clears @ +17/+33",
  );
  assert.deepEqual(optTrace, oracleTrace, "optimized palette-write bus cycles differ from the oracle");

  // Teeth: the PRE-FIX flat collapse emits both palette stores before any cycle charge,
  // so both hardware writes land at +7 (the same cycle). RAM+regs are unaffected (the
  // whole branch is charged in one lump), so ONLY the write trace catches it — it must
  // fail the deepEqual, or this check has no teeth.
  const flat = traceClone(entry, (m) => {
    const { regs, mem } = m;
    regs.hl = 0x7d86;
    mem.write8(regs.hl, 0x00, 7); // +7
    regs.hl = 0x7d87;
    mem.write8(regs.hl, 0x00, 7); // +7 — collapsed onto the same cycle
    m.step(0x07ad, 249); // whole branch folded into one late lump (the bug)
  });
  assert.equal(flat[0].rel, flat[1].rel, "flat variant should collapse both writes onto one cycle");
  assert.notDeepEqual(flat, oracleTrace, "write-trace check has no teeth");
  console.log(
    `  WRITE-TRACE: palette writes @ +17/+33t identical to oracle (16t apart); ` +
      `flat-collapse variant (both @ +${flat[0].rel}t) caught`,
  );
});
