// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_1839 (0x1644 idx 2: the rate-limited board-
 * advance animation stepper). It sits several m.call levels below the NMI: while
 * a credited game is in its board-advance sub-state (GAME_SUBSTATE 0x600A == 0x16),
 * dispatchGameState vectors to loc_1615, which routes on BOARD (0x6227) to
 * sub_1641, whose rst-0x28 dispatch on the 0x6388 sequence selector (table 0x1648)
 * lands on loc_1839 at index 2.
 *
 * Seven jobs (the standard four, plus branch coverage and cycle-collapse teeth):
 *
 *   1. EQUAL -- the idiomatic optimized loc_1839 (optimized/loc_1839.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. The override
 *      routes through dispatchGameState's override consult (nmi.js), inert when the
 *      map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. loc_1839
 *      does NOT run in attract OR in the opening cutscene: it needs the in-game
 *      board-advance sub-state on a BOARD whose low two bits are clear (100m), a
 *      state a plain boot never reaches in a bounded run. It is driven here with a
 *      coin+start inputTape (credits + starts a game) PLUS an identical-both-sides
 *      poke that forces the board-advance dispatch (GAME_SUBSTATE=0x16, BOARD=4,
 *      0x6388 sequence idx=2) from frame 60. It then dispatches once per frame:
 *      first at ~frame 60, 341 times over the 400-frame window, walking the counter
 *      through ALL FOUR branches (ret-nz, both 8th-tick table arms, and one wrap).
 *
 *   3. TEETH -- a deliberately-broken twin (the routine's own first store, the
 *      inc of the animation counter at 0x6390) lands the wrong value; it must be
 *      CAUGHT: NOT-EQUAL, naming 0x6390, whole-machine and unit.
 *
 *   4. BRANCH COVERAGE -- loc_1839 has four data-dependent outcomes, decided by the
 *      counter value AFTER the inc: WRAP (0x00), NON-8th-tick ret-nz (low 3 bits
 *      set), and 8th-tick with counter bit 3 set (source table 0x39CF) or clear
 *      (0x39F7). Each is synthesised (clone the captured entry, poke 0x6390) and
 *      proven EQUAL (RAM + registers + pc). The driven EQUAL/whole run reaches all
 *      four with the REAL callees; this localises each and reaches WRAP reliably.
 *
 *   5. CYCLE-COLLAPSE TEETH (unit) -- loc_1839 is ATOMIC in the sense that matters:
 *      it runs entirely inside the vblank NMI (entered mask-cleared, not re-entrant)
 *      and no frame boundary lands inside a single NMI, so nothing samples its
 *      cycles mid-flight -- only the NMI's TOTAL is observable (spin count / PRNG,
 *      README §2). Its per-instruction m.step charges are therefore collapsed per
 *      straight-line SEGMENT (each run between call boundaries -> one m.step), which
 *      also keeps the cumulative clock byte-identical AT every m.call. This test
 *      isolates each branch's OWN cycle total (callees stubbed to a zero-cost ret)
 *      and asserts oracle == optimized == the exact per-branch sum (wrap 137,
 *      ret-nz 56, 8th-tick/0x39F7 148, 8th-tick/0x39CF 143) -- the collapse is a
 *      redistribution of the SAME total, not a cheaper one.
 *
 *   6. CYCLE-COLLAPSE TEETH (whole-machine) -- the collapsed total is load-bearing:
 *      a WRONG total (charging the ret-nz branch 44 t instead of 45) is CAUGHT and
 *      NOT-EQUAL. It diverges in the diffed STACK RAM (0x6BF6), a later frame's
 *      NMI-pushed PC landing at a different byte because this NMI cost one cycle
 *      less -- the same downstream-landing mechanism as entry_0611 / loc_0a76.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). The engine
 * that proves equivalence lives in core/equivalence.js; games/dkong/optimized/
 * harness.js is a thin wrapper that bakes in a `makeMachine` factory built on `{}`
 * assets -- which drives NO input and applies NO poke, so it can never reach a
 * credited game's board-advance state and never dispatches loc_1839. This test
 * therefore calls the SAME core unitEquivalence / wholeMachineEquivalence directly
 * (they ARE the standard engine harness.js wraps), passing a makeMachine factory
 * that adds an identical coin+start inputTape AND an identical board-advance poke to
 * BOTH the baseline and optimized machines (the factory is the wrapper's only job).
 * Nothing about the capture / clone / diff / invocation-counter logic is re-
 * implemented, and the snapshot override is still installed at CONSTRUCTION (the
 * factory passes it into `new Machine`), which is what reaches loc_1839 however it
 * is entered. Any poke/tape is applied identically to both sides (the factory is
 * shared). Same pattern as equivalence-0a76.test.js / equivalence-06fe.test.js.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1839 as translated_1839 } from "../../translated/state0.js";
