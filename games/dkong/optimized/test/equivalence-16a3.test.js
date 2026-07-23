// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_16a3 (the board-advance object-block LOAD,
 * selector entry 0 of loc_1615's 0x1637 rst-0x28 table). It is dispatched from
 * INSIDE the vblank NMI during BOARD-ADVANCE: dispatchGameState(GAME_STATE
 * (0x6005)==3) -> loc_06fe -> loc_1615 (GAME_SUBSTATE(0x600A)==0x16) -> rst 0x28
 * on the 0x6388 selector via the table at 0x1637 ([16a3,16bb,1732,1757,178e])
 * when BOARD(0x6227) has bit0 clear / bit1 set (e.g. 0x02=50m) -> this routine
 * when 0x6388==0. It is the exact sibling of loc_17b6 (entry 0 of the neighbouring
 * 0x1648 table), and this test mirrors equivalence-17b6.test.js.
 *
 * Eight jobs, as for loc_17b6 (straight-line: no data-dependent branch) plus a
 * write-trace check because loc_16a3's callees make hardware writes:
 *
 *   1. EQUAL -- the idiomatic optimized loc_16a3 (optimized/loc_16a3.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      routes through dispatchGameState's override consult, inert when the map is
 *      empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_16a3
 *      runs only during board-advance, which a bounded boot never reaches. So
 *      these tests force it with an IDENTICAL-BOTH-SIDES poke (Karl's sanctioned
 *      "poke the board state to reach a state for validation" -- applied to
 *      baseline and optimized alike, so equivalence is preserved): from frame 100
 *      it HOLDS GAME_STATE(0x6005)=3, GAME_SUBSTATE(0x600A)=0x16 (board-advance),
 *      BOARD(0x6227)=2 (routes to the 0x1637 table), and the selector 0x6388=0
 *      (entry 0 = loc_16a3). Held across the window so loc_16a3 dispatches every
 *      frame (~40x). Threaded via a custom makeMachine factory (m.pokes) driving
 *      the game-agnostic CORE engine, exactly like loc_17b6/loc_0a8a -- the DK
 *      harness.js wrapper bakes `assets` but not the timed pokes.
 *
 *   3. TEETH -- a deliberately-broken twin (the first write to 0x6905 lands the
 *      wrong value) must be CAUGHT: NOT-EQUAL, naming 0x6905, whole and unit.
 *      loc_16a3's ONLY own store is `inc (0x6388)`, which is unsuitable for teeth:
 *      0x6388 is the dispatch selector, re-poked to 0 every frame (so a corruption
 *      is erased before the next state sample) and corrupting it would change the
 *      dispatch index. So the teeth corrupt the first PERSISTENT store on the
 *      routine's path -- 0x6905<-0x13, written exactly once by sub_1708 and by
 *      nothing else, in the diffed work RAM and not re-poked, so a wrong value
 *      there persists. (The other callee stores are unsuitable: 0x608A/0x608B are
 *      the sound scheduler's SND_PRIORITY pair, re-managed within a frame; the
 *      0x6908.. block is overwritten by the copy each frame.)
 *
 *   4. SINGLE PATH + CYCLE TOTAL -- loc_16a3 is STRAIGHT-LINE (no data-dependent
 *      branch), so the one reachable path IS full branch coverage, exercised by
 *      EQUAL/whole (override fires) and pinned in isolation here: on a captured
 *      entry the optimized total equals the oracle's exactly, and a 1-cycle error
 *      in the collapsed epilogue is caught.
 *
 *   5. CYCLE (unit, isolated) -- with all three callees stubbed to charge nothing,
 *      loc_16a3's OWN charge is 120t on BOTH oracle and optimized (the collapse is
 *      a redistribution of the SAME total, not a cheaper one).
 *
 *   6. CYCLE (whole-machine) -- a WRONG collapsed total (119: epilogue 20 not 21)
 *      is CAUGHT and NOT-EQUAL, proving the collapsed total is load-bearing.
 *
 *   7. WRITE-TRACE -- loc_16a3 itself writes NO hardware register, but its callee
 *      sub_1708 begins with call 0x011C (the sound driver), which latches
 *      0x7C00 / 0x7D00-0x7D07 / 0x7D80. Those writes have a bus-cycle position the
 *      RAM+regs gate cannot see. Because the seg-A charge (17t, just the `call`)
 *      sits immediately before m.call(0x1708), the callee starts at the oracle's
 *      exact +17t and those writes keep their bus cycle; this proves it, and shows
 *      a fully-collapsed prologue (starting the call early) would shift them.
 *
 * THE CYCLE FINDING this routine adds: loc_16a3 is ATOMIC because it is dispatched
 * from inside the NMI, where the mask is held -- the vblank NMI can never land
 * inside it OR any of its three callees (0x1708/0x004E/0x0038), which all run with
 * interrupts disabled. So its ~11 per-instruction m.step charges collapse to one
 * per call-segment (17/47/25) plus one call-free epilogue (21); own total 120t.
 * The TOTAL stays load-bearing -- as part of the NMI's cost it sets the main-loop
 * vblank-spin count (README §2) -- so the sum is preserved exactly; a wrong 119
 * diverges at STACK 0x6BFE (an NMI-pushed PC in diffed stack RAM), the same
 * downstream-landing mechanism as loc_17b6/loc_0a8a/entry_0611.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_16a3 as translated_16a3 } from "../../translated/state0.js";
