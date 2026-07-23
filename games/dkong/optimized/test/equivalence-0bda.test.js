// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0bda (game state 3 / in-game, sub-state 8:
 * build the "HOW HIGH CAN YOU GET?" interlude screen). It is an NMI GAME-STATE
 * routine, reached via dispatchGameState off GAME_STATE==3 -> the 0x0702 sub-state
 * table[8] (0x600A==8).
 *
 * DRIVING IT. loc_0bda never runs from an idle boot (attract never reaches the
 * how-high setup), so every gate here drives a full COIN + START: IN2 bit7
 * (IN2_COIN1) is pulsed low->high during attract (GAME_STATE 1->2), then IN2 bit2
 * (IN2_START1) is pulsed to begin the game (GAME_STATE 2->3); the ROM's own
 * progression then reaches sub-state 8 and loc_0bda dispatches EXACTLY ONCE at
 * frame 849. Both pulses are delivered through the standard harness's
 * `assets.inputs` seam so they are applied identically to the baseline and
 * optimized sides; `COIN_ASSETS.inputs` is a GETTER so each machine the harness
 * builds gets its OWN fresh read counter (a shared counter would desync the two).
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized loc_0bda reads EQUAL against its translated
 *      oracle, whole-machine and unit. The override reaches it however it is
 *      entered: the whole-machine gate through dispatchGameState's override consult
 *      (nmi.js), the unit gate through the construction-time snapshot override the
 *      standard harness installs.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_0bda
 *      dispatches once, at frame 849; an 860-frame window covers it.
 *
 *   3. TEETH -- a deliberately-broken twin (loc_0bda's own HOW_HIGH_LAST_SEQ store
 *      lands the wrong value at 0x622F) must be CAUGHT: NOT-EQUAL, naming 0x622F.
 *      0x622F is a work-RAM byte loc_0bda writes once and nothing rewrites within
 *      the window, so the corruption persists into the compared state dump.
 *
 *   4. BRANCH COVERAGE -- loc_0bda has three data-dependent decisions plus a
 *      variable-count loop: the rst-0x18 gate (skip vs run the body), the
 *      HOW_HIGH_INDEX clamp (keep <6 vs set to 5), the height-step compare
 *      (BOARD_SEQ_PTR == HOW_HIGH_LAST_SEQ, skip vs +1), and the outer paint loop
 *      (1 row / several rows / the 256-row do-while wrap). Each is proven EQUAL on a
 *      SYNTHESISED entry (RAM + all registers + pc), and -- because the cycles are
 *      COLLAPSED to one total per call-boundary -- each also asserts its CYCLE TOTAL
 *      equals the oracle's (measured across the routine on both clones), so a wrong
 *      collapsed total on any arm has teeth even though the natural run reaches only
 *      the gate-run / clamp-keep / step-take / 1-row arm.
 *
 *   5. THE CYCLE FINDING -- loc_0bda is ATOMIC (it runs inside the vblank NMI, whose
 *      handler clears the NMI mask, so no NMI re-fires inside it; and the NMI fires
 *      at cycle 0 of the frame with the whole 50688-cycle budget ahead, while the
 *      invocation is ~37863 cycles, so no frame boundary is crossed mid-routine).
 *      Its cycle charges are therefore collapsed to one m.step total per call-
 *      boundary and stay EQUAL. But the TOTAL is load-bearing (same universal lesson
 *      as loc_08ba / handler_01c3, README §2): the branch cycle assertions in job 4
 *      pin each arm's total to the oracle's exact per-instruction sum.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0bda as translated_0bda } from "../../translated/state0.js";
import { loc_0bda as optimized_0bda } from "../loc_0bda.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";
import { IN2_COIN1, IN2_START1 } from "../../../../boards/dkong/io.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0bda;
const FRAMES = 860; // loc_0bda fires exactly once, at frame 849
const MAX_FRAMES = 900; // unit gate: run this long to reach the first entry