import { loc_1839 as optimized_1839 } from "../loc_1839.js";
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

const TARGET = 0x1839;
const FRAMES = 400; // dispatches once/frame from ~60; 341 hits across all 4 branches
const TEETH_FRAMES = 120; // a wrong store is caught by the first dispatch (~frame 61)
const MAX_FRAMES = 90; // loc_1839 first dispatches at ~frame 60

// Credit + start a game (identical to loc_0a76's tape).
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// Force the board-advance dispatch that reaches loc_1839: hold GAME_SUBSTATE at
// 0x16 (loc_1615), BOARD at 4 (100m -> the sub_1641 arm, low two bits clear), and
// the 0x6388 sequence selector at 2 (table 0x1648 idx 2 = loc_1839), from frame 60.
// Applied by the SHARED factory, so baseline and optimized see the identical poke.
const BOARD_ADVANCE_POKE = [
  { addr: 0x600a, val: 0x16, frame: 60, dur: null },
  { addr: 0x6227, val: 0x04, frame: 60, dur: null },
  { addr: 0x6388, val: 0x02, frame: 60, dur: null },
];

// The makeMachine factory the core engine drives, extended to attach the coin+
// start inputTape and the board-advance poke. Called with no argument for the
// baseline and with the wrapped override map for the optimized side -- both get
// the SAME tape + poke, so all input/state forcing is applied identically.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = BOARD_ADVANCE_POKE.map((p) => ({ ...p }));
  return m;
}

// loc_1839's own first store, on EVERY path: `inc (hl)` at the animation counter
// 0x6390 (work RAM, inside the compared dump). Corrupting it is the representative
// "wrong value to one of the routine's own output addresses" bug the gate must catch.
const BROKEN_ADDR = 0x6390;

/**
 * Deliberately-broken twin: behaviourally optimized_1839 EXCEPT the first store to
 * 0x6390 lands a wrong value (the correct byte XOR 0xFF, guaranteed to differ).
 * Intercepting exactly that one write lets the rest of the routine and every
 * subroutine it calls run verbatim.
 */
