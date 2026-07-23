// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_1670 (entry 1 of loc_1615's rst-0x28 board-
 * advance table at 0x1623). It is dispatched from INSIDE the vblank NMI during
 * BOARD-ADVANCE: dispatchGameState(GAME_STATE(0x6005)==3) -> loc_06fe -> loc_1615
 * (GAME_SUBSTATE(0x600A)==0x16) -> rst 0x28 on the 0x6388 selector when BOARD(0x6227)
 * bit0 is set -> this routine when 0x6388==1. It re-arms the sub-state timer, copies a
 * 40-byte board block, advances the selector, and (only on the 75m board) runs an
 * add-C sweep. Same dispatch family as loc_17b6, and it forces reach the same way.
 *
 * Unlike loc_17b6 (straight-line), sub_1670 has TWO data-dependent guards, so it has
 * THREE branches, all covered here:
 *   - rst-0x18 skip  (SUBSTATE_TIMER 0x6009 did NOT expire this frame; whole body
 *                     discarded)                                     own 11t / 59t total
 *   - rst-0x30 skip  (timer expired, but BOARD(0x6227) != 3 so the bit-select gate
 *                     skips the tail)                                own 97t / 1060t total
 *   - full path      (timer expired AND BOARD == 3)                 own 135t / 1560t total
 *
 * Seven jobs:
 *
 *   1. EQUAL (whole) -- optimized sub_1670 reads EQUAL against its oracle every frame.
 *      The override routes through dispatchGameState's override consult (nmi.js), inert
 *      when the map is empty.
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_1670 runs
 *      only during board-advance, which a bounded boot never reaches, so it is forced
 *      with an IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke the board state to
 *      reach a state for validation"): from frame 100 HOLD GAME_STATE=3, GAME_SUBSTATE=
 *      0x16, BOARD=3 (bit0 set -> 0x1623 table; ==3 -> the rst-0x30 gate passes), the
 *      selector 0x6388=1 (-> sub_1670), and SUBSTATE_TIMER 0x6009=1 (so the rst-0x18
 *      gate expires to 0 and the FULL body runs every frame ~40x). Threaded via a
 *      custom makeMachine factory (m.pokes), applied to baseline and optimized alike.
 *   3. TEETH (whole) -- a broken twin whose first copy store (0x6908) lands the wrong
 *      value must be CAUGHT: NOT-EQUAL, naming an address.
 *   4. TEETH (unit) -- the same broken store is caught in isolation and names 0x6908.
 *   5. BRANCH COVERAGE (unit) -- each of the three branches, synthesised from the
 *      captured entry by setting its deciding RAM (0x6009 / 0x6227), is proven EQUAL
 *      (RAM + all registers incl. F + pc) AND its real-callee cycle total matches the
 *      oracle's exactly (optimized vs oracle on the same entry -- teeth for the
 *      collapsed totals on the two branches the driven run does not reach).
 *   6. CYCLE (unit, isolated) -- with all four callees stubbed to charge nothing and
 *      the two gates driven, sub_1670's OWN charge is 11 / 97 / 135t per branch on BOTH
 *      oracle and optimized (the collapse redistributes the SAME total); a 1t error is
 *      caught.
 *   7. CYCLE (whole) -- a WRONG collapsed total (segment C charged 58 not 59) is CAUGHT
 *      and NOT-EQUAL, proving the collapsed total is load-bearing.
 *
 * THE CYCLE FINDING. sub_1670 is ATOMIC because it is dispatched from inside the NMI,
 * where the mask is held -- the vblank NMI can never land inside it OR any of its four
 * callees (0x0018/0x004E/0x0030/0x0038), which all run with interrupts disabled. So its
 * per-instruction m.step charges collapse to one per call-segment (each placed
 * immediately before its m.call so every callee still starts at the oracle's exact
 * cumulative cycle) plus the final ret. Each branch's TOTAL is preserved and stays
 * load-bearing -- as part of the NMI's cost it sets the main-loop vblank-spin count
 * (README §2) -- so a wrong 58-for-59 diverges downstream, the same mechanism as
 * loc_17b6/entry_0611. sub_1670 makes NO hardware writes (0x6009/0x6388/0x690B are work
 * RAM), so unlike loc_0a8a the collapse has no --writes-trace consequence and no
 * write-trace test.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_1670 as translated_1670 } from "../../translated/state0.js";
import { sub_1670 as optimized_1670 } from "../sub_1670.js";
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

const TARGET = 0x1670;
const POKE_FRAME = 100;
const HOLD_DUR = 40; // held across the rest of the window so sub_1670 dispatches ~40x
const FRAMES = 140;
const CALLEES = [0x0018, 0x004e, 0x0030, 0x0038];
const SEG_C_STEP = 0x0030; // the address of the collapsed segment-C m.step (59t)
const BROKEN_ADDR = 0x6908; // first copy store (sub_004e); written each body frame, persists

// Per-branch own cycle-totals (callees excluded) and real-callee totals (callees
// included) -- both measured from the oracle and pinned here as regression anchors.
const OWN = { skip18: 11, skip30: 97, full: 135 };
const TOTAL = { skip18: 59, skip30: 1060, full: 1560 };

// Identical-both-sides poke forcing board-advance / the 0x1623 table / selector 1 /
// BOARD 3 (rst-0x30 gate passes) / timer 1 (rst-0x18 gate expires) -> the FULL path
// every frame. A fresh copy per machine keeps each run independent.
const FORCE_1670_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_STATE = 3 (in-game)
  { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_SUBSTATE = 0x16 (board-advance)
  { addr: 0x6227, val: 0x03, frame: POKE_FRAME, dur: HOLD_DUR }, // BOARD = 3 -> 0x1623 table + rst-0x30 pass
  { addr: 0x6388, val: 0x01, frame: POKE_FRAME, dur: HOLD_DUR }, // selector 1 -> sub_1670
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: HOLD_DUR }, // SUBSTATE_TIMER = 1 -> expires to 0, body runs
];