// loc_0bda's own store to work RAM used as the teeth target: HOW_HIGH_LAST_SEQ
// (0x622F). loc_0bda writes it once (= BOARD_SEQ_PTR's low byte) and reads it back
// nowhere, and nothing else rewrites it within the window, so a wrong value there is
// the sole persistent divergence.
const BROKEN_ADDR = 0x622f;

// Coin pulse on IN2 bit7 (IN2_COIN1) for reads [20,40) -- one clean low->high edge
// the ROM credits (GAME_STATE 1->2) -- then a START pulse on IN2 bit2 (IN2_START1)
// for reads [200,260) to begin the game (GAME_STATE 2->3). The ROM's own sub-state
// progression then reaches loc_0bda at frame 849. Stateless apart from its counter.
function makeCoinStartInputs() {
  let reads = 0;
  return {
    service1: false,
    in0() { return 0; },
    in1() { return 0; },
    in2() {
      let v = 0;
      if (reads >= 20 && reads < 40) v |= IN2_COIN1;
      if (reads >= 200 && reads < 260) v |= IN2_START1;
      reads += 1;
      return v;
    },
    dsw0() { return 0x80; },
  };
}

// `inputs` is a GETTER so every machine the harness constructs gets a fresh counter,
// applied identically to both sides. The coin/start is the only assets we need (the
// state dump the gate compares needs no gfx/proms).
const COIN_ASSETS = { get inputs() { return makeCoinStartInputs(); } };

/**
 * Deliberately-broken twin: the optimized handler EXCEPT its first store to 0x622F
 * lands a wrong value (correct XOR 0xFF, guaranteed to differ). Intercepting exactly
 * that one write lets the rest of the routine and every subroutine it calls run
 * verbatim -- the representative "wrong value to one of the routine's own output
 * addresses" bug the gate must catch.
 */
function broken_0bda(m) {
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
    return optimized_0bda(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * Fully-collapsed twin (for the write-trace teeth): defers the seed prologue's three
 * per-instruction charges (0x0BED/0x0BEF/0x0BF0 = 26t) to 0x0BF2, so BOTH palette-bank
 * HARDWARE writes execute at the segment-entry cycle (+7t, colliding) instead of the
 * oracle's +17t/+33t. The routine's TOTAL cycles and all RAM/registers are unchanged,
 * so ONLY the write-trace check can catch the shift -- this is the exact defect a
 * blanket collapse across a hardware write would introduce.
 */
function flat_0bda(m) {
  const realStep = m.step.bind(m);
  let deferred = 0;
  m.step = (addr, cyc) => {
    if (addr === 0x0bed || addr === 0x0bef || addr === 0x0bf0) { deferred += cyc; return undefined; }
    if (addr === 0x0bf2) { const c = cyc + deferred; deferred = 0; return realStep(addr, c); }
    return realStep(addr, cyc);
  };
  try {
    return optimized_0bda(m);
  } finally {
    m.step = realStep;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0bda matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, COIN_ASSETS, FRAMES, new Map([[TARGET, optimized_0bda]]));

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

test("EQUAL (unit): idiomatic optimized loc_0bda matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, COIN_ASSETS, TARGET, translated_0bda, optimized_0bda, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong HOW_HIGH_LAST_SEQ store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, COIN_ASSETS, FRAMES, new Map([[TARGET, broken_0bda]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong HOW_HIGH_LAST_SEQ store is CAUGHT and names 0x622F", () => {
  const r = unitEquivalence(ROM, COIN_ASSETS, TARGET, translated_0bda, broken_0bda, { maxFrames: MAX_FRAMES });

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

// -- BRANCH COVERAGE ----------------------------------------------------------
//
// loc_0bda's data-dependent decisions -- the rst-0x18 gate, the clamp, the height
// step, and the variable-count paint loop -- are each proven EQUAL on a synthesised
// entry (RAM + registers + pc), and, because the cycles are collapsed to one total
// per call-boundary, each also asserts its CYCLE TOTAL equals the oracle's. Building
// a machine to capture a pristine entry is the sanctioned way to synthesise a branch
// state (README/brief); the coin/start drives it there.

/** Capture a pristine machine clone at the instant loc_0bda is first entered. */
function captureEntry() {
  let entry = null;
  const overrides = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0bda(mm);
  }]]);
  const host = new Machine(ROM, { inputs: makeCoinStartInputs(), overrides });
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error("loc_0bda never entered while capturing branch entry");
  return entry;
}

/**
 * Diff translated vs optimized loc_0bda on the captured entry after applying `setup`
 * (the deciding RAM) IDENTICALLY to both clones. Returns the state/reg/pc diff AND
 * the cycle delta each side charged, so a wrong collapsed total is caught too.
 */
function branchEqual(entry, setup) {
  const a = entry.clone();
  const b = entry.clone();
  setup(a);
  setup(b);
  const cycA = a.cycles;
  const cycB = b.cycles;
  translated_0bda(a);
  optimized_0bda(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o));
  const regs = firstRegDiff(a.regs, b.regs);
  const pc = a.pc === b.pc ? null : { a: a.pc, b: b.pc };
  return {
    equal: !ram && !regs && !pc,
    ram,
    regs,
    pc,
    cycTranslated: a.cycles - cycA,
    cycOptimized: b.cycles - cycB,
    subTimer: b.mem.read8(0x6009), // 0xA0 => body re-armed it; 4 => gate skipped the body
  };
}

