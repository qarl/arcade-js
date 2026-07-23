// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_3069 (the shared "advance every Nth frame"
 * rate-limiter: rst 0x18 prescale on the 0x6009 countdown, then `inc (hl)` on the
 * byte the 0x63C0 pointer targets). Reached via dispatchGameState (the NMI game-state
 * path) as BOTH idx3 and idx5 of loc_0a76's 0x0A7A rst-0x28 table, while
 * GAME_SUBSTATE(0x600A)==7 and INTRO_STEP(0x6385)==3 or ==5 -- the Kong-climb intro's
 * two paced step-advances.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_3069 reads EQUAL against its
 *      translated oracle in RAM and in the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous (it fires 64x).
 *   3. FULL BRANCH COVERAGE + CYCLE TOTAL -- loc_3069 has ONE data-dependent split
 *      (sub_0018's counter): the SKIP path (body cut short) and the EXPIRY path (`inc
 *      (hl)` runs). BOTH fire in the natural coin+start run, but each is ALSO proven in
 *      isolation with committed RAM+regs+pc teeth. The EXPIRY body is COLLAPSED (16+11
 *      -> one 27t charge), so its isolated test ALSO pins the cycle TOTAL to the oracle's
 *      and shows a 1-cycle error is caught.
 *   4. TEETH (whole + unit) -- a deliberately-wrong output store (the suppressed `inc
 *      (hl)` increment) is CAUGHT, naming the diverging address (0x6385).
 *
 * NO WRITE-TRACE TEST is needed: loc_3069's only store on the expiry path is `inc (hl)`
 * to the byte the 0x63C0 pointer targets, which is ALWAYS work RAM (0x6385 on every
 * dispatch; 0x6388 when repointed by 0x17B6) -- never a 0x7Dxx hardware latch. So the
 * routine makes no hardware write whose bus-cycle the RAM+regs gate could miss.
 *
 * WHY THIS TEST DRIVES INPUT (and uses core/equivalence.js directly, like
 * equivalence-0a8a/08f8/06fe). loc_3069 is dispatched by the same 0x0A7A intro table as
 * loc_0a8a, and that intro runs only once a credit is inserted and start pressed -- it
 * NEVER dispatches in attract (0 over 1500 attract frames). So both gates feed the
 * canonical coin+start tape (IN2 coin 0x80, then IN2 start1 0x04) via a custom
 * makeMachine factory and drive the game-agnostic CORE equivalence engine with it -- the
 * DK harness.js wrapper bakes `inputs` but not the timed `inputTape`. The core engine is
 * still the standard gate (it installs the snapshot override at CONSTRUCTION, so nothing
 * here open-codes a reach-the-routine workaround). With this tape loc_3069 first
 * dispatches at frame 409 (skip; counter 32), the step3 EXPIRY lands at frame 440 and the
 * step5 EXPIRY at frame 518; FRAMES = 560 covers both plus ~42 downstream frames so a
 * wrong cycle total surfaces (it shifts the spin count -- README §2).
 *
 * THE CYCLE FINDING this routine adds: loc_3069 is ATOMIC. It runs INSIDE the vblank NMI
 * (dispatchGameState), which does not re-enter, and its only callee sub_0018 (rst 0x18)
 * is a non-interruptible leaf -- so the NMI never lands inside it and its internal cycle
 * DISTRIBUTION is unobservable. The expiry body's two charges collapse to one 27t total;
 * the rst charge stays separate (it precedes the m.call) and the ret keeps its 10t.
 * Per-branch totals (loc_3069 proper): skip 11t, expiry 48t. The total is still
 * load-bearing (part of the NMI's cost, which sets the spin count), so it is preserved
 * exactly and whole-machine EQUAL confirms it.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3069 as translated_3069 } from "../../translated/state0.js";
import { loc_3069 as optimized_3069 } from "../loc_3069.js";
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

const TARGET = 0x3069;
const FRAMES = 560; // first dispatch f409 (skip); expiries at f440 (step3) & f518 (step5)

// 0x6009 -- SUBSTATE_TIMER, the countdown rst 0x18 (sub_0018) prescales. Poking it to 1
// forces the EXPIRY branch (dec -> 0 -> `ret z` -> the body runs).
const SUBSTATE_TIMER = 0x6009;

// loc_3069's only output store on the expiry path: `inc (hl)` targets the byte the 0x63C0
// pointer holds, which is INTRO_STEP(0x6385) on every dispatch in this run window. It sits
// in the compared work-RAM dump; the teeth suppress its increment there.
const BROKEN_ADDR = 0x6385;

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80) then
// IN2 start1 (0x04) so the ROM's own credit/start logic starts a game and the Kong-climb
// intro runs. A fresh copy per machine keeps each run's tape independent.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded. Called
// with no argument for the baseline and with the wrapped override map for the optimized
// side (the core engine wraps each override with its own invocation counter, so an EQUAL
// that never dispatched cannot pass vacuously).
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT loc_3069's own
 * `inc (hl)` store to 0x6385 SUPPRESSES the increment (writes the old value back,
 * guaranteed to differ and to stay a valid intro-step index so the run does not crash).
 * The wrapper patches write8 only for the duration of loc_3069, so it catches exactly
 * this routine's own store (sub_0018 writes 0x6009, not 0x6385).
 */
function broken_3069(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BROKEN_ADDR) {
      broke = true;
      return realWrite(addr, (value - 1) & 0xff, busOffset); // increment did NOT happen
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_3069(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the isolated per-branch / cycle checks) --

/** Capture the machine the instant loc_3069 is FIRST entered (frame 409, SKIP branch). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_3069(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_3069 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry (optionally mutated first); return {m, cycles}. */
function runClone(fn, mutate) {
  const c = ENTRY.clone();
  if (mutate) mutate(c);
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

const forceExpiry = (m) => m.mem.write8(SUBSTATE_TIMER, 1); // dec -> 0 -> body runs

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_3069 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_3069]]));

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
      `override fired ${r.invocations.get(TARGET)}x (skip + expiry both exercised)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_3069 matches translated in RAM + registers", () => {
  // coreUnitEquivalence captures the FIRST entry (frame 409, counter 32) -- the SKIP path.
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_3069, optimized_3069, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (skip entry)");
});

