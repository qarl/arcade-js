// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0852 (CLEAR SCREEN: blank the tilemap VRAM
 * 0x7400-0x77FF to tile 0x10, then zero the sprite buffer 0x6900-0x6A7F). It is a
 * LEAF called by the two board-setup phase handlers loc_0986 (0x0702 arm 0) and
 * loc_196b (0x0702 arm 0x17), both reached via dispatchGameState in the NMI, so it
 * runs under the cleared NMI mask on every call path.
 *
 * Five jobs:
 *
 *   1. EQUAL -- the idiomatic optimized sub_0852 (optimized/sub_0852.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit. It is a leaf
 *      reached only through `m.call`; the harness installs the override at
 *      CONSTRUCTION, so it fires through loc_0986's m.call(0x0852).
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. With the
 *      coin+start tape sub_0852 dispatches EXACTLY ONCE, at frame 152 (loc_0986's
 *      1-player board-setup, the first in-game NMI after loc_08f8 starts a game).
 *      FRAMES = 160 covers it. It does NOT fire in attract (its only callers are
 *      in-game GAME_STATE 3 phase arms).
 *
 *   3. PATH + CYCLE TOTAL -- sub_0852 has a SINGLE fixed execution path (every loop
 *      bound is an immediate constant; no data-dependent branch), so "full branch
 *      coverage" is that one path. Because the routine is COLLAPSED, the path test
 *      also asserts its exact CYCLE TOTAL equals the oracle's (36784t) -- committed
 *      teeth for the collapse -- and shows a deliberately-wrong total is CAUGHT.
 *
 *   4. TEETH (whole) -- a wrong store to 0x7400 (the first tilemap cell it clears,
 *      a benign display byte that does not drive dispatch) is CAUGHT: NOT-EQUAL,
 *      naming the diverging VRAM address (same target loc_0986's own whole-teeth use).
 *
 *   5. TEETH (unit) -- a wrong store to the sprite buffer 0x6900 (a named output of
 *      this routine) is CAUGHT and named by the unit gate.
 *
 * THE CYCLE FINDING this routine adds: sub_0852 is ATOMIC and FULLY COLLAPSED. It
 * runs inside the vblank NMI (mask cleared), which does not re-enter, so no NMI
 * ever lands inside its ~37k-cycle fill -- both callers measured nmiInside == 0
 * (loc_0986.js: own cost 37339t, almost all of it THIS clear). And it writes NO
 * hardware latch (only tilemap VRAM + the sprite buffer, both plain memory), so
 * -- unlike loc_0986/loc_0a8a, which keep partial granularity around a 0x7D82
 * write -- the collapse is TOTAL: the whole body sum (36774t) charged in one
 * m.step, plus the ret's 10t. The TOTAL is still load-bearing (part of the NMI's
 * total, it sets the main-loop spin count -> the PRNG at 0x6019, README §2), so it
 * is preserved exactly and pinned by the cycle assertion below.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0852 as translated_0852 } from "../../translated/state0.js";
import { sub_0852 as optimized_0852 } from "../sub_0852.js";
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

const TARGET = 0x0852;
const FRAMES = 160; // sub_0852 dispatches once, at frame 152 (loc_0986 board-setup)
const CYCLE_TOTAL = 36784; // oracle's exact per-instruction sum (measured), incl. the ret

// Canonical coin+start tape (as in equivalence-0986): pulse IN2 coin (0x80) then
// IN2 start1 (0x04), so the ROM's own credit/start logic starts a game and the
// state-3 dispatcher reaches loc_0986, which calls sub_0852. A fresh copy per
// machine keeps the baseline and optimized runs independent.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded.
// Called with no argument for the baseline and with the wrapped override map for
// the optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously). The tape is
// baked here (as in equivalence-0986) since harness.js's wrapper does not carry it.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// Whole-machine teeth target: 0x7400, the first cell of sub_0852's tilemap clear.
// A display byte -- it does not drive dispatch, so a broken run finishes and the
// diff surfaces at the frame it fires (the same target loc_0986's whole-teeth use).
const WHOLE_BROKEN_ADDR = 0x7400;
// Unit teeth target: sub_0852's OWN output store, the sprite buffer base 0x6900.
const UNIT_BROKEN_ADDR = 0x6900;