// The engine's factory: a DK Machine on this ROM with the force poke loaded. Called
// with no argument for baseline and with the wrapped override map for the optimized
// side; both get the SAME poke, so any state forcing is applied identically.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_1670_POKE.map((p) => ({ ...p }));
  return m;
};

// Broken twin: byte-for-byte optimized_1670 EXCEPT the first store to 0x6908 lands the
// correct value XOR 0xFF (guaranteed to differ). Intercepting exactly that one write
// lets every subroutine and the rest of the routine run verbatim -- the representative
// "wrong value to one of the routine's own output addresses" bug the gate must catch.
function broken_1670(m) {
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
    return optimized_1670(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// Wrong-total twin: byte-for-byte optimized_1670 but charges 58 for the collapsed
// segment C instead of 59 (each body branch's total short by 1). Used to prove the
// collapsed total has teeth -- a cheaper NMI shifts the main-loop spin count.
function wrongTotal_1670(m) {
  const realStep = m.step.bind(m);
  m.step = (addr, cyc) => realStep(addr, addr === SEG_C_STEP ? cyc - 1 : cyc);
  try {
    return optimized_1670(m);
  } finally {
    m.step = realStep;
  }
}

// -- pristine-entry capture (for the isolated branch / cycle checks) -------------

/** Capture the machine the instant sub_1670 is FIRST entered (full-path state). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_1670(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("sub_1670 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry (optionally forcing a branch via `setup`);
 *  return the post-run machine and the cycles it spent. */
function runClone(fn, setup) {
  const c = ENTRY.clone();
  if (setup) setup(c);
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Force a branch by setting the deciding RAM on a captured-entry clone. */
const SETUP = {
  full: null, // entry is already the full-path state (timer 1, BOARD 3)
  skip30: (mm) => mm.mem.write8(0x6227, 0x01), // BOARD 1: rst-0x30 gate skips
  skip18: (mm) => mm.mem.write8(0x6009, 0x05), // timer 5: dec -> 4 != 0, rst-0x18 skips
};

/** Own cycles (all callees stubbed to charge nothing), with the two gates driven. */
function ownCycles(fn, gate18, gate30) {
  const c = ENTRY.clone();
  c.routines.set(0x0018, () => gate18);
  c.routines.set(0x004e, () => {});
  c.routines.set(0x0030, () => gate30);
  c.routines.set(0x0038, () => {});
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_1670 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_1670]]));

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
      `override fired ${r.invocations.get(TARGET)}x (board-advance, forced full path)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_1670 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1670, optimized_1670, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (full path)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong copy store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_1670]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong copy store is CAUGHT and names 0x6908", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1670, broken_1670, { maxFrames: FRAMES });

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

// -- BRANCH COVERAGE ----------------------------------------------------------

test("BRANCH COVERAGE (unit): all three branches EQUAL (RAM+regs+pc) and preserve their totals", () => {
  for (const [name, expTotal] of [["full", TOTAL.full], ["skip30", TOTAL.skip30], ["skip18", TOTAL.skip18]]) {
    const a = runClone(translated_1670, SETUP[name]);
    const b = runClone(optimized_1670, SETUP[name]);

    const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.m.regs, b.m.regs);
    assert.equal(ram, null, ram ? `[${name}] RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
    assert.equal(regs, null, regs ? `[${name}] reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
    assert.equal(a.m.pc, b.m.pc, `[${name}] pc must match`);

    // Real-callee cycle total: optimized == oracle (teeth for the collapsed branch
    // totals), and both == the pinned anchor.
    assert.equal(b.cycles, a.cycles, `[${name}] cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);
    assert.equal(a.cycles, expTotal, `[${name}] oracle total ${a.cycles} != expected ${expTotal}`);
    console.log(`  BRANCH/${name}: EQUAL (RAM+regs+pc); total ${b.cycles}t == oracle == ${expTotal}t`);
  }
});

// -- CYCLE --------------------------------------------------------------------

test("CYCLE (unit, isolated): sub_1670's OWN charge is 11/97/135t per branch on both sides", () => {
  // Stub every callee to charge nothing; the m.cycles delta is then exactly
  // sub_1670's own contribution. The collapse redistributes the SAME total per branch.
  const cases = [
    ["skip18", OWN.skip18, false, false],
    ["skip30", OWN.skip30, true, false],
    ["full", OWN.full, true, true],
  ];
  for (const [name, own, g18, g30] of cases) {
    assert.equal(ownCycles(translated_1670, g18, g30), own, `[${name}] oracle own-cycles != ${own}`);
    assert.equal(ownCycles(optimized_1670, g18, g30), own, `[${name}] optimized own-cycles != ${own}`);
  }
  // ...and not vacuous: a 1-cycle error in the collapsed segment C makes the full-path
  // own total disagree.
  assert.notEqual(ownCycles(wrongTotal_1670, true, true), OWN.full, "own-cycle assertion has no teeth");
  console.log(`  CYCLE/unit: own totals 11/97/135t on oracle and optimized (collapsed, preserved); wrong-total caught`);
});

test("CYCLE (whole-machine): a WRONG collapsed total (58 for segment C) is CAUGHT and NOT-EQUAL", () => {
  // The collapsed total is load-bearing: this NMI-frame's cost sets the main-loop spin
  // count (PRNG entropy) and where a LATER frame's NMI lands in diffed stack RAM.
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongTotal_1670]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong collapsed total slipped through — the total has no teeth");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  CYCLE/whole: wrong total (segment C 58) caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});
