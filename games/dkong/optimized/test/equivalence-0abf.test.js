// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0abf (INTRO_STEP 1: the timer-gated second
 * phase of the opening Kong-climb cutscene -- copy the 0x28-byte record block ROM
 * 0x388C -> 0x6908, two `rst 0x38` add-passes over it, seed 0x638E/0x690C, queue
 * the intro tune, advance INTRO_STEP). Reached via dispatchGameState (the NMI
 * game-state path) as entry 1 of loc_0a76's 0x0A7A rst-0x28 table, while
 * GAME_SUBSTATE(0x600A)==7 and INTRO_STEP(0x6385)==1.
 *
 * loc_0abf has TWO data-dependent branches, gated on its opening `rst 0x18`
 * (sub_0018), which decrements SUBSTATE_TIMER (0x6009 = 0x40, armed by loc_0a8a):
 *   - ABORT branch (~63 frames): timer not yet 0, sub_0018 discards the remainder
 *     and returns to loc_0a76's caller -- loc_0abf does nothing observable itself.
 *   - WORK branch (exactly 1 frame): timer reaches 0, the whole body runs and
 *     `inc (INTRO_STEP)` advances the cutscene so this routine stops dispatching.
 * With the canonical coin+start tape the routine dispatches on EVERY frame 97..160:
 * frames 97..159 take the ABORT branch, frame 160 the WORK branch (measured). So a
 * 165-frame whole-machine run exercises BOTH branches naturally, plus ~5 downstream
 * frames so a wrong WORK-branch cycle total surfaces via the spin count.
 *
 * Jobs:
 *   1. EQUAL (whole) -- optimized loc_0abf reads EQUAL against the oracle every
 *      frame across BOTH branches; the override must fire (else EQUAL is vacuous).
 *   2. EQUAL (unit) -- the standard unit gate captures the FIRST entry (frame 97 =
 *      ABORT branch) and diffs RAM + the full register file (+ pc).
 *   3. BRANCH COVERAGE -- both branches proven EQUAL on captured pristine entries
 *      (ABORT @97, WORK @160), each with a committed CYCLE-TOTAL assertion (loc_0abf
 *      is atomic + collapsed, so a wrong lump total must be caught) -- and it is.
 *   4. TEETH (whole + unit) -- a deliberately-wrong WORK-branch output store (to
 *      0x638E) is CAUGHT, naming the diverging address.
 *
 * NO WRITE-TRACE TEST: loc_0abf makes ZERO hardware (0x7Dxx) writes -- every store
 * is work RAM -- so unlike loc_0a8a there is no write-bus-cycle column for the
 * collapse to shift, and nothing for a --writes trace to police.
 *
 * WHY THIS TEST DRIVES INPUT (like equivalence-0a8a). The Kong-climb intro only
 * runs once a credit is inserted and start pressed -- loc_0abf NEVER dispatches in
 * attract. So both gates feed the canonical coin+start tape via a custom makeMachine
 * factory and drive the game-agnostic CORE equivalence engine with it (the DK
 * harness.js wrapper bakes `inputs` but not the timed `inputTape`). The core engine
 * is still the standard gate -- it installs the snapshot override at CONSTRUCTION,
 * so nothing here open-codes a reach-the-routine workaround.
 *
 * THE CYCLE FINDING this routine adds: loc_0abf is ATOMIC and FULLY collapsed (no
 * hardware writes to keep granularity for). It runs INSIDE the vblank NMI, which
 * does not re-enter, and every callee (sub_0018/sub_004e/loc_0038) is a leaf helper
 * that completes within the same NMI, so the NMI never lands inside it and its
 * internal cycle DISTRIBUTION is unobservable -- the per-instruction charges collapse
 * to one total per executed segment (a segment breaks at each m.call, whose m.step
 * also positions PC at the callee). The TOTAL stays load-bearing (NMI cost -> spin
 * count, README §2), so each branch's sum is preserved: ABORT 11t of loc_0abf proper,
 * WORK 188t + ret 10t = 198t. Whole-machine EQUAL (which reaches the WORK branch at
 * frame 160) confirms the collapse does not drift the spin count; the per-branch
 * cycle-total assertions give it committed teeth.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0abf as translated_0abf } from "../../translated/state0.js";
import { loc_0abf as optimized_0abf } from "../loc_0abf.js";
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

const TARGET = 0x0abf;
const FRAMES = 165; // dispatches every frame 97..160: ABORT 97..159, WORK 160

// Canonical coin+start tape: pulse IN2 coin (0x80) then IN2 start1 (0x04) so the
// ROM's own credit/start logic starts a game and the Kong-climb intro runs.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// loc_0abf's own WORK-branch output store the teeth corrupt: 0x638E (seeded 0x1F).
// It is written ONLY by loc_0abf's work branch, sits in the compared work-RAM dump,
// and holds a stable 0x1F from frame 160 through the run window (measured), so a
// wrong value there persists -- the representative "wrong value to one of the
// routine's own output addresses" bug the gate must catch.
const BROKEN_ADDR = 0x638e;

