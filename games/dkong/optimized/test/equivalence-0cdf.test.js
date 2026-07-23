// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0cdf (board 2 / 50m conveyor setup: point DE at
 * the 0x3B5D conveyor layout table, select palette bank %01 via the two ls259.6h
 * latches, set the 50m background tune, then tail-jump the shared board-draw tail).
 *
 * loc_0cdf is a LEAF reached only via `m.call(0x0cdf)` from loc_0c92's board-type
 * `dec a / jp z` cascade, on the board-2 arm (BOARD==2). loc_0c92 itself is entered
 * on that path from loc_0c91 -- the 0x0702 table's index-10 target, dispatched
 * INSIDE the vblank NMI (dispatchGameState) while GAME_STATE==3 && GAME_SUBSTATE==10.
 * (Its other entry, handler_0763's tail, forces BOARD=1 and never reaches this arm.)
 *
 * Six jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_0cdf reads EQUAL against
 *      its translated oracle in RAM and in the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *   3. SINGLE PATH + CYCLE TOTAL -- loc_0cdf is STRAIGHT-LINE (no data-dependent
 *      branch), so the one reachable path is the whole coverage. Because it is
 *      COLLAPSED (the four tail charges -> one 40t lump), the test pins the cycle
 *      TOTAL to the oracle's and shows a wrong total is caught.
 *   4. WRITE-TRACE -- loc_0cdf makes its OWN hardware writes (the two palette-bank
 *      latches). The RAM+regs gate can't see the emit.js --writes bus-cycle column,
 *      so this proves 0x7D86<-1 @ +27 and 0x7D87<-0 @ +43 land at the oracle's exact
 *      bus cycle -- and that a fully-collapsed prologue would shift them (teeth).
 *   5/6. TEETH (whole + unit) -- a deliberately-wrong output store is CAUGHT, naming
 *      the diverging RAM address (SND_BGM 0x6089).
 *
 * WHY THIS TEST DRIVES A POKE (like loc_0c91 / loc_0a8a, and cannot use the DK
 * harness.js wrapper directly). Board 2 is only set up after board 1 is completed,
 * which no bounded boot/coin+start run reaches. So these tests force it with an
 * IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke the board state to reach a
 * state for validation" -- applied to baseline and optimized alike, so equivalence
 * is preserved): a one-shot poke at frame 100 sets GAME_STATE=3, GAME_SUBSTATE=10
 * (select loc_0c91), SUBSTATE_TIMER=1 (the rst 0x18 gate expires immediately ->
 * PROCEED into loc_0c92 that very frame), and BOARD=2 (so loc_0c92's cascade takes
 * the loc_0cdf arm). The poke is threaded via a custom `makeMachine` factory
 * (m.pokes) driving the game-agnostic CORE engine (core/equivalence.js) -- the same
 * construction-time snapshot override the DK harness wrapper uses, just with a
 * factory that can carry the poke, which the wrapper's fixed (rom, assets) factory
 * cannot. No hand-rolled snapshot workaround: the reachability wiring is the engine's.
 *
 * THE CYCLE FINDING this routine adds: loc_0cdf is ATOMIC (NMI-dispatched, mask
 * held) and COLLAPSED, but only PARTIALLY in the prologue -- because it makes its
 * own two palette-bank HARDWARE writes, whose bus cycle the RAM gate cannot police.
 * The prologue keeps 20t/16t granularity so those writes trace at +27/+43; the tail
 * (work RAM + jp) collapses to one 40t lump. Total 76t, preserved exactly.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0cdf as translated_0cdf } from "../../translated/nmi.js";
import { loc_0cdf as optimized_0cdf } from "../loc_0cdf.js";
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

const TARGET = 0x0cdf;
const FRAMES = 130; // loc_0cdf forced to dispatch once, at frame 100 (immediate PROCEED)
const SND_BGM = 0x6089; // loc_0cdf's own work-RAM output store (50m tune = 9)
const PALETTE_BANK_LO = 0x7d86;
const PALETTE_BANK_HI = 0x7d87;
const POKE_FRAME = 100;

// Identical-both-sides one-shot poke that forces board-2 setup: GAME_STATE=3 (in-game
// -> loc_06fe dispatch), GAME_SUBSTATE=10 (-> loc_0c91), SUBSTATE_TIMER=1 (rst 0x18
// expires -> PROCEED into loc_0c92 this frame), BOARD=2 (loc_0c92 cascade -> loc_0cdf).
const FORCE_0CDF_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3
  { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> loc_0c91
  { addr: 0x6009, val: 0x01, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 1 -> PROCEED now
  { addr: 0x6227, val: 0x02, frame: POKE_FRAME, dur: 1 }, // BOARD = 2 (50m) -> loc_0cdf arm
];

// The engine's factory: a DK Machine on this ROM with the force-board-2 poke loaded.
// Called with no argument for the baseline and with the wrapped override map for the
// optimized side (the core engine wraps each override with its own invocation counter,
// so an EQUAL that never dispatched cannot pass vacuously). Fresh poke copy per machine.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_0CDF_POKE.map((p) => ({ ...p }));
  return m;
};