function broken_1839(m) {
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
    return optimized_1839(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/**
 * A WRONG-total twin: identical to optimized_1839 but charges the ret-nz branch
 * 44 t instead of 45. Used to prove the collapsed total has teeth -- a cheaper NMI
 * shifts where a LATER frame's NMI lands in the diffed stack RAM. (The wrap and
 * 8th-tick arms are replicated correctly so ONLY the ret-nz total is wrong.)
 */
function wrongTotal_1839(m) {
  const { regs, mem } = m;
  regs.hl = 0x6390;
  regs.incMem8(mem, regs.hl);
  if (regs.fZ) {
    regs.hl = 0x385c;
    m.push16(0x185f); m.step(0x004e, 58); m.call(0x004e);
    regs.hl = 0x6908; regs.c = 0x44;
    m.push16(0x1865); m.step(0x0038, 28); m.call(0x0038);
    regs.a = 0x20; mem.write8(0x6009, regs.a);
    regs.hl = 0x6388; regs.incMem8(mem, regs.hl);
    m.step(0x186e, 41); m.ret();
    return;
  }
  regs.a = mem.read8(0x6390);
  regs.and(0x07);
  if (regs.fNZ) {
    m.step(0x1843, 44); // WRONG: should be 45
    m.ret(11);
    return;
  }
  regs.de = 0x39cf;
  regs.bit(3, mem.read8(0x6390));
  let ownToCall;
  if (regs.fZ) { regs.de = 0x39f7; ownToCall = 110; } else { ownToCall = 105; }
  regs.exDeHl();
  m.push16(0x1852); m.step(0x004e, ownToCall); m.call(0x004e);
  regs.hl = 0x6908; regs.c = 0x44;
  m.push16(0x1858); m.step(0x0038, 28); m.call(0x0038);
  m.ret();
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_1839 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_1839]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (board-advance, all four branches)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_1839 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_1839, optimized_1839, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first entry ~frame 60)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong counter store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, TEETH_FRAMES, new Map([[TARGET, broken_1839]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong counter store is CAUGHT and names 0x6390", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_1839, broken_1839, { maxFrames: MAX_FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- BRANCH COVERAGE ----------------------------------------------------------

// Capture the pristine machine state at loc_1839's FIRST dispatch, via the same
// construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_1839(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_1839 never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

// The four outcomes, keyed by the value POKED into 0x6390 (the routine inc's it
// first, so the deciding value is poke+1): 0xFF->0x00 wrap; 0x00->0x01 ret-nz;
// 0x0F->0x10 8th tick bit3 clear (0x39F7); 0x07->0x08 8th tick bit3 set (0x39CF).
const BRANCHES = [
  { name: "wrap",         poke: 0xff, ownTotal: 137 },
  { name: "ret-nz",       poke: 0x00, ownTotal: 56 },
  { name: "8th/0x39F7",   poke: 0x0f, ownTotal: 148 },
  { name: "8th/0x39CF",   poke: 0x07, ownTotal: 143 },
];

test("BRANCH COVERAGE: all four counter outcomes dispatch EQUAL (RAM + regs + pc)", () => {
  const entry = captureEntry();

  for (const { name, poke } of BRANCHES) {
    const a = entry.clone();
    const b = entry.clone();
    a.mem.write8(0x6390, poke);
    b.mem.write8(0x6390, poke);

    translated_1839(a);
    optimized_1839(b);

    const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.regs, b.regs);
    assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
    assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
    assert.equal(a.pc, b.pc, `${name}: pc mismatch`);
  }
  console.log("  BRANCH COVERAGE: wrap / ret-nz / 8th-tick(0x39F7) / 8th-tick(0x39CF) all EQUAL");
});

// -- CYCLE-COLLAPSE TEETH -----------------------------------------------------

test("CYCLE (unit): each branch's collapsed OWN total equals the oracle's exact sum", () => {
  const entry = captureEntry();

  // Isolate loc_1839's own cycle contribution by stubbing its callees to a
  // zero-cost ret (pops the pushed return so SP stays balanced, charges nothing);
  // the delta in m.cycles is then exactly the routine's own per-branch total.
  const zeroCostRet = (mm) => mm.ret(0);
  const measure = (fn, poke) => {
    const c = entry.clone();
    c.mem.write8(0x6390, poke);
    c.routines.set(0x004e, zeroCostRet);
    c.routines.set(0x0038, zeroCostRet);
    const before = c.cycles;
    fn(c);
    return c.cycles - before;
  };

  for (const { name, poke, ownTotal } of BRANCHES) {
    const oracle = measure(translated_1839, poke);
    const opt = measure(optimized_1839, poke);
    assert.equal(oracle, ownTotal, `${name}: oracle own-cycles ${oracle} != ${ownTotal}`);
    assert.equal(opt, ownTotal, `${name}: optimized own-cycles ${opt} != ${ownTotal}`);
  }
  console.log("  CYCLE/unit: own totals wrap=137 ret-nz=56 8th/0x39F7=148 8th/0x39CF=143 on oracle AND optimized");
});

test("CYCLE (whole-machine): a WRONG collapsed total (ret-nz 44) is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, TEETH_FRAMES, new Map([[TARGET, wrongTotal_1839]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong collapsed total slipped through — the total has no teeth");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  CYCLE/whole: wrong ret-nz total 44 caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});
