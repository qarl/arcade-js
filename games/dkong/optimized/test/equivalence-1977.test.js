// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for handler_1977 (game-state-1 sub-state index 3: the
 * finale "reach-mover"). handler_1977 is a two-act TRAMPOLINE: it `call`s sub_21ee
 * (the demo/animation script tick) and then FALLS THROUGH into loc_197a, the shared
 * per-frame engine cascade (~25 updaters + the spine entry_1ac3 / sub_1f72 /
 * entry_30ed / ...). Its own ROM footprint is a single instruction, the 17-T
 * `call 0x21ee` at 0x1977; everything observable comes from its two callees, reached
 * by address so they stay the oracle (or a proven rewrite).
 *
 * Seven jobs (the standard four, plus the trampoline's return contract and both
 * halves of the cycle teeth):
 *
 *   1. EQUAL -- the idiomatic optimized handler_1977 reads EQUAL against its
 *      translated oracle, whole-machine and unit. The override routes through
 *      dispatchGameState's override consult (nmi.js), inert when the map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. handler_1977
 *      does NOT run in attract: it needs GAME_STATE(0x6005)==1, CREDITS(0x6001)==0
 *      and GAME_SUBSTATE(0x600A)==3 -- state 1 index 3 in the 0x0748 sub-state table
 *      -- which a plain boot never reaches (the finale). It is driven here by an
 *      identical-both-sides poke that holds those three bytes from frame 20; the
 *      0x0748 dispatch then vectors to handler_1977 once per frame (40x over the
 *      60-frame window). Because the poke drives the finale cascade forward, once it
 *      hits a board-complete it sets 0x600A=0x16; the poke re-forces it to 3 every
 *      CAPTURED frame, but the single unpokable execution tail past `maxFrames` is
 *      exposed -- so the window is chosen inside the empirically CONTIGUOUS clean
 *      band (baseline+optimized clean for FRAMES 44..80; the teeth broken-side band
 *      is 42..60). FRAMES=60 / TEETH_FRAMES=50 sit well inside both.
 *
 *   3. TEETH -- a deliberately-broken twin (the first store on the path -- sub_21ee's
 *      scripted-input write to 0x6010, handler_1977's OWN distinctive act) lands the
 *      wrong value; it must be CAUGHT: NOT-EQUAL, naming 0x6010, whole-machine and
 *      unit. (sub_21ee's 0x63CD counter is written twice per fall-through and the
 *      second write masks a corruption of the first, so 0x6010 -- written once,
 *      unconditionally, before any branch -- is the robust representative store.)
 *
 *   4. STRAIGHT-LINE + RETURN CONTRACT -- handler_1977 has NO data-dependent branch
 *      of its own (it is a straight-line trampoline; every branch lives inside the
 *      callees, reached by address). Its one degree of freedom is the value it
 *      propagates from loc_197a (loc_197a returns early on its sub_1e57 "hidden
 *      exit"). This test stubs 0x197a to return each of several sentinels and asserts
 *      the optimized trampoline returns EXACTLY what the oracle does -- proving it
 *      neither swallows nor fabricates loc_197a's result. That closes the
 *      branch-coverage teeth for a routine whose only variation is its return value.
 *
 *   5. CYCLE-COLLAPSE (unit) -- handler_1977's OWN cycle contribution is a single
 *      17-T charge (the `call 0x21ee`); there is nothing to collapse and (being a
 *      tail-call into the interruptible loc_197a) nothing that legally could be. This
 *      test isolates that own total (callees stubbed to a zero-cost ret) and asserts
 *      oracle == optimized == 17, so the charge cannot silently drift.
 *
 *   6. CYCLE-COLLAPSE TEETH (whole-machine) -- that 17 T is load-bearing: the NMI's
 *      total cost sets the main-loop vblank spin count / PRNG (README §2). A WRONG
 *      own-charge (16 instead of 17) is CAUGHT and NOT-EQUAL, diverging in the diffed
 *      STACK RAM (0x6BFE) -- a later frame's NMI-pushed PC landing at a different byte
 *      because this NMI cost one cycle less, the same downstream-landing mechanism as
 *      entry_0611 / loc_1839.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). The engine
 * that proves equivalence lives in core/equivalence.js; games/dkong/optimized/
 * harness.js is a thin wrapper that bakes in a `makeMachine` factory built on `{}`
 * assets -- which drives NO input and applies NO poke, so it can never reach the
 * finale sub-state and never dispatches handler_1977. This test therefore calls the
 * SAME core unitEquivalence / wholeMachineEquivalence directly (they ARE the standard
 * engine harness.js wraps), passing a makeMachine factory that adds an identical
 * finale poke to BOTH the baseline and optimized machines (the factory is the
 * wrapper's only job). Nothing about the capture / clone / diff / invocation-counter
 * logic is re-implemented, and the snapshot override is still installed at
 * CONSTRUCTION (the factory passes it into `new Machine`), which is what reaches
 * handler_1977 however it is entered. Any poke is applied identically to both sides
 * (the factory is shared). Same pattern as equivalence-1839.test.js / -0a76.test.js.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { handler_1977 as translated_1977 } from "../../translated/state0.js";
import { handler_1977 as optimized_1977 } from "../handler_1977.js";
import { Machine } from "../../machine.js";
import {
  unitEquivalence,
  wholeMachineEquivalence,
  firstStateDiff,
  firstRegDiff,
} from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1977;
const FRAMES = 60; // dispatches once/frame from 20; 40 hits. Inside the clean band 44..80.
const TEETH_FRAMES = 50; // caught at frame 21; inside baseline(44..80) ∩ broken-6010(42..60).
const MAX_FRAMES = 45; // handler_1977 first dispatches at frame 20; 45 reaches it cleanly.

// Force the finale sub-state that reaches handler_1977: hold GAME_STATE at 1
// (dispatchGameState -> handler_073c), CREDITS at 0 (handler_073c takes the 0x0748
// sub-state dispatch, not the credit branch), and GAME_SUBSTATE at 3 (0x0748 index
// 3 = handler_1977), from frame 20. Applied by the SHARED factory, so baseline and
// optimized see the identical poke.
const FINALE_POKE = [
  { addr: 0x6005, val: 0x01, frame: 20, dur: null },
  { addr: 0x6001, val: 0x00, frame: 20, dur: null },
  { addr: 0x600a, val: 0x03, frame: 20, dur: null },
];

// The makeMachine factory the core engine drives, extended to attach the finale
// poke. Called with no argument for the baseline and with the wrapped override map
// for the optimized side -- both get the SAME poke, so all state forcing is applied
// identically.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FINALE_POKE.map((p) => ({ ...p }));
  return m;
}

// handler_1977's first store on the path: sub_21ee's `ld (0x6010),a` (0x21FC),
// which overwrites the decoded input with the scripted-demo byte. It is written
// exactly once, unconditionally, before sub_21ee's first branch, and lands in the
// compared work-RAM dump. Corrupting it is the representative "wrong value to one of
// the routine's own output addresses" bug the gate must catch.
const BROKEN_ADDR = 0x6010;

/**
 * Deliberately-broken twin: behaviourally optimized_1977 EXCEPT the first store to
 * 0x6010 lands a wrong value (the correct byte XOR 0xFF, guaranteed to differ).
 * Intercepting exactly that one write lets the rest of the routine and every
 * subroutine it calls run verbatim.
 */
function broken_1977(m) {
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
    return optimized_1977(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * A WRONG-total twin: identical to optimized_1977 but charges the `call 0x21ee`
 * 16 T instead of 17. Used to prove the own total has teeth -- a cheaper NMI shifts
 * where a LATER frame's NMI lands in the diffed stack RAM.
 */
function wrongTotal_1977(m) {
  m.push16(0x197a);
  m.step(0x21ee, 16); // WRONG: should be 17
  m.call(0x21ee);
  return m.call(0x197a);
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized handler_1977 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_1977]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (finale cascade)`,
  );
});

test("EQUAL (unit): idiomatic optimized handler_1977 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_1977, optimized_1977, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first entry frame 20)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong script-input store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, TEETH_FRAMES, new Map([[TARGET, broken_1977]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong script-input store is CAUGHT and names 0x6010", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_1977, broken_1977, { maxFrames: MAX_FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- STRAIGHT-LINE + RETURN CONTRACT (branch-coverage analog) ------------------

// Capture the pristine machine at handler_1977's FIRST dispatch, via the same
// construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_1977(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`handler_1977 never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

test("STRAIGHT-LINE: optimized propagates loc_197a's return value verbatim (no swallow/fabricate)", () => {
  const entry = captureEntry();

  // handler_1977 has no data-dependent branch of its own -- its ONLY variation is
  // the value it tail-returns from loc_197a (early on the hidden-exit path, else the
  // tail's). Stub both callees: 0x21ee to a zero-cost balanced ret (pops the pushed
  // 0x197A so SP is balanced), 0x197a to return each sentinel. The oracle and the
  // optimized trampoline must return the IDENTICAL value.
  const zeroCostRet = (mm) => mm.ret(0);
  for (const sentinel of [true, false, undefined, 0x1234]) {
    const a = entry.clone();
    a.routines.set(0x21ee, zeroCostRet);
    a.routines.set(0x197a, () => sentinel);
    const b = entry.clone();
    b.routines.set(0x21ee, zeroCostRet);
    b.routines.set(0x197a, () => sentinel);

    const ra = translated_1977(a);
    const rb = optimized_1977(b);
    assert.equal(rb, ra, `sentinel ${String(sentinel)}: optimized returned ${String(rb)}, oracle ${String(ra)}`);
    assert.equal(ra, sentinel, `sentinel ${String(sentinel)}: oracle did not propagate loc_197a's value`);
  }
  console.log("  STRAIGHT-LINE: return value propagated verbatim for true/false/undefined/0x1234 on both");
});

// -- CYCLE-COLLAPSE -----------------------------------------------------------

test("CYCLE (unit): the routine's own charge is exactly 17 T on oracle AND optimized", () => {
  const entry = captureEntry();

  // Isolate handler_1977's own cycle contribution by stubbing its callees to a
  // zero-cost ret (pops the pushed return so SP stays balanced, charges nothing);
  // the delta in m.cycles is then exactly the routine's own total -- the single
  // `call 0x21ee` charge, which must be 17 and identical between the two.
  const zeroCostRet = (mm) => mm.ret(0);
  const measure = (fn) => {
    const c = entry.clone();
    c.routines.set(0x21ee, zeroCostRet);
    c.routines.set(0x197a, zeroCostRet);
    const before = c.cycles;
    fn(c);
    return c.cycles - before;
  };

  const oracle = measure(translated_1977);
  const opt = measure(optimized_1977);
  assert.equal(oracle, 17, `oracle own-cycles ${oracle} != 17`);
  assert.equal(opt, 17, `optimized own-cycles ${opt} != 17`);
  console.log("  CYCLE/unit: own total 17 T (call 0x21ee) on oracle AND optimized");
});

test("CYCLE (whole-machine): a WRONG own total (call charged 16) is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongTotal_1977]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong own total slipped through — the total has no teeth");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  CYCLE/whole: wrong call charge 16 caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});
