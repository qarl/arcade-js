// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0c91 (board-setup timing gate: a rst 0x18
 * countdown gate that runs the loc_0c92 board-setup body only when SUBSTATE_TIMER
 * (0x6009) expires, else skips the frame). Like loc_084b/loc_0a8a it is dispatched
 * from INSIDE the NMI -- it is the 0x0702 table's index-10 target, reached via
 * dispatchGameState while GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==10.
 *
 * Seven jobs:
 *
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_0c91 (optimized/
 *      loc_0c91.js) reads EQUAL against its translated oracle in RAM and in the
 *      full register file (+ pc).
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *
 *   3. TEETH (whole + unit) -- a deliberately-broken twin (the SUBSTATE_TIMER
 *      decrement lands a wrong value) must be CAUGHT: NOT-EQUAL, naming the
 *      diverging RAM address (0x6009).
 *
 *   4/5. FULL BRANCH COVERAGE -- loc_0c91 has two branches: SKIP (rst 0x18 returns
 *      false, loc_0c92 does NOT run, only 0x6009 changes) and PROCEED (rst 0x18
 *      returns true, control falls through into loc_0c92 -> board setup). Each is
 *      proven EQUAL (RAM + all registers + pc) on a SYNTHESISED entry, shown to
 *      have actually taken that branch, and its CYCLE TOTAL pinned to the oracle's.
 *
 *   6. WRITE-TRACE -- loc_0c91 makes NO hardware write of its own, but its PROCEED
 *      path flows through loc_0c92's two palette-bank latch writes (0x7D86<-0,
 *      0x7D87<-1 -- "the first write of 0x7D87=1 in the whole run"). The RAM+regs
 *      gate cannot see the emit.js --writes bus-cycle column, so this proves the
 *      rewrite leaves those downstream hardware writes at the oracle's exact bus
 *      cycle -- and that shifting the rst charge would move them (teeth).
 *
 * WHY THIS TEST DRIVES A POKE (and, like 084b, cannot use games/dkong/optimized/
 * harness.js directly). loc_0c91 NEVER dispatches from boot: measured 0 hits across
 * 400 frames of driven coin+start. So these tests force it with an IDENTICAL-BOTH-
 * SIDES poke (Karl's sanctioned "poke the board state to reach a state for
 * validation" -- applied to baseline and optimized alike, so equivalence is
 * preserved): a one-shot poke at frame 100 sets GAME_STATE=3, GAME_SUBSTATE=10
 * (select loc_0c91), and SUBSTATE_TIMER=5. Because SKIP leaves GAME_SUBSTATE at 10,
 * the gate re-dispatches every frame and 0x6009 counts 5->1: FOUR SKIP frames then
 * ONE PROCEED (which runs loc_0c92's board-1 setup and then advances the state, so
 * the gate stops firing) -- both branches exercised in a single healthy run. The
 * poke is threaded via a custom `makeMachine` factory (m.pokes) driving the game-
 * agnostic CORE engine (core/equivalence.js) -- the SAME construction-time snapshot
 * override the DK harness wrapper uses, just with a factory that can carry the poke,
 * which the wrapper's fixed (rom, assets) factory cannot. No hand-rolled snapshot
 * workaround: the reachability wiring is the engine's.
 *
 * THE CYCLE FINDING this routine adds: loc_0c91 is ATOMIC (NMI-dispatched, mask
 * held) but there is NOTHING TO COLLAPSE -- it executes exactly one instruction of
 * its own, the `rst 0x18` (11 t); all other cycles live in the callees (sub_0018 /
 * loc_0c92), reached via m.call and left per-instruction as their own oracles. So
 * the single rst charge is kept verbatim. It is still load-bearing (part of the
 * NMI's cost -> the vblank-spin/PRNG count, README §2); the per-branch cycle-total
 * assertions pin it, with a wrong-charge variant shown to be caught.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0c91 as translated_0c91 } from "../../translated/nmi.js";
import { loc_0c91 as optimized_0c91 } from "../loc_0c91.js";
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

const TARGET = 0x0c91;
const FRAMES = 130; // loc_0c91 forced to dispatch from frame 100 (4 SKIP + 1 PROCEED)
const SUBSTATE_TIMER = 0x6009; // the byte the rst 0x18 gate decrements (its one output-on-path)
const PALETTE_BANK_HI = 0x7d87; // loc_0c92's signature hardware write on the PROCEED path
const POKE_FRAME = 100;

