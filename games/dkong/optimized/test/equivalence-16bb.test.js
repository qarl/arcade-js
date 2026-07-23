// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_16bb (the board-load VARIANT selector: entry 1
 * of loc_1615's 0x1637 rst-0x28 table). It is dispatched from INSIDE the vblank NMI
 * during BOARD-ADVANCE: dispatchGameState(GAME_STATE(0x6005)==3) -> loc_06fe ->
 * loc_1615 (GAME_SUBSTATE(0x600A)==0x16) -> [BOARD(0x6227) bit0 clear, bit1 SET ->
 * the 0x1637 table] -> rst 0x28 on the 0x6388 selector -> this routine when
 * 0x6388==1. It clears the board-object flag 0x62A0 and classifies the object by
 * two RAM reads (0x6910 vs 0x5A, then bit7 of 0x63A3) into one of three tail load
 * paths (loc_16e1 / loc_16d5 / loc_16d0).
 *
 * Unlike loc_17b6, loc_16bb HAS a data-dependent branch (three arms), so the tests
 * carry FULL BRANCH COVERAGE: each arm is proven EQUAL whole-machine (driven by an
 * identical-both-sides poke) and its collapsed cycle total is pinned in isolation.
 *
 * Jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_16bb (optimized/loc_16bb.js) reads EQUAL
 *      against its translated oracle, whole-machine and unit. The override routes
 *      through dispatchGameState's override consult (nmi.js), inert when empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_16bb
 *      runs only during a level-2-style board advance, which a bounded boot never
 *      reaches (probed: 0 hits in 600 boot frames). So these tests force it with an
 *      IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke the board state to reach a
 *      state for validation" -- applied to baseline and optimized alike, so
 *      equivalence is preserved): from frame 100 it HOLDS GAME_STATE(0x6005)=3,
 *      GAME_SUBSTATE(0x600A)=0x16 (board-advance), BOARD(0x6227)=2 (bit1 set -> the
 *      0x1637 table), and the selector 0x6388=1 (entry 1 = loc_16bb). Held across
 *      the window so loc_16bb dispatches every frame (~41x). Extra pokes to 0x6910 /
 *      0x63A3 steer the three arms; ALL pokes go to both sides.
 *
 *   3. TEETH -- a deliberately-broken twin (loc_16bb's own store, 0x62A0, lands the
 *      wrong value) must be CAUGHT: NOT-EQUAL, naming 0x62A0, whole and unit. 0x62A0
 *      is loc_16bb's only store; it survives to the frame boundary (sub_2602 only
 *      read-modify-writes it, so a wrong seed persists as a wrong result).
 *
 *   4. FULL BRANCH COVERAGE + CYCLE TOTAL -- all three arms (A >=0x5A -> loc_16e1;
 *      B bit7-clear -> loc_16d5; C bit7-set -> loc_16d0) are proven EQUAL whole-
 *      machine, and in isolation each arm's optimized total equals the oracle's AND
 *      loc_16bb's OWN collapsed charge equals the hand-counted T-states (A 64, B 82,
 *      C 82 -- the jp cc costs 10 taken or not, so B and C tie). A 1-cycle error is
 *      caught.
 *
 *   5. CYCLE (whole-machine) -- a WRONG collapsed total (81 not 82 on the natural B
 *      arm) is CAUGHT and NOT-EQUAL, proving the collapsed total is load-bearing.
 *
 * THE CYCLE FINDING: loc_16bb is ATOMIC because it is dispatched from inside the
 * NMI, where the mask is held -- the vblank NMI can never land inside it OR any of
 * its callees, which all run with interrupts disabled. So its ~9 per-instruction
 * m.step charges collapse to ONE per branch (own total 64/82/82t), placed
 * immediately before the tail m.call so the callee still starts at the oracle's
 * exact cumulative cycle. The TOTAL stays load-bearing -- as part of the NMI's cost
 * it sets the main-loop vblank-spin count (README §2) -- so a wrong 81 diverges at
 * STACK 0x6BFB (an NMI-pushed PC in diffed stack RAM), the same downstream-landing
 * mechanism as loc_0a8a/entry_0611/loc_17b6. loc_16bb makes NO hardware writes (its
 * one store, 0x62A0, is work RAM), so there is no --writes-trace consequence and no
 * write-trace test.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_16bb as translated_16bb } from "../../translated/state0.js";
import { loc_16bb as optimized_16bb } from "../loc_16bb.js";
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