test("BRANCH (synthesised): every reachable arm reads EQUAL, RAM + regs + pc + cycles", () => {
  const entry = captureEntry();
  // [label, setup, expectSkipped] -- setup pokes: 0x6009 gate, 0x622E clamp/row-count,
  // 0x622A board-seq low, 0x622F saved copy. Gate runs when 0x6009 dec's to 0.
  const p = (m, six, e, a, f) => {
    m.mem.write8(0x6009, six);
    if (e !== null) m.mem.write8(0x622e, e);
    if (a !== null) m.mem.write8(0x622a, a);
    if (f !== null) m.mem.write8(0x622f, f);
  };
  const cases = [
    // gate NOT expired -> body skipped, early return (0x6009 dec'd 5->4, not re-armed).
    ["gate-skip (early return)", (m) => p(m, 5, null, null, null), true],
    // gate expired (0x6009=1) -> body runs. clamp keep/set5 x step take/skip x rows.
    ["run keep / step-take / 1 row",  (m) => p(m, 1, 0, 0x65, 0), false],
    ["run keep / step-take / 2 rows", (m) => p(m, 1, 1, 0x40, 0), false],
    ["run keep / step-skip / 3 rows", (m) => p(m, 1, 3, 0x40, 0x40), false],
    ["run keep / step-skip / 5 rows", (m) => p(m, 1, 5, 0x40, 0x40), false],
    ["run set5 / step-take / 6 rows", (m) => p(m, 1, 8, 0x40, 0), false],
    ["run set5 / step-skip / 5 rows", (m) => p(m, 1, 9, 0x40, 0x40), false],
    // do-while wrap: 0x622E==0 with step-skip -> B dec's 0->0xFF -> 256 rows painted.
    ["run keep / step-skip / 256-row wrap", (m) => p(m, 1, 0, 0x40, 0x40), false],
  ];
  for (const [label, setup, expectSkipped] of cases) {
    const r = branchEqual(entry, setup);
    assert.equal(
      r.equal,
      true,
      r.equal ? "" : `[${label}] diverged: ram=${r.ram ? "0x" + r.ram.addr.toString(16) : null} ` +
        `regs=${r.regs ? r.regs.reg : null} pc=${r.pc ? JSON.stringify(r.pc) : null}`,
    );
    assert.equal(
      r.cycOptimized,
      r.cycTranslated,
      `[${label}] collapsed cycle total ${r.cycOptimized} != oracle ${r.cycTranslated}`,
    );
    // The gate arm must actually take the branch we intend, or the coverage is vacuous.
    assert.equal(
      r.subTimer,
      expectSkipped ? 0x04 : 0xa0,
      `[${label}] expected 0x6009=${expectSkipped ? "0x04 (skipped)" : "0xA0 (body ran)"}, got 0x${r.subTimer.toString(16)}`,
    );
    console.log(`  BRANCH ${label}: EQUAL (RAM + regs + pc), cycles ${r.cycOptimized} == oracle`);
  }
});