// Identical-both-sides one-shot poke that forces GAME_STATE=3 / sub-state=10 (select
// loc_0c91) with SUBSTATE_TIMER=5. SKIP keeps GAME_SUBSTATE at 10, so the gate
// re-dispatches and 0x6009 counts 5->1: four SKIP frames then one PROCEED. Dur 1 so
// the game's own code manages the state from frame 101 on.
const FORCE_0C91_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: 1 }, // GAME_STATE = 3 (in-game -> loc_06fe dispatch)
  { addr: 0x600a, val: 0x0a, frame: POKE_FRAME, dur: 1 }, // GAME_SUBSTATE = 10 -> loc_0c91
  { addr: 0x6009, val: 0x05, frame: POKE_FRAME, dur: 1 }, // SUBSTATE_TIMER = 5 (four SKIPs then PROCEED)
];

// The engine's factory: a DK Machine on this ROM with the force-0c91 poke loaded.
// Called with no argument for the baseline and with the wrapped override map for the
// optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously). A fresh copy of
// the poke per machine keeps each run independent.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_0C91_POKE.map((p) => ({ ...p }));
  return m;
};

// loc_0c91's one output-on-path is the SUBSTATE_TIMER decrement (in sub_0018), done
// on EVERY dispatch. The broken twin lands a wrong value there. ^0xff keeps 0x6009 a
// large-but-valid countdown (no crash: the broken side just SKIPs indefinitely and
// stays healthy), yet the value differs immediately and is caught at the next frame
// sample. Intercepting exactly that one write lets sub_0018 / loc_0c92 run verbatim.
function broken_0c91(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === SUBSTATE_TIMER) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_0c91(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0c91 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0c91]]));

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
      `override fired ${r.invocations.get(TARGET)}x (4 SKIP + 1 PROCEED)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0c91 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0c91, optimized_0c91, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (first entry = SKIP)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SUBSTATE_TIMER store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0c91]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong SUBSTATE_TIMER store is CAUGHT and names 0x6009", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0c91, broken_0c91, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    SUBSTATE_TIMER,
    `expected first diff at 0x${SUBSTATE_TIMER.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (synthesised per-branch teeth, incl. cycle totals) ---

/**
 * Capture ONE real entry to loc_0c91 (via the engine's construction-time snapshot
 * override on the poke-driven host), then for each branch: clone that pristine
 * entry, set the deciding SUBSTATE_TIMER (0x6009), and diff the translated oracle
 * against the optimized rewrite on two further clones. Reusing a real captured entry
 * gives a valid stack (the rst pops/unwinds it) and realistic RAM/board state.
 */
function captureEntry() {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0c91(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(FRAMES);
  assert.ok(entry !== null, "failed to capture a loc_0c91 entry to synthesise branches from");
  return entry;
}

/**
 * Prove one branch EQUAL. Sets SUBSTATE_TIMER, runs oracle vs optimized on clones,
 * asserts RAM + every register + pc identical, asserts the CYCLE TOTAL matches the
 * oracle's, and asserts the branch actually took the expected path (so the teeth are
 * not vacuous): SKIP does not run loc_0c92 (no palette write, tiny cycle cost),
 * PROCEED runs loc_0c92 (palette write present, large cycle cost).
 */
function proveBranch(entry, name, r6009, expectProceed) {
  const seed = entry.clone();
  seed.mem.write8(SUBSTATE_TIMER, r6009);

  const a = seed.clone(); // translated oracle
  const b = seed.clone(); // optimized
  a.mem.writeTrace = [];
  b.mem.writeTrace = [];
  const a0 = a.cycles;
  const b0 = b.cycles;
  translated_0c91(a);
  optimized_0c91(b);
  const aCyc = a.cycles - a0;
  const bCyc = b.cycles - b0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, `${name}: pc must match`);

  // Committed cycle teeth: the optimized total equals the oracle's exactly on this
  // branch (both charge the single rst 11 t and the same callees via m.call).
  assert.equal(bCyc, aCyc, `${name}: cycle total drifted (oracle ${aCyc} vs optimized ${bCyc})`);

  // Non-vacuous: confirm the synthesised entry actually reached the intended branch.
  const ranBody = a.mem.writeTrace.some((w) => w.addr === PALETTE_BANK_HI);
  if (expectProceed) {
    assert.ok(ranBody, `${name}: expected PROCEED to run loc_0c92 (0x7D87 palette write)`);
    assert.ok(aCyc > 1000, `${name}: PROCEED should cost the loc_0c92 board build (got ${aCyc} t)`);
  } else {
    assert.ok(!ranBody, `${name}: expected SKIP to NOT run loc_0c92 (saw a 0x7D87 palette write)`);
    assert.ok(aCyc < 200, `${name}: SKIP should be the bare rst-gate cost (got ${aCyc} t)`);
  }
  console.log(`  BRANCH ${name}: EQUAL (RAM+regs+pc); cycles ${aCyc} t (oracle==optimized); ranBody=${ranBody}`);
}

test("BRANCH (SKIP): rst 0x18 not-expired skips loc_0c92 — EQUAL + cycle total", () => {
  const entry = captureEntry();
  // 0x6009 = 3 -> dec to 2 (non-zero): sub_0018 inc-sp's and returns false (skip).
  proveBranch(entry, "SKIP (timer survives)", 3, false);
});

test("BRANCH (PROCEED): rst 0x18 expired falls through into loc_0c92 — EQUAL + cycle total", () => {
  const entry = captureEntry();
  // 0x6009 = 1 -> dec to 0: sub_0018's `ret z` falls through into loc_0c92 (board setup).
  proveBranch(entry, "PROCEED (timer expires)", 1, true);
});

/**
 * Cycle-total teeth are non-vacuous: a wrong rst charge (10 instead of 11) makes the
 * optimized total disagree with the oracle on the SKIP branch. (This is the single
 * charge loc_0c91 owns; if it were wrong the whole-machine trace would diverge at
 * SPIN_COUNT 0x6019, but the isolated total catches it directly.)
 */
test("CYCLE TEETH: a wrong rst 0x18 charge is caught by the cycle-total compare", () => {
  const entry = captureEntry();
  const seed = entry.clone();
  seed.mem.write8(SUBSTATE_TIMER, 3); // SKIP branch

  const a = seed.clone();
  const a0 = a.cycles;
  translated_0c91(a);
  const oracleCyc = a.cycles - a0;

  const w = seed.clone();
  const w0 = w.cycles;
  const realStep = w.step.bind(w);
  w.step = (addr, cyc) => realStep(addr, addr === 0x0018 ? cyc - 1 : cyc);
  try { optimized_0c91(w); } finally { w.step = realStep; }
  const wrongCyc = w.cycles - w0;

  assert.notEqual(wrongCyc, oracleCyc, "cycle-total assertion has no teeth");
  console.log(`  CYCLE TEETH: wrong rst charge ${wrongCyc} t != oracle ${oracleCyc} t (caught)`);
});

// -- WRITE-TRACE (the downstream hardware-write bus cycle the RAM gate cannot see) --

test("WRITE-TRACE (PROCEED): loc_0c92's palette writes keep the oracle's exact bus cycle", () => {
  const entry = captureEntry();

  const traceOf = (fn) => {
    const c = entry.clone();
    c.mem.write8(SUBSTATE_TIMER, 1); // PROCEED -> loc_0c92 runs (makes the palette writes)
    c.mem.writeTrace = [];
    const c0 = c.cycles;
    fn(c);
    return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
  };

  const oracleTrace = traceOf(translated_0c91);
  const optTrace = traceOf(optimized_0c91);

  // loc_0c91 makes no hardware write of its own; on PROCEED the trace is loc_0c92's
  // two palette-bank latch writes (bank %01: LO<-0 then HI<-1).
  assert.ok(oracleTrace.length >= 1, "expected loc_0c92 palette writes on the PROCEED path");
  assert.ok(
    oracleTrace.some((w) => w.addr === PALETTE_BANK_HI && w.value === 1),
    "PROCEED trace should contain 0x7D87<-1",
  );
  assert.deepEqual(optTrace, oracleTrace, "optimized shifted a downstream hardware-write bus cycle");

  // Teeth: a rewrite that charged the rst one cycle short would shift every
  // downstream hardware write by 1 t -- the RAM gate cannot see this; the trace can.
  const shifted = (() => {
    const c = entry.clone();
    c.mem.write8(SUBSTATE_TIMER, 1);
    c.mem.writeTrace = [];
    const c0 = c.cycles;
    const realStep = c.step.bind(c);
    c.step = (addr, cyc) => realStep(addr, addr === 0x0018 ? cyc - 1 : cyc);
    try { optimized_0c91(c); } finally { c.step = realStep; }
    return c.mem.writeTrace.map((w) => ({ rel: w.cycle - c0, addr: w.addr, value: w.value }));
  })();
  assert.notDeepEqual(shifted, oracleTrace, "write-trace check has no teeth");
  console.log(
    `  WRITE-TRACE: ${oracleTrace.length} palette write(s) at oracle bus cycles; ` +
      "wrong-rst-charge shift caught",
  );
});