const TARGET = 0x16bb;
const POKE_FRAME = 100;
const HOLD_DUR = 40; // held across the rest of the window so loc_16bb dispatches ~41x
const FRAMES = 140; // run ends within the hold, so no post-hold untranslated arm is reached
const BROKEN_ADDR = 0x62a0; // loc_16bb's only store; read-modify-written downstream, so a wrong seed persists
const DIRECT_CALLEES = [0x16e1, 0x16d5, 0x16d0]; // the three tail targets, stubbed for the own-cycle isolation

// Identical-both-sides poke that forces board-advance / the 0x1637 table / selector
// 1. `extra` steers the three arms (0x6910 vs 0x5A, bit7 of 0x63A3). Held so loc_16bb
// dispatches every frame. The natural (no-extra) capture lands on arm B (0x6910=0).
function forcePoke(extra = []) {
  return [
    { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_STATE = 3 (in-game)
    { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_SUBSTATE = 0x16 (board-advance)
    { addr: 0x6227, val: 0x02, frame: POKE_FRAME, dur: HOLD_DUR }, // BOARD = 2 (bit1 set) -> 0x1637 table
    { addr: 0x6388, val: 0x01, frame: POKE_FRAME, dur: HOLD_DUR }, // selector 1 -> loc_16bb
    ...extra,
  ].map((p) => ({ ...p }));
}

// Arm steering (held with the base poke):
//   A: 0x6910 >= 0x5A            -> jp nc,0x16E1 -> loc_16e1
//   B: 0x6910 < 0x5A, bit7(0x63A3)=0 -> jp z,0x16D5 -> loc_16d5   (the natural arm)
//   C: 0x6910 < 0x5A, bit7(0x63A3)=1 -> fall to 0x16D0 -> loc_16d0
const ARM_A = [{ addr: 0x6910, val: 0x5a, frame: POKE_FRAME, dur: HOLD_DUR }];
const ARM_B = [
  { addr: 0x6910, val: 0x40, frame: POKE_FRAME, dur: HOLD_DUR },
  { addr: 0x63a3, val: 0x00, frame: POKE_FRAME, dur: HOLD_DUR },
];
const ARM_C = [
  { addr: 0x6910, val: 0x40, frame: POKE_FRAME, dur: HOLD_DUR },
  { addr: 0x63a3, val: 0x80, frame: POKE_FRAME, dur: HOLD_DUR },
];

// Per-arm the tail target the branch charges its collapsed total against, and
// loc_16bb's OWN hand-counted T-state total for that arm.
const ARMS = [
  { name: "A (>=0x5A -> loc_16e1)", extra: ARM_A, step: 0x16e1, own: 64, force: (c) => { c.mem.write8(0x6910, 0x5a); } },
  { name: "B (bit7=0 -> loc_16d5)", extra: ARM_B, step: 0x16d5, own: 82, force: (c) => { c.mem.write8(0x6910, 0x40); c.mem.write8(0x63a3, 0x00); } },
  { name: "C (bit7=1 -> loc_16d0)", extra: ARM_C, step: 0x16d0, own: 82, force: (c) => { c.mem.write8(0x6910, 0x40); c.mem.write8(0x63a3, 0x80); } },
];

// The engine's factory for a given poke set: a DK Machine on this ROM with that
// poke loaded. Called with no argument for the baseline and with the wrapped
// override map for the optimized side; both get the SAME poke.
function makeMachineFor(pokes) {
  return (overrides) => {
    const m = new Machine(ROM, overrides ? { overrides } : {});
    m.pokes = pokes.map((p) => ({ ...p }));
    return m;
  };
}
const makeMachine = makeMachineFor(forcePoke()); // natural arm B

// loc_16bb's only store is 0x62A0. The broken twin lands the correct value XOR 0xFF
// there (guaranteed to differ). Intercepting exactly that one write lets every
// subroutine and the rest of the routine run verbatim -- the representative "wrong
// value to the routine's own output address" bug the gate must catch.
function broken_16bb(m) {
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
    return optimized_16bb(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// A WRONG-total twin for the natural B arm: byte-for-byte optimized_16bb but charges
// 81 for the collapsed branch instead of 82. Proves the collapsed total has teeth --
// a cheaper NMI shifts where a later frame's NMI lands in diffed stack RAM.
function wrongTotalB_16bb(m) {
  const realStep = m.step.bind(m);
  m.step = (addr, cyc) => realStep(addr, addr === 0x16d5 ? cyc - 1 : cyc);
  try {
    return optimized_16bb(m);
  } finally {
    m.step = realStep;
  }
}

// -- pristine-entry capture (for the isolated branch / cycle checks) --------------

/** Capture the machine the instant loc_16bb is FIRST entered, under `pokes`. */
function captureEntry(pokes) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_16bb(mm);
  }]]);
  const host = makeMachineFor(pokes)(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_16bb never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry(forcePoke()) : null;

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_16bb matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_16bb]]));

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
      `override fired ${r.invocations.get(TARGET)}x (board-advance, forced; arm B)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_16bb matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_16bb, optimized_16bb, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x62A0 store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_16bb]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong 0x62A0 store is CAUGHT and names 0x62A0", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_16bb, broken_16bb, { maxFrames: FRAMES });

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

// -- FULL BRANCH COVERAGE (whole-machine) -------------------------------------

test("BRANCH COVERAGE (whole-machine): all three arms are EQUAL and dispatch", () => {
  for (const arm of ARMS) {
    const mk = makeMachineFor(forcePoke(arm.extra));
    const r = coreWholeMachineEquivalence(mk, FRAMES, new Map([[TARGET, optimized_16bb]]));
    assert.ok(r.invocations.get(TARGET) >= 1, `arm ${arm.name}: override never dispatched`);
    assert.equal(
      r.equal,
      true,
      r.equal ? "" : `arm ${arm.name} diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} ` +
        `(baseline ${r.baseline} vs optimized ${r.optimized})`,
    );
    assert.equal(r.framesCompared, FRAMES);
    console.log(`  BRANCH/whole ${arm.name}: EQUAL, fired ${r.invocations.get(TARGET)}x`);
  }
});

// -- BRANCH COVERAGE + CYCLE TOTAL (unit, isolated) ---------------------------

test("BRANCH COVERAGE + CYCLE (unit): each arm is EQUAL and preserves its collapsed total", () => {
  // A single captured entry (natural arm B); each arm is forced by poking the
  // discriminant RAM (0x6910 / 0x63A3) on the clone before running -- loc_16bb reads
  // both fresh at its head, so the poke redirects the branch.
  for (const arm of ARMS) {
    const runClone = (fn) => {
      const c = ENTRY.clone();
      arm.force(c);
      const c0 = c.cycles;
      fn(c);
      return { m: c, cycles: c.cycles - c0 };
    };
    const a = runClone(translated_16bb);
    const b = runClone(optimized_16bb);

    const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.m.regs, b.m.regs);
    assert.equal(ram, null, ram ? `arm ${arm.name}: RAM diff at 0x${ram.addr.toString(16)}` : "");
    assert.equal(regs, null, regs ? `arm ${arm.name}: reg diff at ${regs.reg}` : "");
    assert.equal(a.m.pc, b.m.pc, `arm ${arm.name}: pc must match`);

    // Committed cycle teeth: the optimized total (loc_16bb + the same callee via
    // m.call) equals the oracle's exactly.
    assert.equal(b.cycles, a.cycles, `arm ${arm.name}: cycle total drifted (opt ${b.cycles} vs oracle ${a.cycles})`);

    // And loc_16bb's OWN collapsed charge equals the hand-counted total: stub the
    // three tail targets so the delta is loc_16bb proper. Oracle and optimized both.
    const ownCycles = (fn) => {
      const c = ENTRY.clone();
      arm.force(c);
      for (const addr of DIRECT_CALLEES) c.routines.set(addr, () => {}); // charge nothing
      const before = c.cycles;
      fn(c);
      return c.cycles - before;
    };
    assert.equal(ownCycles(translated_16bb), arm.own, `arm ${arm.name}: oracle own-cycles != ${arm.own}`);
    assert.equal(ownCycles(optimized_16bb), arm.own, `arm ${arm.name}: optimized own-cycles != ${arm.own}`);

    // ...and the own-cycle assertion is not vacuous: a 1-cycle error is caught.
    const wrongOwn = (m) => {
      const rs = m.step.bind(m);
      m.step = (addr, cyc) => rs(addr, addr === arm.step ? cyc - 1 : cyc);
      try { return optimized_16bb(m); } finally { m.step = rs; }
    };
    assert.notEqual(ownCycles(wrongOwn), arm.own, `arm ${arm.name}: own-cycle assertion has no teeth`);

    console.log(`  BRANCH+CYCLE/unit ${arm.name}: EQUAL; own total ${arm.own}t on oracle and optimized; wrong-total caught`);
  }
});

// -- CYCLE (whole-machine) ----------------------------------------------------

test("CYCLE (whole-machine): a WRONG collapsed total (81 on arm B) is CAUGHT and NOT-EQUAL", () => {
  // The collapsed 82 is load-bearing: this frame's NMI cost sets the main-loop spin
  // count (PRNG entropy) and where a LATER frame's NMI lands in diffed stack RAM.
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongTotalB_16bb]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong collapsed total slipped through — the total has no teeth");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  CYCLE/whole: wrong total 81 caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});