/**
 * Deliberately-broken twin: behaviourally the optimized routine EXCEPT the first
 * store to `brokenAddr` lands a wrong value (correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine run
 * verbatim -- the representative "wrong value to one of the routine's own output
 * addresses" bug the gate must catch.
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
      return optimized_0852(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}

/**
 * A wrong-CYCLE-TOTAL counterfactual: behaviourally identical to the optimized
 * routine but charges 100t too many. The path test's cycle assertion must CATCH
 * it, proving the collapsed-total teeth are real (a wrong sum would otherwise be
 * invisible to the RAM+regs gate, which does not compare cycles).
 */
function wrongCycles_0852(m) {
  const { regs, mem } = m;
  for (let a = 0x7400; a < 0x7800; a++) mem.write8(a, 0x10);
  for (let a = 0x6900; a < 0x6a80; a++) mem.write8(a, 0x00);
  regs.hl = 0x6a80; regs.b = 0x00; regs.xor(regs.a);
  regs.c = 0x02; regs.c = regs.dec8(regs.c); regs.c = regs.dec8(regs.c);
  m.step(0x0873, 36774 + 100); // WRONG: 100t too many
  m.ret(10);
}

// -- pristine-entry capture (for the single-path + cycle assertion) ---------------

/**
 * Capture the machine at the instant sub_0852 is FIRST entered (frame 152) and
 * return that pristine clone, so the one path can be re-driven under the oracle and
 * the optimized routine from identical state and their RAM/regs/pc/cycles compared.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0852(mm);
  }]]);
  makeMachine(snap).runFrames(FRAMES);
  if (entry === null) throw new Error("sub_0852 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run oracle vs `runOptimized` from the captured entry; diff RAM+regs+pc + cycles. */
function pathDiff(runOptimized) {
  const a = ENTRY.clone();
  const b = ENTRY.clone();
  const ca0 = a.cycles, cb0 = b.cycles;
  translated_0852(a);
  runOptimized(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
    cyclesT: a.cycles - ca0,
    cyclesO: b.cycles - cb0,
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0852 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0852]]));

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

test("EQUAL (unit): idiomatic optimized sub_0852 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0852, optimized_0852, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- SINGLE PATH + COLLAPSED CYCLE TOTAL --------------------------------------

test("PATH + CYCLE: the single fixed path is EQUAL and its collapsed total is exact", () => {
  const d = pathDiff(optimized_0852);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)} (t ${d.ram.a} vs o ${d.ram.b})` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg} (t ${d.regs.a} vs o ${d.regs.b})` : "");
  assert.equal(d.pc, null, "pc must match");

  // Committed cycle teeth: the collapsed optimized total must equal the oracle's
  // exact per-instruction sum, and that sum is the measured 36784t.
  assert.equal(d.cyclesT, CYCLE_TOTAL, `oracle total ${d.cyclesT} != expected ${CYCLE_TOTAL}`);
  assert.equal(d.cyclesO, d.cyclesT, `optimized total ${d.cyclesO} != oracle ${d.cyclesT}`);

  // ...and those teeth bite: a twin charging 100t too many is CAUGHT here.
  const w = pathDiff(wrongCycles_0852);
  assert.equal(w.ram, null, "wrong-cycle twin must still match RAM (only the total is wrong)");
  assert.notEqual(w.cyclesO, w.cyclesT, "cycle-total check has no teeth");

  console.log(
    `  PATH+CYCLE: single path EQUAL in RAM + registers + pc; collapsed total ${d.cyclesO}t ` +
      `== oracle (${CYCLE_TOTAL}t); wrong-total twin caught (${w.cyclesO} vs ${w.cyclesT})`,
  );
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong tilemap store is CAUGHT and NOT-EQUAL", () => {
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

test("TEETH (unit): a wrong sprite-buffer store is CAUGHT and names 0x6900", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0852, makeBroken(UNIT_BROKEN_ADDR), { maxFrames: FRAMES });

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
