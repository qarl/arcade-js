// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0a8a (INTRO_STEP 0: set up the opening
 * Kong-climb cutscene -- palette bank, the 0x380D record-table walk, three fixed
 * tiles, two walk-pointer seeds, arm the 64-frame timer, advance the step). Reached
 * via dispatchGameState (the NMI game-state path) as entry 0 of loc_0a76's 0x0A7A
 * rst-0x28 table, while GAME_SUBSTATE(0x600A)==7 and INTRO_STEP(0x6385)==0.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_0a8a reads EQUAL against
 *      its translated oracle in RAM and in the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *   3. SINGLE PATH + CYCLE TOTAL -- loc_0a8a is STRAIGHT-LINE (no data-dependent
 *      branch), so the one reachable path is what the whole/unit gates exercise.
 *      Because that path is COLLAPSED (epilogue 15 charges -> 1), the test also
 *      pins its cycle TOTAL to the oracle's, and shows a wrong total is caught.
 *   4. WRITE-TRACE -- loc_0a8a makes its OWN hardware writes (the two palette-bank
 *      latches). The RAM+regs gate can't see the emit.js --writes trace's cycle
 *      column, so this proves the two writes land at the oracle's exact write-bus
 *      cycle -- and that a fully-collapsed prologue would shift them (teeth).
 *   5. TEETH (whole + unit) -- a deliberately-wrong output store is CAUGHT, naming
 *      the diverging address (0x62AF).
 *
 * WHY THIS TEST DRIVES INPUT (and uses core/equivalence.js directly, like
 * equivalence-08f8/06fe). The Kong-climb intro only runs once a credit is inserted
 * and a start button pressed -- loc_0a8a NEVER dispatches in attract (0 over 1200
 * attract frames). So both gates feed the canonical coin+start tape (IN2 coin 0x80,
 * then IN2 start1 0x04) via a custom makeMachine factory and drive the game-agnostic
 * CORE equivalence engine with it -- the DK harness.js wrapper bakes `inputs` but
 * not the timed `inputTape`. The core engine is still the standard gate (it installs
 * the snapshot override at CONSTRUCTION, so nothing here open-codes a reach-the-
 * routine workaround). With this tape loc_0a8a dispatches EXACTLY ONCE, at frame 96;
 * FRAMES = 130 covers it plus ~34 downstream frames so a wrong cycle total surfaces.
 *
 * THE CYCLE FINDING this routine adds: loc_0a8a is ATOMIC and COLLAPSED, but only
 * PARTIALLY in the prologue. It runs INSIDE the vblank NMI (dispatchGameState),
 * which does not re-enter, so the NMI never lands inside it or sub_0da7 (frame 96 is
 * a 42378-cycle frame; the NMI landed inside 0 times). So the epilogue's per-
 * instruction charges collapse to one 163t total. The total is still load-bearing --
 * a 1-cycle error diverges the whole-machine trace at STACK 0x6bee, frame 120 (the
 * spin-count / shifted-NMI-landing mechanism, README §2). The prologue keeps 4/17/40
 * granularity ONLY so its two palette-latch hardware writes keep their exact write-
 * bus cycle in the trace, which the RAM gate cannot police (see WRITE-TRACE below).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a8a as translated_0a8a } from "../../translated/state0.js";
import { loc_0a8a as optimized_0a8a } from "../loc_0a8a.js";
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

const TARGET = 0x0a8a;
const FRAMES = 130; // loc_0a8a dispatches exactly once, at frame 96

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80)
// then IN2 start1 (0x04) so the ROM's own credit/start logic starts a game and the
// Kong-climb intro runs. A fresh copy per machine keeps each run's tape independent.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded.
// Called with no argument for the baseline and with the wrapped override map for the
// optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously).
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// loc_0a8a's own output store the teeth corrupt: 0x62AF (work-RAM cutscene
// bookkeeping, written 0). It is written ONLY by loc_0a8a (sub_0da7 does not touch
// it), sits in the compared work-RAM dump, and is not rewritten in the run window,
// so a wrong value there persists -- the representative "wrong value to one of the
// routine's own output addresses" bug the gate must catch. (The three video-RAM
// tiles are unsuitable: sub_0da7 also writes that region, so a first-write flip is
// overwritten. Corrupting a control byte would crash dispatch instead of diffing.)
const BROKEN_ADDR = 0x62af;

