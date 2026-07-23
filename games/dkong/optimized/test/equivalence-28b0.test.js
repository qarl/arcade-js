// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_28b0 (ROM 0x28B0): three sequential
 * entry_2913 collision sweeps. It is dispatched from INSIDE the NMI -- index 2
 * of the rst-0x28 table at ROM 0x2874 (sub_286f dispatches it when the collision
 * selector 0x6227 == 2), which sub_2808 drives from the state-3 gameplay cascade
 * loc_197a (@ 0x19B6). See optimized/sub_28b0.js for the behavior docstring.
 *
 * Six jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized sub_28b0 reads EQUAL
 *      against its translated oracle, every frame.
 *   2. EQUAL (unit) -- EQUAL in RAM + every register (F included) + pc.
 *   3/4. TEETH (whole + unit) -- a deliberately-broken twin that corrupts the
 *      routine's own store to the sweep-count cell 0x63B9 is CAUGHT: NOT-EQUAL,
 *      naming 0x63B9. (0x63B9 is written three times -- 5, 6, 1 -- so a broken
 *      FIRST store is overwritten and invisible; the twin corrupts the surviving
 *      store, the representative "wrong value to the routine's output" bug.)
 *   5/6. FULL BRANCH COVERAGE -- sub_28b0's data-dependent branch is which sweep
 *      (if any) entry_2913 HITs: sweep-1 hit (early return after sweep 1), sweep-2
 *      hit, sweep-3 hit, and ALL-MISS (all three run, then the final `ret`). The
 *      all-miss arm is the one the driven whole-machine run reaches; the three HIT
 *      arms are synthesised by forging a matching object record at the sweep's base
 *      so the REAL entry_2913 hits it (both oracle and optimized call the same
 *      registered entry_2913, so the forge decides the branch identically for
 *      both). Each arm is proven EQUAL (RAM + all registers + pc) AND proven to
 *      carry the SAME cycle TOTAL on both sides (teeth against a wrong/over-
 *      collapsed charge) -- the collapse's real teeth for the arms the whole-
 *      machine run never reaches.
 *
 * WHY THIS TEST DRIVES A POKE (like 084b / 127c, and cannot use the fixed harness.js
 * factory). sub_28b0 NEVER dispatches from boot: measured 0 hits across 1200 frames
 * of attract; the natural selector 0x6227 is 1 (which dispatches sub_2880, its
 * twin). An IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke the board state to
 * reach a state for validation") sets 0x6227 = 2 across the demo window, so
 * sub_286f dispatches sub_28b0 from frame 586 on (sub_2808 runs every demo frame).
 * The poke is threaded via a custom makeMachine factory (m.pokes) driving the
 * game-agnostic CORE engine, applied to baseline and optimized alike so
 * equivalence is preserved.
 *
 * THE CYCLE FINDING this routine adds: sub_28b0 is ATOMIC and its per-sweep m.step
 * charges ARE collapsed to one total per sweep. Unlike entry_0611/loc_127c (main-
 * loop routines whose interruptible callees made the total observable via a shifted
 * NMI push), sub_28b0 runs with the NMI MASK cleared (it is reached from entry_0066,
 * which clears the mask), so the NMI cannot fire inside it OR inside entry_2913 --
 * nothing can observe the distribution. Collapsing sweeps to one charge each (75 /
 * 62 / 62, plus the 10 t final ret) stays EQUAL whole-machine AND per-arm unit, and
 * the total is preserved so the downstream main-loop spin count (README §2) is
 * unchanged. First collapsed routine on the NMI game-state path.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_28b0 as translated_28b0 } from "../../translated/state0.js";
import { sub_28b0 as optimized_28b0 } from "../sub_28b0.js";
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

const TARGET = 0x28b0;
const FRAMES = 600; // sub_28b0 is forced to dispatch from frame 586 (attract demo gameplay)

// The per-sweep active count, stored to 0x63B9 by sub_28b0 itself (5, then 6,
// then 1). A plain data cell in the compared work-RAM dump. NOT read by entry_2913,
// so corrupting it changes no control flow -- a clean, persistent diff.
const BROKEN_ADDR = 0x63b9;

// Identical-both-sides poke: hold the collision selector 0x6227 = 2 across the
// demo window so sub_286f's rst-0x28 table dispatches index 2 (= sub_28b0) each
// frame sub_2808 runs (from frame 586). Applied to baseline and optimized alike.
const FORCE_28B0_POKE = [{ addr: 0x6227, val: 0x02, frame: 580, dur: 25 }];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_28B0_POKE.map((p) => ({ ...p }));
  return m;
};

// Deliberately-broken twin: behaviourally the optimized handler EXCEPT every store
// to 0x63B9 lands the wrong value (XOR 0xFF, guaranteed to differ). Corrupting all
// three (not just the first, which the later two overwrite) leaves the surviving
// value wrong -- the "wrong value to one of the routine's own output addresses"
// bug the gate must catch. entry_2913 never reads 0x63B9, so the rest runs verbatim.
function broken_28b0(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  m.mem.write8 = (addr, value, busOffset) =>
    realWrite(addr, addr === BROKEN_ADDR ? value ^ 0xff : value, busOffset);
  try {
    return optimized_28b0(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_28b0 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_28b0]]));

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

test("EQUAL (unit): idiomatic optimized sub_28b0 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_28b0, optimized_28b0, { maxFrames: 600 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x63B9 store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_28b0]]));

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
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_28b0, broken_28b0, { maxFrames: 600 });

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

// -- FULL BRANCH COVERAGE (synthesised per-arm teeth incl. cycle totals) -------

