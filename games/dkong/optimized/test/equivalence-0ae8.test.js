// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0ae8 (INTRO_STEP 2 of the opening Kong-climb
 * cutscene: tick the climb forward each NMI, and when the climb position 0x690B
 * drops below 0x5D arm the next phase and advance INTRO_STEP 2 -> 3). Reached via
 * dispatchGameState (the NMI game-state path) as entry 2 of loc_0a76's 0x0A7A
 * rst-0x28 table, while GAME_STATE(0x6005)==3, GAME_SUBSTATE(0x600A)==7 and
 * INTRO_STEP(0x6385)==2.
 *
 * Jobs (as for the sibling cutscene arms loc_0a8a / loc_0a76):
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_0ae8 reads EQUAL against
 *      its translated oracle in RAM and in the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous (248x here).
 *   3. FULL BRANCH COVERAGE -- loc_0ae8 has TWO independent data-dependent branches:
 *        (a) call z,0x304a  -- taken iff (0x62AF & 0x0F)==0 after sub_306f bumps it;
 *        (b) ret nc         -- taken (exit A, stay in step 2) iff 0x690B >= 0x5D,
 *                              else falls through (exit B: arm timer + advance step).
 *      The driven run exercises call-taken 15x / skipped 233x and ret-taken 247x /
 *      not-taken 1x, but the FOURTH combination (call-taken AND exit-B in one frame)
 *      never occurs naturally. All four arms are SYNTHESISED here -- stub both callees
 *      IDENTICALLY on the two clones and poke the deciding bytes -- and proven EQUAL
 *      (RAM+regs+pc). Because each arm is COLLAPSED, its own-cycle TOTAL is also pinned
 *      to the oracle's (stubs charge 0, so the measured delta is loc_0ae8 proper:
 *      78 / 85 / 139 / 146 t), and a wrong collapsed total is shown to be caught.
 *   4. TEETH (whole + unit) -- a deliberately-wrong output store is CAUGHT, naming
 *      the diverging address (0x6009, SUBSTATE_TIMER). loc_0ae8's OWN stores happen
 *      only on the exit-B "top reached" path (which fires once, the last dispatch),
 *      so the unit teeth SYNTHESISE an exit-B entry -- the natural unit first-entry
 *      is exit A, which writes nothing of loc_0ae8's own.
 *
 * WHY THIS TEST DRIVES INPUT (and uses core/equivalence.js directly, like
 * equivalence-0a8a / 0a76). The Kong-climb intro only runs once a credit is inserted
 * and a start button pressed -- loc_0ae8 NEVER dispatches in attract. So both gates
 * feed the canonical coin+start tape (IN2 coin 0x80, then IN2 start1 0x04) via a
 * custom makeMachine factory and drive the game-agnostic CORE equivalence engine
 * with it -- the DK harness.js wrapper bakes `inputs` but not the timed `inputTape`.
 * The core engine is still the standard gate (it installs the snapshot override at
 * CONSTRUCTION, so nothing here open-codes a reach-the-routine workaround). With this
 * tape loc_0ae8 dispatches 248x, over frames covering nmi 157..404; FRAMES = 420
 * covers the whole run including the single exit-B frame (408) plus downstream.
 *
 * THE CYCLE FINDING this routine adds: loc_0ae8 is ATOMIC and COLLAPSED per branch.
 * It runs INSIDE the vblank NMI (dispatchGameState), which does not re-enter, and its
 * callees (sub_306f, sub_304a and everything THEY call) are short cutscene/utility
 * routines -- never the interruptible gameplay loop -- so no frame boundary lands
 * inside it. Its internal cycle distribution is therefore free, and each straight-
 * line run collapses into the m.step preceding the next control transfer (so the
 * cumulative cycle at every callee entry AND each exit stays byte-identical to the
 * oracle). The TOTAL is still load-bearing (README §2): as part of the NMI cost it
 * sets the main-loop spin count (PRNG entropy) and fixes where a later frame's NMI
 * lands in diffed stack RAM. loc_0ae8 makes NO hardware writes of its own (work RAM
 * only: 0x6009 / 0x63C0), so there is no write-bus-cycle trace to preserve.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ae8 as translated_0ae8 } from "../../translated/state0.js";
import { loc_0ae8 as optimized_0ae8 } from "../loc_0ae8.js";
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

const TARGET = 0x0ae8;
const FRAMES = 420; // loc_0ae8 dispatches 248x over nmi 157..404; exit-B frame is 408

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80)
// then IN2 start1 (0x04) so the ROM's own credit/start logic starts a game and the
// Kong-climb intro runs. A fresh copy per machine keeps each run's tape independent.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded.
// Called with no argument for the baseline and with the wrapped override map for the
// optimized side (the core engine wraps each override with its own invocation counter,
// so an EQUAL that never dispatched cannot pass vacuously). The tape is applied
// IDENTICALLY to both sides (the factory is shared).
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// loc_0ae8's own output store the teeth corrupt: 0x6009 (SUBSTATE_TIMER), written
// 0x20 on the exit-B "top reached" path. It is written by loc_0ae8 alone (neither
// callee touches it), sits in the compared work-RAM dump, and drives the next phase's
// countdown, so a wrong value there diverges downstream -- the representative "wrong
// value to one of the routine's own output addresses" bug the gate must catch.
const BROKEN_ADDR = 0x6009;