function broken_0a8a(m) {
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
    return optimized_0a8a(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated single-path / cycle / trace checks) --

/** Capture the machine the instant loc_0a8a is FIRST entered (frame 96). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0a8a(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_0a8a never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry; return {machine, cyclesSpent}. */
function runClone(fn) {
  const c = ENTRY.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Run `fn` on a fresh clone with the hardware write-trace recording. */
function traceClone(fn) {
  const c = ENTRY.clone();
  c.mem.writeTrace = []; // clock is () => c.cycles from the constructor
  const c0 = c.cycles;
  fn(c);
  // Report each write's cycle RELATIVE to entry so it is base-independent.
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0a8a matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0a8a]]));

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
      `override fired ${r.invocations.get(TARGET)}x (frame 96)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0a8a matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0a8a, optimized_0a8a, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- SINGLE PATH + CYCLE TOTAL ------------------------------------------------

test("SINGLE PATH + CYCLE TOTAL: the one straight-line path is EQUAL and preserves the total", () => {
  // loc_0a8a has no data-dependent branch: one path, exercised in isolation here.
  const a = runClone(translated_0a8a);
  const b = runClone(optimized_0a8a);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // Committed cycle teeth for the collapsed path: the optimized total equals the
  // oracle's exactly (both run the same sub_0da7 via m.call, so the delta pins
  // loc_0a8a proper = 234t + sub_0da7's identical charges).
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);

  // ...and the assertion is not vacuous: a 1-cycle error in the collapsed epilogue
  // total makes the totals disagree.
  const wrong = runClone((m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x0abe ? cyc - 1 : cyc);
    try { return optimized_0a8a(m); } finally { m.step = realStep; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t (loc_0a8a proper 234t); wrong-total caught`);
});

// -- WRITE-TRACE (the hardware-write bus cycle the RAM gate cannot see) --------

test("WRITE-TRACE: the two palette-bank writes land at the oracle's exact bus cycle", () => {
  const oracleTrace = traceClone(translated_0a8a);
  const optTrace = traceClone(optimized_0a8a);

  // Exactly two hardware writes: palette bank LO (0x7D86<-0) @ +14t, HI (0x7D87<-1)
  // @ +31t. (sub_0da7 writes only work/video RAM, so it adds no hardware writes.)
  assert.deepEqual(
    oracleTrace,
    [{ rel: 14, addr: 0x7d86, value: 0 }, { rel: 31, addr: 0x7d87, value: 1 }],
    "oracle hardware-write trace is not the expected two palette writes",
  );
  assert.deepEqual(optTrace, oracleTrace, "optimized palette-write bus cycles differ from the oracle");

  // Teeth: a FULLY-collapsed prologue (both writes before the lump charge) would
  // shift both to +0 -- proving the partial collapse is what preserves the trace.
  const flat = traceClone((m) => {
    const { regs, mem } = m;
    regs.xor(regs.a);
    mem.write8(0x7d86, regs.a, 10); // written at +0t, not +14t
    regs.a = regs.inc8(regs.a);
    mem.write8(0x7d87, regs.a, 10); // written at +0t, not +31t
    regs.de = 0x380d;
    m.push16(0x0a98);
    m.step(0x0da7, 61); // whole prologue in one lump
    m.call(0x0da7);
    m.step(0x0abe, 163);
    m.ret();
  });
  assert.notDeepEqual(flat, oracleTrace, "write-trace check has no teeth");
  console.log("  WRITE-TRACE: palette writes @ +14t/+31t identical to oracle; flat-prologue variant caught");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong bookkeeping store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0a8a]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong bookkeeping store is CAUGHT and names 0x62AF", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0a8a, broken_0a8a, { maxFrames: FRAMES });

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
