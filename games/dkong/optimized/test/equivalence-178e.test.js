// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_178e (the board-sequence ADVANCE arm: index 5
 * of loc_1615's 0x1623/0x1637 tables). It is dispatched from INSIDE the vblank NMI
 * during BOARD-ADVANCE: dispatchGameState(GAME_STATE(0x6005)==3) -> loc_06fe ->
 * loc_1615 (GAME_SUBSTATE(0x600A)==0x16) -> `rst 0x28` on the 0x6388 selector via
 * the 6-entry table at 0x1623 (BOARD(0x6227) bit0 set) -> this routine when
 * 0x6388==5. It steps the board-order pointer (0x7F sentinel -> reload 0x3A73),
 * publishes the next BOARD, enqueues its task (0x309F), re-arms the gate timer, and
 * hands off to sub-state 8 (how-high).
 *
 * Six jobs, mirroring loc_17b6 (its board-advance sibling) but with a real
 * data-dependent branch:
 *
 *   1. EQUAL -- the idiomatic optimized sub_178e (optimized/sub_178e.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit. The override routes
 *      through dispatchGameState's override consult (nmi.js), inert when the map is
 *      empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_178e
 *      runs only during board-advance, which a bounded boot never reaches. So these
 *      tests force it with an IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke the
 *      board state to reach a state for validation" -- applied to baseline and
 *      optimized alike, so equivalence is preserved): from frame 100 it HOLDS
 *      GAME_STATE(0x6005)=3, GAME_SUBSTATE(0x600A)=0x16 (board-advance),
 *      BOARD(0x6227)=1 (bit0 set -> the 0x1623 table), the selector 0x6388=5 (index
 *      5 = sub_178e), and SUBSTATE_TIMER(0x6009)=1 (so the rst-0x18 gate expires and
 *      the BODY runs every frame). Held across the window so sub_178e dispatches AND
 *      executes its body every frame (~40x). Threaded via a custom makeMachine
 *      factory (m.pokes) driving the game-agnostic CORE engine.
 *
 *   3. TEETH -- a deliberately-broken twin (the first store to BOARD_SEQ_PTR's low
 *      byte 0x622A lands the wrong value) must be CAUGHT: NOT-EQUAL, naming 0x622A,
 *      whole and unit. 0x622A is the routine's one persistent, un-poked output (the
 *      other stores -- 0x6227/0x6388/0x6009/0x600A -- are re-written by the held poke
 *      before the next state sample, so a flip there would not surface in the
 *      whole-machine trace; 0x622A is not poked and drives the next frame's walk).
 *
 *   4. BRANCH COVERAGE + CYCLE TOTAL -- sub_178e has three data-dependent paths, each
 *      synthesised from the captured entry and proven EQUAL (RAM+regs+pc) AND
 *      cycle-total-equal to the oracle (both clones run the same two callees via
 *      m.call, so equal totals pin the collapsed own-charge exactly):
 *        - SKIP  : the rst-0x18 gate has not expired (0x6009=5) -> early return.
 *        - Zreload: the walked pointer hits the 0x7F sentinel (ptr=0x3A78, +1=0x3A79)
 *                   -> reload 0x3A73. Own charge 193t.
 *        - NZwalk : the walked pointer is a normal board byte (ptr=0x3A65) -> keep it.
 *                   Own charge 176t.
 *      A wrong collapsed total (one t short on the 0x309F segment) is CAUGHT here.
 *
 *   5/6. CYCLE (whole-machine) -- a WRONG collapsed total is CAUGHT and NOT-EQUAL,
 *      proving the collapsed total is load-bearing (this frame's NMI cost sets the
 *      main-loop spin count and where a LATER frame's NMI lands in diffed stack RAM).
 *
 * THE CYCLE FINDING: sub_178e is ATOMIC because it is dispatched from inside the NMI
 * (the mask is held; dispatchGameState does not re-enter), so the vblank NMI can
 * never land inside it OR either callee (0x0018/0x309F) -- the whole subtree runs
 * with interrupts disabled. Its per-instruction m.step charges therefore collapse to
 * one per call-segment (preceding straight-line run + that call's cost) plus one
 * call-free epilogue, each charge placed immediately before its call so every callee
 * still starts at the oracle's exact cumulative cycle. The TOTAL stays load-bearing
 * -- as part of the NMI's cost it sets the main-loop vblank-spin count (README §2) --
 * so each branch's sum is preserved exactly; a one-t error diverges at an NMI-pushed
 * PC in diffed stack RAM (~0x6BEA), the same downstream-landing mechanism as
 * loc_17b6/loc_0a8a/entry_0611. sub_178e makes NO hardware writes (all stores are
 * work RAM, never a 0x7Dxx latch), so the collapse has no --writes-trace consequence
 * and no write-trace test.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_178e as translated_178e } from "../../translated/state0.js";
import { sub_178e as optimized_178e } from "../sub_178e.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
  unitEquivalence as coreUnitEquivalence,
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

const TARGET = 0x178e;
const POKE_FRAME = 100;
const HOLD_DUR = 40; // held so sub_178e dispatches + runs its body ~40x
const FRAMES = 140; // run ends within the hold
const CALL_309F_STEP = 0x309f; // address of the collapsed 0x309F-segment m.step
const BROKEN_ADDR = 0x622a; // BOARD_SEQ_PTR low byte -- persistent + un-poked

// Identical-both-sides poke that forces board-advance / the 0x1623 table / selector
// 5 / gate-expiry. Held so sub_178e dispatches AND executes its body every frame.
// A fresh copy per machine keeps each run independent.
const FORCE_178E_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_STATE = 3 (in-game)
  { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_SUBSTATE = 0x16 (board-advance)
  { addr: 0x6227, val: 0x01, frame: POKE_FRAME, dur: HOLD_DUR }, // BOARD bit0 set -> 0x1623 table
  { addr: 0x6388, val: 0x05, frame: POKE_FRAME, dur: HOLD_DUR }, // selector 5 -> sub_178e
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: HOLD_DUR }, // rst-0x18 gate expires -> body runs
];