import { loc_16a3 as optimized_16a3 } from "../loc_16a3.js";
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

const TARGET = 0x16a3;
const POKE_FRAME = 100;
const HOLD_DUR = 40; // held across the rest of the window so loc_16a3 dispatches ~40x
const FRAMES = 140; // run ends within the hold, so no post-hold untranslated arm is reached
const OWN_CYCLES = 120; // loc_16a3's own charge (callees excluded)
const CALLEES = [0x1708, 0x004e, 0x0038];
const EPILOGUE_STEP = 0x16ba; // the address of the collapsed epilogue m.step
const BROKEN_ADDR = 0x6905; // first persistent store on the path (sub_1708, 0x13); written once

// Identical-both-sides poke that forces board-advance / the 0x1637 table / selector
// 0. Held (dur = HOLD_DUR) so loc_16a3 dispatches every frame of the window. A fresh
// copy per machine keeps each run independent.
const FORCE_16A3_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_STATE = 3 (in-game)
  { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_SUBSTATE = 0x16 (board-advance)
  { addr: 0x6227, val: 0x02, frame: POKE_FRAME, dur: HOLD_DUR }, // BOARD = 2 -> 0x1637 table
  { addr: 0x6388, val: 0x00, frame: POKE_FRAME, dur: HOLD_DUR }, // selector 0 -> loc_16a3
];

// The engine's factory: a DK Machine on this ROM with the force poke loaded. Called
// with no argument for the baseline and with the wrapped override map for the
// optimized side; both get the SAME poke, so any state forcing is applied identically.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_16A3_POKE.map((p) => ({ ...p }));
  return m;
};

// loc_16a3's first PERSISTENT store is 0x6905 (via sub_1708). The broken twin lands
// the correct value XOR 0xFF there (guaranteed to differ). Intercepting exactly that
// one write lets every subroutine and the rest of the routine run verbatim -- the
// representative "wrong value to one of the routine's output addresses" bug the gate
// must catch.
function broken_16a3(m) {
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
    return optimized_16a3(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// A WRONG-total twin: byte-for-byte optimized_16a3 but charges 20 for the collapsed
// epilogue instead of 21 (total 119 not 120). Used to prove the collapsed total has
// teeth -- a cheaper NMI shifts where a later frame's NMI lands in diffed stack RAM.
function wrongTotal_16a3(m) {
  const realStep = m.step.bind(m);
  m.step = (addr, cyc) => realStep(addr, addr === EPILOGUE_STEP ? cyc - 1 : cyc);
  try {
    return optimized_16a3(m);
  } finally {
    m.step = realStep;
  }
}

// -- pristine-entry capture (for the isolated single-path / cycle / trace checks) --

/** Capture the machine the instant loc_16a3 is FIRST entered (frame 101). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_16a3(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_16a3 never entered within the run window");
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

/** Run `fn` on a fresh clone with the write-trace recording; return the HARDWARE
 *  writes (I/O space, addr >= 0x7800) relative to entry so they are base-independent. */
function hwTraceClone(fn) {
  const c = ENTRY.clone();
  c.mem.writeTrace = []; // clock is () => c.cycles from the constructor
  const c0 = c.cycles;
  fn(c);
  return c.mem.writeTrace
    .filter((w) => w.addr >= 0x7800)
    .map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_16a3 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_16a3]]));

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

test("EQUAL (unit): idiomatic optimized loc_16a3 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_16a3, optimized_16a3, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong path store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_16a3]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong path store is CAUGHT and names 0x6905", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_16a3, broken_16a3, { maxFrames: FRAMES });

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