// -- FULL BRANCH COVERAGE + CYCLE TOTAL ---------------------------------------

test("BRANCH skip: counter still counting -- body cut short, EQUAL, HL=0x6009, no store", () => {
  // Natural entry: 0x6009 == 32, so sub_0018 returns false and loc_3069 returns TRUE.
  assert.equal(ENTRY.mem.read8(SUBSTATE_TIMER), 32, "entry should be mid-countdown (skip branch)");
  const targetBefore = ENTRY.mem.read8(BROKEN_ADDR);

  const a = runClone(translated_3069);
  const b = runClone(optimized_3069);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // Contract of the skip path: HL is sub_0018's side effect (0x6009); the body did NOT run.
  assert.equal(b.m.regs.hl, 0x6009, "skip path leaves HL = 0x6009 (sub_0018 side effect)");
  assert.equal(b.m.mem.read8(BROKEN_ADDR), targetBefore, "skip path must NOT touch the target byte");
  // Not collapsed on this path (single rst charge), so the totals simply match.
  assert.equal(b.cycles, a.cycles, `skip cycle total drifted: opt ${b.cycles} vs oracle ${a.cycles}`);
  console.log(`  BRANCH/skip: EQUAL, HL=0x6009, target 0x6385 untouched (${targetBefore}); total ${b.cycles}t == oracle`);
});

test("BRANCH expiry: counter hits 0 -- inc (hl) runs, EQUAL, and the COLLAPSED total is pinned", () => {
  const targetBefore = (() => { const c = ENTRY.clone(); forceExpiry(c); return c.mem.read8(BROKEN_ADDR); })();

  const a = runClone(translated_3069, forceExpiry);
  const b = runClone(optimized_3069, forceExpiry);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");

  // The body ran: the target byte advanced by exactly 1, identically on both sides.
  assert.equal(a.m.mem.read8(BROKEN_ADDR), (targetBefore + 1) & 0xff, "oracle should inc the target byte");
  assert.equal(b.m.mem.read8(BROKEN_ADDR), a.m.mem.read8(BROKEN_ADDR), "optimized must inc it identically");

  // Committed cycle teeth for the COLLAPSED expiry body: the optimized total equals the
  // oracle's exactly (both run sub_0018 via m.call, so the delta pins loc_3069 proper).
  assert.equal(b.cycles, a.cycles, `expiry cycle total drifted: opt ${b.cycles} vs oracle ${a.cycles}`);

  // ...and the assertion is not vacuous: a 1-cycle error in the collapsed 27t charge
  // makes the totals disagree.
  const wrong = runClone((m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x306d ? cyc - 1 : cyc);
    try { return optimized_3069(m); } finally { m.step = realStep; }
  }, forceExpiry);
  assert.notEqual(wrong.cycles, a.cycles, "collapsed-total assertion has no teeth");
  console.log(`  BRANCH/expiry: EQUAL, target 0x6385 ${targetBefore}->${a.m.mem.read8(BROKEN_ADDR)}; total ${b.cycles}t == oracle; wrong-total caught`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a suppressed inc (hl) store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_3069]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a suppressed inc (hl) store is CAUGHT and names 0x6385", () => {
  // Diff on the EXPIRY entry (the only branch that stores): oracle vs the broken twin.
  const entry = ENTRY.clone();
  forceExpiry(entry);
  const a = entry.clone();
  const b = entry.clone();
  translated_3069(a);
  broken_3069(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.ok(ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