// The engine's factory: a DK Machine on this ROM with the force poke loaded. Called
// with no argument for the baseline and with the wrapped override map for the
// optimized side; both get the SAME poke, so any state forcing is applied identically.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_178E_POKE.map((p) => ({ ...p }));
  return m;
};

// sub_178e's first store to BOARD_SEQ_PTR is its low byte 0x622A (write16 splits
// into two write8s, low first). The broken twin lands the correct value XOR 0xFF
// there (guaranteed to differ). Intercepting exactly that one write lets the rest
// of the routine and both callees run verbatim -- the representative "wrong value to
// one of the routine's own output addresses" bug the gate must catch.
function broken_178e(m) {
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
    return optimized_178e(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// A WRONG-total twin: byte-for-byte optimized_178e but charges one t-state fewer on
// the collapsed 0x309F segment. Used to prove the collapsed total has teeth -- a
// cheaper NMI shifts where a later frame's NMI lands in diffed stack RAM.
function wrongTotal_178e(m) {
  const realStep = m.step.bind(m);
  let hit = false;
  m.step = (addr, cyc) => {
    if (!hit && addr === CALL_309F_STEP) {
      hit = true;
      return realStep(addr, cyc - 1);
    }
    return realStep(addr, cyc);
  };
  try {
    return optimized_178e(m);
  } finally {
    m.step = realStep;
  }
}

// -- pristine-entry capture (for the isolated branch / cycle checks) -------------

/** Capture the machine the instant sub_178e is FIRST entered (frame 101). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_178e(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("sub_178e never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/**
 * Run oracle and optimized on two fresh clones of the entry with `setup` applied to
 * each, and return their state diff + per-side cycle totals. Both clones run the
 * same two callees via m.call, so equal totals pin the collapsed own-charge exactly.
 */
function diffBranch(setup) {
  const a = ENTRY.clone(); setup(a); const ca = a.cycles; translated_178e(a); const cycA = a.cycles - ca;
  const b = ENTRY.clone(); setup(b); const cb = b.cycles; optimized_178e(b); const cycB = b.cycles - cb;
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return { ram, regs, pcEqual: a.pc === b.pc, cycA, cycB };
}

// Branch selectors, applied to a captured entry clone.
const setSkip = (m) => { m.mem.write8(0x6009, 5); }; // gate has NOT expired -> early return
const setZreload = (m) => { m.mem.write8(0x6009, 1); m.mem.write16(0x622a, 0x3a78); }; // +1 = 0x3A79 (0x7F sentinel)
const setNZwalk = (m) => { m.mem.write8(0x6009, 1); m.mem.write16(0x622a, 0x3a65); }; // +1 = 0x3A66 (board byte)

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_178e matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_178e]]));

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
      `override fired ${r.invocations.get(TARGET)}x (board-advance, forced)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_178e matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_178e, optimized_178e, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong BOARD_SEQ_PTR store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_178e]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong BOARD_SEQ_PTR store is CAUGHT and names 0x622A", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_178e, broken_178e, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- BRANCH COVERAGE + CYCLE TOTAL --------------------------------------------

test("BRANCH COVERAGE: all three paths (skip / sentinel-reload / walk) are EQUAL and preserve their totals", () => {
  for (const [name, setup, ownTotal] of [
    ["SKIP (gate not expired)", setSkip, null],
    ["Zreload (0x7F sentinel)", setZreload, 193],
    ["NZwalk (board byte)", setNZwalk, 176],
  ]) {
    const d = diffBranch(setup);
    assert.equal(d.ram, null, `${name}: RAM diff at 0x${d.ram ? d.ram.addr.toString(16) : ""}`);
    assert.equal(d.regs, null, `${name}: reg diff at ${d.regs ? d.regs.reg : ""}`);
    assert.ok(d.pcEqual, `${name}: pc must match`);
    // Cycle teeth: optimized total == oracle total (both run the same callees, so
    // this pins sub_178e's own collapsed charge for this branch exactly).
    assert.equal(d.cycB, d.cycA, `${name}: cycle total drifted (optimized ${d.cycB} vs oracle ${d.cycA})`);
    console.log(
      `  ${name}: EQUAL (RAM+regs+pc), total ${d.cycB}t == oracle ${d.cycA}t` +
        (ownTotal != null ? ` (own charge ${ownTotal}t)` : ""),
    );
  }

  // ...and the cycle assertion is not vacuous: a 1-t error in the collapsed 0x309F
  // segment makes the totals disagree.
  const a = ENTRY.clone(); setNZwalk(a); const ca = a.cycles; translated_178e(a); const cycA = a.cycles - ca;
  const b = ENTRY.clone(); setNZwalk(b); const cb = b.cycles; wrongTotal_178e(b); const cycB = b.cycles - cb;
  assert.notEqual(cycB, cycA, "cycle-total assertion has no teeth");
  console.log(`  wrong-total twin caught: ${cycB}t != oracle ${cycA}t`);
});

test("CYCLE (whole-machine): a WRONG collapsed total is CAUGHT and NOT-EQUAL", () => {
  // The collapsed total is load-bearing: this frame's NMI cost sets the main-loop
  // spin count (PRNG entropy) and where a LATER frame's NMI lands in diffed stack RAM.
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongTotal_178e]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong collapsed total slipped through — the total has no teeth");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  CYCLE/whole: wrong total caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});