// -- SINGLE PATH + CYCLE TOTAL ------------------------------------------------

test("SINGLE PATH + CYCLE TOTAL: the one straight-line path is EQUAL and preserves the total", () => {
  // loc_16a3 has no data-dependent branch: one path, exercised in isolation here.
  const a = runClone(translated_16a3);
  const b = runClone(optimized_16a3);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // Committed cycle teeth for the collapsed path: the optimized total equals the
  // oracle's exactly (both run the same three callees via m.call, so the delta pins
  // loc_16a3 proper = 120t + the callees' identical charges).
  assert.equal(b.cycles, a.cycles, `cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);

  // ...and the assertion is not vacuous: a 1-cycle error in the collapsed epilogue
  // total makes the totals disagree.
  const wrong = runClone(wrongTotal_16a3);
  assert.notEqual(wrong.cycles, a.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE: optimized total ${b.cycles}t == oracle ${a.cycles}t; wrong-total caught`);
});

test("CYCLE (unit, isolated): loc_16a3's OWN charge is 120t on both oracle and optimized", () => {
  // Stub every callee to charge nothing; the m.cycles delta is then exactly
  // loc_16a3's own contribution. The collapse redistributes the SAME 120t.
  const measure = (fn) => {
    const c = ENTRY.clone();
    for (const addr of CALLEES) c.routines.set(addr, () => {}); // no-op, charges nothing
    const before = c.cycles;
    fn(c);
    return c.cycles - before;
  };
  assert.equal(measure(translated_16a3), OWN_CYCLES, "oracle own-cycles != 120");
  assert.equal(measure(optimized_16a3), OWN_CYCLES, "optimized own-cycles != 120");
  console.log(`  CYCLE/unit: own total = ${OWN_CYCLES}t on oracle and optimized (distribution collapsed, total preserved)`);
});

test("CYCLE (whole-machine): a WRONG collapsed total (119) is CAUGHT and NOT-EQUAL", () => {
  // The collapsed 120 is load-bearing: this frame's NMI cost sets the main-loop spin
  // count (PRNG entropy) and where a LATER frame's NMI lands in diffed stack RAM.
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongTotal_16a3]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong collapsed total slipped through — the total has no teeth");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  CYCLE/whole: wrong total 119 caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

// -- WRITE-TRACE (the callee hardware-write bus cycle the RAM gate cannot see) --

test("WRITE-TRACE: the callee (0x011C) hardware writes land at the oracle's exact bus cycle", () => {
  const oracleTrace = hwTraceClone(translated_16a3);
  const optTrace = hwTraceClone(optimized_16a3);

  // sub_1708 -> call 0x011C latches the sound registers: 0x7D00-0x7D07, then 0x7D80
  // and 0x7C00 -- ten hardware writes, none from loc_16a3 itself. (The rest of the
  // routine writes only work/video RAM.)
  assert.ok(oracleTrace.length >= 1, "expected hardware writes from the sound driver (0x011C)");
  assert.deepEqual(optTrace, oracleTrace, "optimized callee hardware-write bus cycles differ from the oracle");

  // Teeth: a collapse that charges 0 before m.call(0x1708) (starting 0x1708, hence
  // 0x011C, at +0 instead of +17) shifts every hardware write earlier by 17t --
  // proving the seg-A charge placed before the call is what preserves the trace.
  const flat = hwTraceClone((m) => {
    const { regs, mem } = m;
    m.push16(0x16a6);
    m.step(0x1708, 0); // WRONG: no charge before the call, callee starts early
    m.call(0x1708);
    regs.a = mem.read8(0x6910);
    regs.sub(0x3b);
    regs.hl = 0x385c;
    m.push16(0x16b1);
    m.step(0x004e, 47 + 17); // absorb the missing 17 here so the TOTAL is still 120
    m.call(0x004e);
    regs.hl = 0x6908;
    regs.c = regs.a;
    m.push16(0x16b6);
    m.step(0x0038, 25);
    m.call(0x0038);
    regs.hl = 0x6388;
    regs.incMem8(mem, regs.hl);
    m.step(0x16ba, 21);
    m.ret(10);
  });
  assert.notDeepEqual(flat, oracleTrace, "write-trace check has no teeth");
  console.log(
    `  WRITE-TRACE: ${oracleTrace.length} callee hardware writes identical to oracle ` +
      `(0x${oracleTrace[0].addr.toString(16)}@+${oracleTrace[0].rel}t ..); flat-prologue variant caught`,
  );
});
