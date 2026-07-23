// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_28e0 (the collision-search driver reached as
 * index 3 of the 0x6227 collision-dispatch table @0x2874: it runs entry_2913 --
 * the object-list proximity search -- over TWO object tables, 0x6400 then 0x6500).
 * Like handler_01c3 it is an NMI-path dispatch target (reached via
 * dispatchGameState), and it adds the collision-driver data point to the
 * cycle-collapse rule.
 *
 * Jobs:
 *
 *   1. EQUAL -- the idiomatic optimized sub_28e0 (optimized/sub_28e0.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      routes through dispatchGameState's override consult (nmi.js), inert when
 *      the map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_28e0
 *      is NEVER selected in attract or an ordinary 1-player 25m game: the
 *      collision dispatcher sub_286f reads 0x6227 (BOARD collision-type, loaded
 *      from the live board descriptor at (0x622A)) and in the reachable window it
 *      is always 1 -> sub_2880 (verified: sub_286f ran 198x over 1500 frames, all
 *      index 1; sub_28e0 dispatched 0x). Index 3 is a different board's collision
 *      config. So both gates HOLD-POKE 0x6227 = 3 (identical on baseline and
 *      optimized -- the "identical both sides" the gate requires) via a custom
 *      makeMachine factory, driving the game-agnostic CORE equivalence engine
 *      with it (the DK harness.js wrapper bakes `inputs` but not `pokes`, which is
 *      why the factory is built here; the core engine still installs the snapshot
 *      override at CONSTRUCTION, so nothing here open-codes a reach-the-routine
 *      workaround). With the poke sub_28e0 dispatches from frame 586; FRAMES = 600
 *      covers 16 dispatches, every one the both-sweeps-MISS branch (C).
 *
 *   3. BRANCH COVERAGE -- sub_28e0 has three control-flow paths, decided by whether
 *      each entry_2913 sweep HITS (finds an object in range -> `false`, the
 *      sub_0008 frame-skip convention) or MISSES (`true`):
 *        A: sweep 1 (0x6400) HITS  -> early return true
 *        B: sweep 1 misses, sweep 2 (0x6500) HITS -> early return true
 *        C: both miss -> final ret; return true
 *      The driven run only ever reaches C (the live attract objects match nothing),
 *      so A and B are SYNTHESISED: capture a real branch-C entry, then craft a
 *      guaranteed-in-range object record at the sweep's base (0x6400 for A, 0x6500
 *      for B) so entry_2913 hits, and diff translated vs optimized (RAM + regs +
 *      pc). Because sub_28e0 calls the SAME entry_2913 on both sides, both take the
 *      same branch for a given entry -- the diff proves sub_28e0's own control flow
 *      equal on that arm. Each synthesised (collapsed, non-whole-machine) branch
 *      ALSO asserts its CYCLE TOTAL equals the oracle's, so a wrong collapsed total
 *      on that arm has teeth.
 *
 *   4. CYCLE -- branch C is COLLAPSED and reached by the driven run; its total is
 *      pinned (optimized == translated) and the CYCLE TEETH below proves it is
 *      load-bearing.
 *
 *   5. TEETH -- a deliberately-broken twin (a wrong value to the routine's own
 *      output store 0x63B9) must be CAUGHT: NOT-EQUAL, naming 0x63B9. NB the FIRST
 *      of the two 0x63B9 stores is overwritten by the SECOND within the same call
 *      (sweep-1 count 0x05 then sweep-2 count 0x0A), so the representative
 *      persisting-output bug corrupts the SECOND store -- corrupting the first is
 *      invisible (verified) exactly because it does not survive the routine.
 *
 * THE CYCLE FINDING this routine adds (same as sub_09d6 / handler_05c6, via
 * SPIN_COUNT): sub_28e0 is ATOMIC and COLLAPSED. It runs INSIDE the vblank NMI
 * (dispatchGameState is reached from entry_0066, which clears the NMI mask 0x7D84
 * on entry), so no nested NMI lands inside it, and its ~147 own T-states never
 * span a frame boundary. So each straight-line segment charges its per-instruction
 * tstate SUM (folding the trailing CALL's 17t) in one m.step: sweep-1 prologue 75,
 * sweep-2 prologue 62, final ret 10; entry_2913 keeps charging itself. Whole-
 * machine EQUAL confirms the total exactly -- STRIPPING the charges diverges at
 * SPIN_COUNT 0x6019 (job: CYCLE TEETH), because the NMI's total cost feeds the
 * main loop's vblank-spin count (the PRNG entropy). See optimized/sub_28e0.js for
 * the full decision.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_28e0 as translated_28e0 } from "../../translated/state0.js";