/** Wrap `fn` so the first write to BROKEN_ADDR lands a guaranteed-wrong value. */
function breakStore(fn) {
  return (m) => {
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
      return fn(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}
const broken_0ae8 = breakStore(optimized_0ae8);

// -- pristine-entry capture (for the isolated branch / cycle checks) --------------

/** Capture the machine the instant loc_0ae8 is FIRST entered (natural: an exit-A
 *  frame -- the climb has not topped out yet). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0ae8(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("loc_0ae8 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/**
 * Synthesise one branch arm on a fresh clone of the captured entry and run `fn`.
 * Both callees are stubbed IDENTICALLY: sub_306f writes `after62af` to 0x62AF (so
 * (0x62AF & 0x0F) decides the `call z,0x304a` branch) and returns; sub_304a just
 * returns. Both charge 0 cycles, so the measured delta is loc_0ae8 proper. 0x690B is
 * poked to decide the `ret nc` branch. The stubs pop the return address loc_0ae8
 * pushed (m.ret) so SP stays balanced. Returns { m, cycles }.
 */
function runArm(fn, after62af, v690b) {
  const c = ENTRY.clone();
  c.routines.set(0x306f, (mm) => { mm.mem.write8(0x62af, after62af); mm.ret(0); });
  c.routines.set(0x304a, (mm) => { mm.ret(0); });
  c.mem.write8(0x690b, v690b);
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

// The four branch arms: [name, after-sub_306f 0x62AF, 0x690B, own-cycle total].
// z = call z,0x304a taken (0x62AF&0x0F==0); nc = ret nc taken (0x690B>=0x5D, exit A).
const ARMS = [
  { name: "call-skipped / exit-A (ret nc taken)", a62: 0x01, v69: 0x80, total: 78, exitB: false },
  { name: "call-taken   / exit-A (ret nc taken)", a62: 0x00, v69: 0x80, total: 85, exitB: false },
  { name: "call-skipped / exit-B (ret nc not taken)", a62: 0x01, v69: 0x00, total: 139, exitB: true },
  { name: "call-taken   / exit-B (ret nc not taken)", a62: 0x00, v69: 0x00, total: 146, exitB: true },
];

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0ae8 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0ae8]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0ae8 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0ae8, optimized_0ae8, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (natural first entry = exit A)");
});

// -- FULL BRANCH COVERAGE + CYCLE TOTALS --------------------------------------

test("BRANCH COVERAGE: all four call-z x ret-nc arms are EQUAL and preserve the collapsed total", () => {
  for (const arm of ARMS) {
    const a = runArm(translated_0ae8, arm.a62, arm.v69); // oracle
    const b = runArm(optimized_0ae8, arm.a62, arm.v69);  // optimized

    const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.m.regs, b.m.regs);
    assert.equal(ram, null, ram ? `[${arm.name}] RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
    assert.equal(regs, null, regs ? `[${arm.name}] reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
    assert.equal(a.m.pc, b.m.pc, `[${arm.name}] pc must match`);

    // Collapsed cycle teeth: optimized total == oracle total == the pinned constant.
    // (Stubs charge 0, so the delta is loc_0ae8 proper.) A wrong collapse constant in
    // the source would make optimized disagree with the per-instruction oracle here.
    assert.equal(b.cycles, a.cycles, `[${arm.name}] cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);
    assert.equal(a.cycles, arm.total, `[${arm.name}] oracle own-cycle total ${a.cycles} != expected ${arm.total}`);

    console.log(`  BRANCH ${arm.name}: EQUAL, own-cycle total ${b.cycles}t == oracle ${a.cycles}t`);
  }
});

test("CYCLE TEETH: a wrong collapsed total on the never-naturally-reached arm is caught", () => {
  // The fourth combination (call-taken AND exit-B) never occurs in the driven run, so
  // its collapsed total (146t) has no whole-machine teeth -- pin it explicitly. A
  // 1-cycle error in the exit-B lump (m.step 0x0b05) makes the totals disagree.
  const arm = ARMS[3];
  const good = runArm(optimized_0ae8, arm.a62, arm.v69);
  const oracle = runArm(translated_0ae8, arm.a62, arm.v69);
  assert.equal(good.cycles, oracle.cycles, "sanity: collapsed arm matches oracle");
  assert.equal(good.cycles, 146, "sanity: collapsed arm total is 146t");

  const wrong = runArm((m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x0b05 ? cyc - 1 : cyc);
    try { return optimized_0ae8(m); } finally { m.step = realStep; }
  }, arm.a62, arm.v69);
  assert.notEqual(wrong.cycles, oracle.cycles, "cycle-total assertion has no teeth");
  console.log(`  CYCLE TEETH: exit-B collapsed total 146t pinned; a 1-cycle error (${wrong.cycles}t) is caught`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong exit-B output store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0ae8]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong exit-B store is CAUGHT and names 0x6009 (synthesised exit-B entry)", () => {
  // The natural unit first-entry is an exit-A frame, which writes NONE of loc_0ae8's
  // own outputs -- so the store to break only exists on a synthesised exit-B entry.
  const arm = ARMS[2]; // call-skipped / exit-B
  const a = runArm(translated_0ae8, arm.a62, arm.v69);          // oracle
  const b = runArm(breakStore(optimized_0ae8), arm.a62, arm.v69); // broken twin

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  assert.ok(ram != null, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