// -- WRITE-TRACE (the hardware-write bus cycle the RAM+regs gate cannot see) ---
//
// loc_0bda's only hardware writes are the two palette-bank latches (0x7D86/0x7D87);
// a hardware write is recorded in the emit --writes trace at its write-bus cycle
// (clock()+busOffset), a column the RAM+regs equivalence gate CANNOT see. The seed
// prologue is only PARTIALLY collapsed so these two land at the oracle's exact cycle
// (16t apart) rather than colliding at the segment entry -- proven here, with teeth.

/** Run `fn` on a fresh clone of `entry` with hardware-write-trace recording. */
function traceClone(entry, fn) {
  const c = entry.clone();
  c.mem.writeTrace = []; // clock is () => c.cycles, wired at construction
  const c0 = c.cycles;
  fn(c);
  // Each write's cycle RELATIVE to entry, so it is base-independent.
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

test("WRITE-TRACE: the palette-bank hardware writes land at the oracle's exact bus cycle", () => {
  const entry = captureEntry();
  const oracleTrace = traceClone(entry, translated_0bda);
  const optTrace = traceClone(entry, optimized_0bda);

  // The WHOLE hardware-write trace is identical: the sound-silence writes 0x011C makes
  // (0x7D00-0x7D07, 0x7D80, 0x7C00) are the same on both sides (an identical callee at
  // an identical cumulative cycle), and loc_0bda's own two palette writes match too.
  assert.deepEqual(optTrace, oracleTrace, "optimized hardware-write bus cycles differ from the oracle");

  // The two palette writes specifically: 0x7D86<-1 then 0x7D87<-0, exactly 16t apart.
  const palette = (t) => t.filter((w) => w.addr === 0x7d86 || w.addr === 0x7d87);
  const pal = palette(oracleTrace);
  assert.equal(pal.length, 2, "expected exactly two palette-bank hardware writes");
  assert.deepEqual(
    [pal[0].addr, pal[0].value, pal[1].addr, pal[1].value],
    [0x7d86, 1, 0x7d87, 0],
    "palette writes are not 0x7D86<-1 then 0x7D87<-0",
  );
  assert.equal(pal[1].rel - pal[0].rel, 16, "palette writes are not 16t apart (the oracle's ld hl/ld(hl)/inc hl spacing)");
  assert.deepEqual(palette(optTrace), pal, "optimized palette-write bus cycles differ from the oracle");

  // Teeth: a FULLY-collapsed seed prologue collapses both palette writes to the
  // segment-entry cycle (+7t/+7t, colliding) -- the exact bus-cycle shift the RAM+regs
  // gate misses. The write-trace check must catch it.
  const flatTrace = traceClone(entry, flat_0bda);
  assert.notDeepEqual(flatTrace, oracleTrace, "write-trace check has no teeth");
  const flatPal = palette(flatTrace);
  assert.equal(flatPal[0].rel, flatPal[1].rel, "flat variant should collide both palette writes");
  console.log(
    `  WRITE-TRACE: palette @ +${pal[0].rel}t/+${pal[1].rel}t (16t apart) identical to oracle; ` +
      `flat variant caught (both collapsed to +${flatPal[0].rel}t)`,
  );
});