import { sub_28e0 as optimized_28e0 } from "../sub_28e0.js";
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

const TARGET = 0x28e0;
const FRAMES = 600; // sub_28e0 dispatches from frame 586 with the 0x6227=3 poke
const BROKEN_ADDR = 0x63b9; // the routine's own output store (record count)

// sub_28e0 is index 3 of the 0x6227 collision-dispatch table, never selected in
// the reachable window (0x6227 is always 1 -> sub_2880). HOLD-POKE 0x6227 = 3 so
// the dispatcher routes here; applied IDENTICALLY to baseline and optimized via
// this factory (the core engine calls it with no arg for baseline, with the
// wrapped override map for the optimized side). The routine then runs its real
// logic (two entry_2913 sweeps over the live object tables); on attract objects
// both sweeps miss, which is branch C.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = [{ addr: 0x6227, val: 3, frame: 0, dur: null }];
  return m;
};

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the
 * routine's SECOND store to 0x63B9 (the sweep-2 count, the value that survives to
 * the frame sample) lands a wrong value (correct byte XOR 0xFF). The first store
 * is overwritten by the second within the same call, so corrupting it would be
 * invisible; the second is the routine's persisting output.
 */
function broken_28e0(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let seen = 0;
  m.mem.write8 = (addr, value, busOffset) => {
    if (addr === BROKEN_ADDR) {
      seen += 1;
      if (seen === 2) return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_28e0(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Cycle-teeth twin: behaviourally the optimized handler, but every m.step charge
 * is forced to 0 -- a WRONG total. A frame that reaches the vblank spin sooner
 * spins one extra time and reseeds the PRNG, so this must diverge at SPIN_COUNT
 * (0x6019). Proves the collapsed total is not a free parameter.
 */
function strippedCycles_28e0(m) {
  const realStep = m.step.bind(m);
  m.step = (addr) => realStep(addr, 0);
  try {
    return optimized_28e0(m);
  } finally {
    m.step = realStep;
  }
}

// -- pristine-entry capture (branch C) + branch synthesis ---------------------

/** Capture the machine the first time sub_28e0 dispatches (branch C, frame 586). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_28e0(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error(`sub_28e0 never dispatched within ${FRAMES} frames`);
  return entry;
}

/**
 * Craft a guaranteed-in-range object record at object-table base `ixBase`, so the
 * entry_2913 sweep over it HITS. entry_2913 compares |C-(ix+5)| against a span at
 * (ix+0x0A) on axis 1 and |(iy+3)-(ix+3)| against a span at (ix+9) on axis 2;
 * setting the record active (bit 0 of ix+0), its axis positions equal to the
 * search center (ix+5=C, ix+3=(iy+3)), and both spans wide (0xFF) makes the record
 * match regardless of the live L/H bounds. Live C and IY are read from the entry
 * (sub_28e0 and entry_2913 leave both untouched).
 */
function craftHit(m, ixBase) {
  const c = m.regs.c;
  const iy3 = m.mem.read8((m.regs.iy + 3) & 0xffff);
  m.mem.write8(ixBase, m.mem.read8(ixBase) | 0x01);      // active
  m.mem.write8((ixBase + 5) & 0xffff, c);                // axis-1 position == center
  m.mem.write8((ixBase + 0x0a) & 0xffff, 0xff);          // axis-1 span wide
  m.mem.write8((ixBase + 3) & 0xffff, iy3);              // axis-2 position == center
  m.mem.write8((ixBase + 9) & 0xffff, 0xff);             // axis-2 span wide
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Total T-states a routine consumes when run on a fresh clone of `base`. */
function cyclesOf(base, fn) {
  const c = base.clone();
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

/** Run translated vs optimized on two clones of `base`; return the diffs. */
function diffOn(base) {
  const a = base.clone();
  const b = base.clone();
  translated_28e0(a);
  optimized_28e0(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_28e0 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_28e0]]));

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
      `override fired ${r.invocations.get(TARGET)}x (collision driver, branch C from frame 586)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_28e0 matches translated in RAM + registers", () => {
  // The natural first entry is branch C (both sweeps miss).
  const r = unitEquivalence(makeMachine, TARGET, translated_28e0, optimized_28e0, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit (branch C): RAM + all registers (incl. F, DE, IX, SP) + pc identical");
});

// -- BRANCH COVERAGE (synthesised) --------------------------------------------

test("BRANCH (unit, synthesised): sweep-1 HIT at 0x6400 (branch A) EQUAL, cycle total preserved", () => {
  const base = ENTRY.clone();
  craftHit(base, 0x6400); // make the first sweep hit -> early return true
  const d = diffOn(base);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${(d.ram.addr ?? 0).toString(16)}` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg}` : "");
  assert.equal(d.pc, null, "pc must match on branch A");

  // Collapsed + not reached whole-machine, so pin the total against the oracle.
  const t = cyclesOf(base, translated_28e0);
  const o = cyclesOf(base, optimized_28e0);
  assert.equal(o, t, `branch A collapsed total ${o} != oracle total ${t}`);
  console.log(`  BRANCH/unit (A, sweep-1 hit): RAM + regs + pc identical; cycle total ${o} == oracle`);
});

test("BRANCH (unit, synthesised): sweep-2 HIT at 0x6500 (branch B) EQUAL, cycle total preserved", () => {
  const base = ENTRY.clone();
  craftHit(base, 0x6500); // sweep 1 still misses; sweep 2 hits -> early return true
  const d = diffOn(base);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${(d.ram.addr ?? 0).toString(16)}` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg}` : "");
  assert.equal(d.pc, null, "pc must match on branch B");

  const t = cyclesOf(base, translated_28e0);
  const o = cyclesOf(base, optimized_28e0);
  assert.equal(o, t, `branch B collapsed total ${o} != oracle total ${t}`);
  console.log(`  BRANCH/unit (B, sweep-2 hit): RAM + regs + pc identical; cycle total ${o} == oracle`);
});

// -- CYCLE (branch C total) ---------------------------------------------------

test("CYCLE (branch C): the collapsed total equals the oracle's own-instruction sum", () => {
  // Branch C runs both sweeps; own segments collapse to 75 + 62 + 10 = 147 T-states,
  // plus the identical entry_2913 cost on both sides. Pin optimized == translated.
  const t = cyclesOf(ENTRY, translated_28e0);
  const o = cyclesOf(ENTRY, optimized_28e0);
  assert.equal(o, t, `collapsed total ${o} != oracle total ${t}`);
  console.log(`  CYCLE (branch C): collapsed total == oracle total (${o} T-states over the whole routine)`);
});

// -- CYCLE TEETH --------------------------------------------------------------

test("CYCLE TEETH (whole-machine): a WRONG cycle total is CAUGHT at SPIN_COUNT 0x6019", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, strippedCycles_28e0]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "cycle-teeth override must have dispatched");
  assert.equal(r.equal, false, "a wrong total was NOT caught — the preserved total would be a free parameter");
  assert.equal(r.addr, 0x6019, `expected divergence at SPIN_COUNT 0x6019, got 0x${(r.addr ?? 0).toString(16)}`);
  console.log(
    `  CYCLE TEETH: wrong total caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs stripped ${r.optimized})`,
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x63B9 store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_28e0]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong 0x63B9 store is CAUGHT and names 0x63B9", () => {
  const a = ENTRY.clone();
  const b = ENTRY.clone();
  translated_28e0(a);
  broken_28e0(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));

  assert.ok(ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${(ram.addr ?? 0).toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${ram.addr.toString(16)} ` +
      `(translated ${ram.a} vs broken ${ram.b})`,
  );
});
