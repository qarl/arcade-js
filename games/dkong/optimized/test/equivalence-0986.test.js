// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0986 (board-setup prologue: blank the screen +
 * sound, set flip-screen for the cabinet, advance the sub-state). Reached via
 * dispatchGameState (the NMI game-state path) as arm 0 of loc_06fe's 0x0702 table,
 * when GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==0 -- the first in-game NMI
 * after loc_08f8 commits a game start.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_0986 (optimized/loc_0986.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. With the
 *      coin+start tape loc_0986 dispatches EXACTLY ONCE, at frame 152 (the 1-player
 *      branch, 0x600E==0), immediately after loc_08f8 starts the game at frame 151.
 *      FRAMES = 160 covers it.
 *
 *   3. BRANCH COVERAGE -- every data-dependent branch is proven EQUAL, synthesising
 *      the two arms the natural run never reaches. loc_0986 branches on the 0x600E
 *      join-value low byte (==0 -> substate 1; !=0 -> substate 3) and, on the !=0
 *      arm, on DIP_UPRIGHT (0x6026: ==1 keep flip on; !=1 flip off). The natural run
 *      only reaches the ==0 (1-player) arm, so the two 2-player arms are forced by
 *      poking 0x600E/0x6026 IDENTICALLY on both clones. Each collapsed arm the whole-
 *      machine run does not reach ALSO asserts its exact CYCLE TOTAL vs the oracle,
 *      so a wrong collapsed total on those arms has committed teeth.
 *
 *   4. TEETH (whole + unit) -- a deliberately-broken twin is CAUGHT. Whole-machine:
 *      a wrong store to 0x7400 (the first cell of sub_0852's tilemap clear, on
 *      loc_0986's own call path) -- a benign display byte that does not drive
 *      dispatch, so the broken run completes and the diff surfaces (as in
 *      equivalence-06fe). Unit: a wrong store to loc_0986's OWN output 0x600A --
 *      caught and named. (0x600A drives the next frame's dispatch, so corrupting it
 *      whole-machine would crash rather than diff; the unit gate runs the routine
 *      once, so it diffs cleanly.)
 *
 * THE CYCLE FINDING this routine adds: loc_0986 is ATOMIC and COLLAPSED, and it is
 * the case where a callee is HUGE (sub_0852's ~33k-cycle VRAM clear). It runs INSIDE
 * the vblank NMI, which does not re-enter, so no NMI ever lands inside it OR its
 * callees -- the boot+coin+start probe dispatched it once (own cost 37339 cycles)
 * with the NMI landing inside it ZERO times. So its internal DISTRIBUTION is
 * unobservable: the straight-line tail collapses to ONE m.step per branch (the two
 * leading CALLs keep their own 17t so the callee-start cumulative matches the oracle
 * exactly, belt-and-suspenders against a boundary landing inside the big clear; the
 * callees charge their own bodies). The per-branch TOTAL is still load-bearing (as
 * part of the NMI's total it sets the main-loop spin count, README §2 SPIN_COUNT):
 * branch A = 115, upright = 142, cocktail = 153. Whole-machine EQUAL confirms branch
 * A; the synthesised arms assert 142/153 directly.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0986 as translated_0986 } from "../../translated/state0.js";
import { loc_0986 as optimized_0986 } from "../loc_0986.js";
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

const TARGET = 0x0986;
const FRAMES = 160; // loc_0986 dispatches once, at frame 152 (the 1-player start)

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80)
// then IN2 start1 (0x04), so the ROM's own credit/start logic starts a game and the
// state-3 dispatcher reaches loc_0986. A fresh copy per machine keeps runs independent.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded.
// Called with no argument for the baseline and with the wrapped override map for the
// optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously). The DK harness.js
// wrapper does not bake the timed inputTape, so the factory is built here (as in
// equivalence-08f8) -- the core engine is still the standard gate (it installs the
// snapshot override at CONSTRUCTION, so nothing here open-codes a reach-the-routine
// workaround).
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// Whole-machine teeth target: 0x7400, the first cell of sub_0852's tilemap clear,
// written on loc_0986's own call path. A display byte -- it does not drive dispatch,
// so a broken run finishes and the diff surfaces (0x600A would crash the next frame's
// dispatch; that is the UNIT teeth target instead).
const WHOLE_BROKEN_ADDR = 0x7400;
// Unit teeth target: loc_0986's OWN output store GAME_SUBSTATE (0x600A).
const UNIT_BROKEN_ADDR = 0x600a;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to `brokenAddr` lands a wrong value (correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and every
 * subroutine it calls run verbatim -- the representative "wrong value to one of the
 * routine's own output addresses" bug the gate must catch.
 */
function makeBroken(brokenAddr) {
  return (m) => {
    const realWrite = m.mem.write8.bind(m.mem);
    let broke = false;
    m.mem.write8 = (addr, value, busOffset) => {
      if (!broke && addr === brokenAddr) {
        broke = true;
        return realWrite(addr, value ^ 0xff, busOffset);
      }
      return realWrite(addr, value, busOffset);
    };
    try {
      return optimized_0986(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}

// -- pristine-entry capture (for the synthesised branch-coverage arms) ------------

/**
 * Capture the machine at the instant loc_0986 is FIRST entered (frame 152, the
 * 1-player / 0x600E==0 arm) and return that pristine clone. The natural run only
 * reaches that arm, so the two 2-player arms are proven by re-driving THIS entry with
 * the branch selectors (0x600E, 0x6026) forced.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0986(mm);
  }]]);
  makeMachine(snap).runFrames(FRAMES);
  if (entry === null) throw new Error("loc_0986 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/**
 * Prove translated == optimized for ONE branch of loc_0986. The branch is selected by
 * two RAM bytes -- the 0x600E join-value low byte and DIP_UPRIGHT (0x6026) -- poked
 * IDENTICALLY on both clones (the callees sub_0852/sub_011c never touch either byte,
 * so the poke survives to loc_0986's own reads). Diffs RAM + registers + pc, and
 * measures the total cycles each side charges so a collapsed branch the whole-machine
 * run does not reach still has committed cycle teeth (both clones m.call the same
 * oracle callees, so any cycle delta is loc_0986's own charge).
 */
function branchDiff(v600e, v6026, runOptimized = optimized_0986) {
  const a = ENTRY.clone(); a.mem.write8(0x600e, v600e); a.mem.write8(0x6026, v6026);
  const b = ENTRY.clone(); b.mem.write8(0x600e, v600e); b.mem.write8(0x6026, v6026);
  const ca0 = a.cycles, cb0 = b.cycles;
  translated_0986(a);
  runOptimized(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
    cyclesT: a.cycles - ca0,
    cyclesO: b.cycles - cb0,
  };
}

/**
 * Record loc_0986's 0x7D82 (flip-screen) HARDWARE writes and their bus cycle RELATIVE
 * to the routine's entry. 0x7D82 is a board latch, NOT in the compared state dump, so
 * the RAM+regs gate is blind to a shifted bus cycle; the emit --writes trace is where
 * it shows, and this is how it is pinned. The branch is forced by poking 0x600E/0x6026
 * identically to the run under test. (sub_011c adds its own hardware writes -- the
 * sound latches -- but those are identical on both sides and filtered out here.)
 */
function flip82Trace(fn, v600e, v6026) {
  const c = ENTRY.clone();
  c.mem.write8(0x600e, v600e); c.mem.write8(0x6026, v6026);
  c.mem.writeTrace = []; // clock is () => c.cycles from the constructor
  const c0 = c.cycles;
  fn(c);
  return c.mem.writeTrace
    .filter((w) => w.addr === 0x7d82)
    .map((w) => ({ rel: w.cycle - c0, value: w.value }));
}

/**
 * The fully-collapsed counterfactual (loc_0986's pre-fix shape): BOTH 0x7D82 writes
 * happen before the lump cycle charge, so write #1 is charged 17t early and the
 * cocktail write #2 collides onto it. The WRITE-TRACE teeth prove this is CAUGHT --
 * i.e. that the partial collapse around the hardware writes is load-bearing.
 */
function flatCollapsed_0986(m) {
  const { regs, mem } = m;
  m.push16(0x0989); m.step(0x0852, 17); m.call(0x0852);
  m.push16(0x098c); m.step(0x011c, 17); m.call(0x011c);
  regs.de = 0x7d82; regs.a = 0x01;
  mem.write8(regs.de, regs.a, 7); // write #1 with NO pre-charge -- shifted 17t early
  regs.hl = 0x600a; regs.a = mem.read8(0x600e); regs.and(regs.a);
  if (regs.fZ) { mem.write8(regs.hl, 0x01); m.step(0x099e, 71); m.ret(10); return; }
  regs.a = mem.read8(0x6026); regs.a = regs.dec8(regs.a);
  if (regs.fZ) { mem.write8(regs.hl, 0x03); m.step(0x09aa, 98); m.ret(10); return; }
  regs.xor(regs.a);
  mem.write8(regs.de, regs.a, 7); // write #2 collided onto write #1
  mem.write8(regs.hl, 0x03); m.step(0x09aa, 109); m.ret(10);
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0986 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0986]]));

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

test("EQUAL (unit): idiomatic optimized loc_0986 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0986, optimized_0986, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

test("BRANCH COVERAGE: every branch is proven EQUAL, with its collapsed cycle total", () => {
  // Three code paths, plus a second cocktail selector to exercise a non-1 join byte:
  //   0x600E==0            -> 1-player / substate 1 (branch A; naturally reached)
  //   0x600E!=0, 0x6026==1 -> 2-player upright / substate 3, flip ON  (own total 142)
  //   0x600E!=0, 0x6026!=1 -> 2-player cocktail / substate 3, flip OFF (own total 153)
  const arms = [
    { v600e: 0x00, v6026: 0x01, label: "1-player (600E=0)", ownTotal: 115 },
    { v600e: 0x01, v6026: 0x01, label: "2-player upright (600E!=0, 6026==1)", ownTotal: 142 },
    { v600e: 0x01, v6026: 0x00, label: "2-player cocktail (600E!=0, 6026!=1)", ownTotal: 153 },
    { v600e: 0x80, v6026: 0x00, label: "2-player cocktail, join hi (600E=0x80)", ownTotal: 153 },
  ];

  const results = [];
  for (const arm of arms) {
    const d = branchDiff(arm.v600e, arm.v6026);
    assert.equal(d.ram, null, d.ram ? `arm ${arm.label}: RAM diff at 0x${d.ram.addr.toString(16)} (t ${d.ram.a} vs o ${d.ram.b})` : "");
    assert.equal(d.regs, null, d.regs ? `arm ${arm.label}: reg diff at ${d.regs.reg} (t ${d.regs.a} vs o ${d.regs.b})` : "");
    assert.equal(d.pc, null, `arm ${arm.label}: pc must match`);
    // Committed cycle teeth: both clones m.call the SAME oracle callees, so callee
    // cycles cancel and any total difference is loc_0986's OWN charge. A wrong
    // collapsed total on this arm makes cyclesO != cyclesT and fails here.
    assert.equal(d.cyclesO, d.cyclesT, `arm ${arm.label}: optimized cycles ${d.cyclesO} != translated ${d.cyclesT}`);
    results.push({ ...arm, d });
  }

  // Cross-branch check that the exact collapsed per-branch sums (115/142/153) are
  // right: the callee floor cancels in a branch-to-branch delta, so
  // (cyclesT[arm] - cyclesT[branchA]) must equal (ownTotal[arm] - 115) on BOTH
  // oracle and optimized sides. Pins the absolute totals without hardcoding the floor.
  const base = results[0];
  for (const r of results) {
    const expectDelta = r.ownTotal - base.ownTotal;
    assert.equal(r.d.cyclesT - base.d.cyclesT, expectDelta, `arm ${r.label}: oracle own-total delta wrong`);
    assert.equal(r.d.cyclesO - base.d.cyclesO, expectDelta, `arm ${r.label}: optimized own-total delta wrong`);
  }
  console.log(`  BRANCH: all ${arms.length} arms EQUAL in RAM + registers + pc, collapsed totals exact (115/142/153)`);
});

// -- WRITE-TRACE (the hardware-write bus cycle the RAM gate cannot see) --------

test("WRITE-TRACE: the 0x7D82 flip-screen writes land at the oracle's exact bus cycle", () => {
  // Branch A (1-player start): a single flip-ON write.
  const oracleA = flip82Trace(translated_0986, 0x00, 0x01);
  const optA = flip82Trace(optimized_0986, 0x00, 0x01);
  assert.deepEqual(oracleA, [{ rel: 37282, value: 1 }], "oracle branch-A 0x7D82 trace unexpected");
  assert.deepEqual(optA, oracleA, "optimized branch-A 0x7D82 bus cycle differs from the oracle");

  // Cocktail (2-player, DIP!=1): flip ON then OFF, exactly 75t apart -- the two-write
  // case a blanket collapse most easily breaks.
  const oracleC = flip82Trace(translated_0986, 0x01, 0x00);
  const optC = flip82Trace(optimized_0986, 0x01, 0x00);
  assert.deepEqual(
    oracleC,
    [{ rel: 37282, value: 1 }, { rel: 37357, value: 0 }],
    "oracle cocktail 0x7D82 trace unexpected",
  );
  assert.deepEqual(optC, oracleC, "optimized cocktail 0x7D82 bus cycles differ from the oracle");

  // Teeth: the fully-collapsed counterfactual (both writes before the lump charge)
  // shifts write #1 17t early and collides write #2 onto it -- must be CAUGHT.
  const flatC = flip82Trace(flatCollapsed_0986, 0x01, 0x00);
  assert.notDeepEqual(flatC, oracleC, "write-trace check has no teeth");
  console.log(
    `  WRITE-TRACE: 0x7D82 writes @ +37282t (1P) and +37282t/+37357t (cocktail) identical to oracle; ` +
      `flat-collapse variant caught (${JSON.stringify(flatC.map((w) => w.rel))})`,
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong store on loc_0986's call path is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, makeBroken(WHOLE_BROKEN_ADDR)]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong GAME_SUBSTATE store is CAUGHT and names 0x600A", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0986, makeBroken(UNIT_BROKEN_ADDR), { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    UNIT_BROKEN_ADDR,
    `expected first diff at the broken address 0x${UNIT_BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