/**
 * Capture ONE real entry to sub_28b0 (via the engine's construction-time snapshot
 * override on the poke-driven host), so the synthesised arms inherit a valid stack
 * (the dispatcher pushed 0x0407; entry_2913 pops/discards it) and realistic RAM.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_28b0(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(600);
  assert.ok(entry !== null, "failed to capture a sub_28b0 entry to synthesise arms from");
  return entry;
}

/** Run a fn on a clone and return the T-states it consumed (clone() neutralises
 * the NMI/frame machinery, so the count is exactly the routine's own). */
function cyclesOf(seed, fn) {
  const c = seed.clone();
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

/**
 * Forge a matching object record at a sweep's base so the REAL entry_2913 HITs its
 * first record. entry_2913 (C=probe axis-1, L/H=span bounds, IY+3=probe axis-2):
 *   - (base+0) bit 0 set  -> slot active
 *   - (base+5) = C        -> |C-(ix+5)| = 0, +1-L borrows -> within near span
 *   - (base+3) = (IY+3)   -> |(iy+3)-(ix+3)| = 0, -H borrows -> HIT
 * Uniform across all three sweeps (same C/L/H/IY hold throughout the routine).
 */
function forgeHit(seed, base) {
  const c = seed.regs.c;
  const iy3 = seed.mem.read8((seed.regs.iy + 3) & 0xffff);
  seed.mem.write8(base + 0, seed.mem.read8(base + 0) | 0x01);
  seed.mem.write8((base + 5) & 0xffff, c);
  seed.mem.write8((base + 3) & 0xffff, iy3);
}

/**
 * Prove one arm EQUAL. Applies `setup` to a clone of a captured entry, runs oracle
 * vs optimized on two further clones, and asserts: RAM + every register + pc
 * identical, identical boolean return, the SAME cycle total on both sides (teeth
 * against a wrong total), and -- non-vacuously -- that the arm took its intended
 * path via `check`.
 */
function proveArm(entry, name, setup, check) {
  const seed = entry.clone();
  setup(seed);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  const retA = translated_28b0(a);
  const retB = optimized_28b0(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, `${name}: pc must match`);
  assert.equal(retA, retB, `${name}: return value must match (${retA} vs ${retB})`);

  // Cycle TOTAL teeth: the optimized routine must consume exactly the oracle's
  // T-states on this arm (a wrong or over-collapsed charge would differ).
  const cycT = cyclesOf(seed, translated_28b0);
  const cycO = cyclesOf(seed, optimized_28b0);
  assert.ok(cycT > 0, `${name}: oracle must consume cycles`);
  assert.equal(cycO, cycT, `${name}: cycle total ${cycO} != oracle ${cycT}`);

  // Non-vacuous: the synthesised entry actually reached the intended arm.
  check(seed, a, name);
  console.log(`  ARM ${name}: EQUAL (RAM+regs+pc+ret); cycle total ${cycO}`);
}

const rd = (m, addr) => m.mem.read8(addr);

test("BRANCH (all-miss): all three sweeps run, then ret — EQUAL", () => {
  const entry = captureEntry();
  // The natural entry already misses all three sweeps (0x6227==2 demo state).
  proveArm(entry, "all-miss (0x63B9 ends at sweep-3 count 1, A=0)",
    (_s) => {},
    (seed, a, name) => {
      assert.equal(a.regs.a, 0, `${name}: A must be 0 (list exhausted, no hit)`);
      assert.equal(rd(a, 0x63b9), 1, `${name}: 0x63B9 must hold sweep-3 count (all sweeps ran)`);
    });
});

test("BRANCH (sweep-1 HIT): entry_2913 hits table 0x6400 — early return, EQUAL", () => {
  const entry = captureEntry();
  proveArm(entry, "sweep-1 HIT (only sweep 1 ran)",
    (s) => forgeHit(s, 0x6400),
    (seed, a, name) => {
      assert.equal(a.regs.a, 1, `${name}: A must be 1 (hit)`);
      assert.equal(rd(a, 0x63b9), 5, `${name}: 0x63B9 must hold sweep-1 count 5 (later sweeps skipped)`);
      assert.equal(a.regs.ix, 0x6400, `${name}: IX restored to sweep-1 base`);
    });
});

test("BRANCH (sweep-2 HIT): sweep 1 misses, entry_2913 hits table 0x65A0 — EQUAL", () => {
  const entry = captureEntry();
  proveArm(entry, "sweep-2 HIT (sweeps 1-2 ran)",
    (s) => forgeHit(s, 0x65a0),
    (seed, a, name) => {
      assert.equal(a.regs.a, 1, `${name}: A must be 1 (hit)`);
      assert.equal(rd(a, 0x63b9), 6, `${name}: 0x63B9 must hold sweep-2 count 6 (sweep 3 skipped)`);
      assert.equal(a.regs.ix, 0x65a0, `${name}: IX restored to sweep-2 base`);
    });
});

test("BRANCH (sweep-3 HIT): sweeps 1-2 miss, entry_2913 hits table 0x66A0 — EQUAL", () => {
  const entry = captureEntry();
  proveArm(entry, "sweep-3 HIT (all three sweeps ran, last one hit)",
    (s) => forgeHit(s, 0x66a0),
    (seed, a, name) => {
      assert.equal(a.regs.a, 1, `${name}: A must be 1 (hit)`);
      assert.equal(rd(a, 0x63b9), 1, `${name}: 0x63B9 must hold sweep-3 count 1`);
      assert.equal(a.regs.ix, 0x66a0, `${name}: IX restored to sweep-3 base`);
    });
});