// loc_0cdf's own output store the teeth corrupt: SND_BGM (0x6089, work RAM, written 9).
// Flip bit 0 (9 -> 8): still a VALID board-mode tune index (won't crash the sound
// driver downstream), yet differs immediately and persists (0x6089 is written only by
// board setup, not rewritten in the run window). Intercepting exactly that one write
// lets the rest of the routine and its whole m.call tail run verbatim -- the
// representative "wrong value to one of the routine's own output addresses" bug.
function broken_0cdf(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === SND_BGM) {
      broke = true;
      return realWrite(addr, value ^ 0x01, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_0cdf(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated single-path / cycle / trace checks) --

/** Capture the machine the instant loc_0cdf is FIRST entered (frame 100, via the
 *  construction-time snapshot override the core engine installs -- it reaches leaf
 *  routines called only through m.call). Reusing a real captured entry gives a valid
 *  stack (the tail's `ret` unwinds it) and realistic board/RAM state. */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0cdf(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_0cdf never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry; return {m, cycles}. */
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
  // Each write's cycle RELATIVE to entry so it is base-independent.
  return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

// loc_0cdf's own two hardware writes, at their exact bus cycle relative to entry:
// palette LO (0x7D86<-1) @ +27 and HI (0x7D87<-0) @ +43. (The shared tail, run via
// m.call, may add further hardware writes AFTER these -- identical on both sides.)
const LOC_0CDF_WRITES = [
  { rel: 27, addr: PALETTE_BANK_LO, value: 1 },
  { rel: 43, addr: PALETTE_BANK_HI, value: 0 },
];

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0cdf matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0cdf]]));

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
      `override fired ${r.invocations.get(TARGET)}x (frame 100, board-2 setup)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0cdf matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0cdf, optimized_0cdf, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- SINGLE PATH + CYCLE TOTAL ------------------------------------------------

test("SINGLE PATH + CYCLE TOTAL: the one straight-line path is EQUAL and preserves the total", () => {
  // loc_0cdf has no data-dependent branch: one path, exercised in isolation here.
  const a = runClone(translated_0cdf);
  const b = runClone(optimized_0cdf);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // Committed cycle teeth for the collapsed path: the optimized total equals the
  // oracle's exactly (both run the same shared tail via m.call, so the delta pins
  // loc_0cdf proper = 76t + the tail's identical charges).
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);

  // ...and the assertion is not vacuous: a 1-cycle error in loc_0cdf's collapsed tail
  // charge makes the totals disagree.
  const wrong = runClone((m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x0cc6 ? cyc - 1 : cyc);
    try { return optimized_0cdf(m); } finally { m.step = realStep; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t (loc_0cdf proper 76t); wrong-total caught`);
});

// -- WRITE-TRACE (the hardware-write bus cycle the RAM gate cannot see) --------

test("WRITE-TRACE: the two palette-bank writes land at the oracle's exact bus cycle", () => {
  const oracleTrace = traceClone(translated_0cdf);
  const optTrace = traceClone(optimized_0cdf);

  // loc_0cdf's own writes are the FIRST two hardware writes: palette LO (0x7D86<-1)
  // @ +27, HI (0x7D87<-0) @ +43. (The shared draw tail runs via m.call and may add
  // further hardware writes after these -- identical on both sides.)
  assert.deepEqual(
    oracleTrace.slice(0, 2),
    LOC_0CDF_WRITES,
    "oracle hardware-write trace does not start with the expected two palette writes",
  );
  assert.deepEqual(optTrace, oracleTrace, "optimized shifted a hardware-write bus cycle");

  // Teeth: a FULLY-collapsed prologue (both writes before the lump charge) would
  // shift both to +0 -- proving the partial collapse is what preserves the trace.
  const flat = traceClone((m) => {
    const { regs, mem } = m;
    regs.de = 0x3b5d;
    regs.hl = PALETTE_BANK_LO;
    mem.write8(PALETTE_BANK_LO, 0x01, 7); // written at +0t, not +27t
    regs.hl = PALETTE_BANK_HI;
    mem.write8(PALETTE_BANK_HI, 0x00, 7); // written at +0t, not +43t
    regs.a = 0x09;
    mem.write8(SND_BGM, regs.a);
    m.step(0x0cc6, 76); // whole routine in one lump
    return m.call(0x0cc6);
  });
  assert.notDeepEqual(flat.slice(0, 2), LOC_0CDF_WRITES, "write-trace check has no teeth");
  console.log("  WRITE-TRACE: palette writes @ +27t/+43t identical to oracle; flat-prologue variant caught");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SND_BGM store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0cdf]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong SND_BGM store is CAUGHT and names 0x6089", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0cdf, broken_0cdf, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    SND_BGM,
    `expected first diff at the broken address 0x${SND_BGM.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