/**
 * Deliberately-broken twin: behaviourally optimized loc_0abf EXCEPT the first store
 * to 0x638E lands the wrong value (correct XOR 0xFF, guaranteed to differ).
 */
function broken_0abf(m) {
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
    return optimized_0abf(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine-entry capture (for the per-branch isolated checks) ----------------

/**
 * Capture the machine the instant loc_0abf is entered on EACH branch: the first
 * ABORT entry (frame 97, timer > 1) and the WORK entry (frame 160, timer == 1).
 * mm.clone() snapshots the pristine entry BEFORE the oracle runs.
 */
function captureEntries() {
  let abort = null;
  let work = null;
  const snap = new Map([[TARGET, (mm) => {
    const timer = mm.mem.read8(0x6009); // SUBSTATE_TIMER before sub_0018 decrements it
    if (timer === 1 && work === null) work = mm.clone();
    else if (timer > 1 && abort === null) abort = mm.clone();
    return translated_0abf(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (abort === null) throw new Error("loc_0abf ABORT entry never captured in the run window");
  if (work === null) throw new Error("loc_0abf WORK entry never captured in the run window");
  return { abort, work };
}

const ENTRIES = ROM_PRESENT ? captureEntries() : null;

/** Run `fn` on a fresh clone of `entry`; return {m, cycles spent}. */
function runClone(entry, fn) {
  const c = entry.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Diff two run-clones' observable state; return {ram, regs, pcEqual}. */
function diffClones(a, b) {
  return {
    ram: firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.m.regs, b.m.regs),
    pcEqual: a.m.pc === b.m.pc,
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0abf matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0abf]]));

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
      `${r.invocations.get(TARGET)}x (ABORT 97..159 + WORK 160)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0abf matches translated in RAM + registers", () => {
  // The standard unit gate captures the FIRST entry -- frame 97, the ABORT branch.
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0abf, optimized_0abf, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (ABORT entry, frame 97)");
});

// -- BRANCH COVERAGE + CYCLE TOTALS -------------------------------------------

test("BRANCH (abort): timer-not-expired branch is EQUAL and preserves its cycle total", () => {
  const a = runClone(ENTRIES.abort, translated_0abf);
  const b = runClone(ENTRIES.abort, optimized_0abf);

  const d = diffClones(a, b);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)} (t ${d.ram.a} vs o ${d.ram.b})` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg} (t ${d.regs.a} vs o ${d.regs.b})` : "");
  assert.ok(d.pcEqual, "pc must match");

  // Cycle-total teeth: the abort branch's only loc_0abf-proper charge is the 11t rst.
  assert.equal(b.cycles, a.cycles, `abort cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);
  const wrong = runClone(ENTRIES.abort, (m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x0018 ? cyc - 1 : cyc);
    try { return optimized_0abf(m); } finally { m.step = realStep; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "abort cycle-total assertion has no teeth");
  console.log(`  BRANCH/abort: EQUAL; cycle total ${b.cycles}t == oracle ${a.cycles}t; wrong-total caught`);
});

test("BRANCH (work): timer-expired body branch is EQUAL and preserves its collapsed cycle total", () => {
  const a = runClone(ENTRIES.work, translated_0abf);
  const b = runClone(ENTRIES.work, optimized_0abf);

  const d = diffClones(a, b);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)} (t ${d.ram.a} vs o ${d.ram.b})` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg} (t ${d.regs.a} vs o ${d.regs.b})` : "");
  assert.ok(d.pcEqual, "pc must match");

  // Cycle-total teeth for the COLLAPSED work branch: optimized total == oracle
  // (both run the same callees via m.call, so the delta pins loc_0abf proper = 198t).
  assert.equal(b.cycles, a.cycles, `work cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);
  const wrong = runClone(ENTRIES.work, (m) => {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x0ae7 ? cyc - 1 : cyc); // 1-cycle epilogue error
    try { return optimized_0abf(m); } finally { m.step = realStep; }
  });
  assert.notEqual(wrong.cycles, a.cycles, "work cycle-total assertion has no teeth");
  console.log(`  BRANCH/work: EQUAL; collapsed cycle total ${b.cycles}t == oracle ${a.cycles}t (loc_0abf proper 198t); wrong-total caught`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong WORK-branch store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0abf]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong WORK-branch store is CAUGHT and names 0x638E", () => {
  // The broken store only happens on the WORK branch, so this diffs the WORK entry
  // (the standard unit gate lands on the ABORT entry, which writes nothing to corrupt).
  const a = runClone(ENTRIES.work, translated_0abf);
  const bad = runClone(ENTRIES.work, broken_0abf);

  const ram = firstStateDiff(a.m.dumpState(), bad.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  assert.ok(ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
