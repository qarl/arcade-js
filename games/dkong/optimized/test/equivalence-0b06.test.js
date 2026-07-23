// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0b06 (the opening-cutscene table walker /
 * terminal setup). Reached via dispatchGameState (the NMI game-state path) as one
 * entry of loc_0a76's 0x0A7A rst-0x28 table during the Kong-climb intro, exactly
 * like its sibling loc_0a8a. It has THREE data-dependent paths:
 *
 *   A -- PARITY GATE (bit0 of FRAME set): `ld a,(FRAME) / rrca / ret c` -- does
 *        nothing on odd frames. Collapsed to m.ret(28).
 *   B -- WALK A NON-SENTINEL BYTE (*0x63C2 != 0x7F): advance the walk pointer and
 *        append the byte via sub_0038. Returns.
 *   C -- THE 0x7F SENTINEL -> TERMINAL SETUP: sub_004E copy + ldir + two sub_0038
 *        adds + a `call 0x304A` spin loop + sub_0DA7 + video/work-RAM stamps +
 *        arm the phase timer + advance INTRO_STEP.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_0b06 reads EQUAL against
 *      its translated oracle in RAM and in the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *   3. FULL BRANCH COVERAGE + CYCLE TOTALS -- all three paths are proven EQUAL on
 *      their pristine captured entry states, and because loc_0b06 is COLLAPSED
 *      (per-instruction m.step charges -> one per straight-line segment), each
 *      branch's cycle TOTAL is pinned to the oracle's, with a wrong total caught.
 *   4. TEETH (whole + unit) -- a deliberately-wrong output store (0x638D, a
 *      branch-C output) is CAUGHT, naming the diverging address.
 *
 * WHY THIS TEST DRIVES INPUT (and uses core/equivalence.js directly, like the
 * sibling equivalence-0a8a). The Kong-climb intro only runs once a credit is
 * inserted and a start button pressed -- loc_0b06 NEVER dispatches in attract. So
 * both gates feed the canonical coin+start tape (IN2 coin 0x80, then IN2 start1
 * 0x04) via a custom makeMachine factory and drive the game-agnostic CORE
 * equivalence engine with it -- the DK harness.js wrapper bakes `inputs` but not
 * the timed `inputTape`. The core engine is still the standard gate (it installs
 * the snapshot override at CONSTRUCTION, so nothing here open-codes a reach-the-
 * routine workaround). With this tape loc_0b06 dispatches 46x within 520 frames --
 * first at frame 441 (path A), 442 (path B), and once at 486 (path C) -- so the
 * whole-machine gate exercises ALL THREE paths; FRAMES = 520 covers path C plus
 * ~34 downstream frames so a wrong cycle total surfaces.
 *
 * THE CYCLE FINDING this routine adds: loc_0b06 is ATOMIC (it runs inside the
 * vblank NMI, which does not re-enter, so the NMI never lands inside it or any
 * callee), so its per-instruction charges collapse to ONE per inter-call segment,
 * each segment's TOTAL preserved. The collapse is PER SEGMENT (not one lump per
 * branch) so the absolute clock at every callee's entry stays byte-identical to
 * the oracle -- protecting any callee hardware-write bus cycle. loc_0b06 makes NO
 * hardware write of its own (0x74AA/0x748A are video RAM, isHardwareWrite=false),
 * so unlike loc_0a8a it needs no write-trace test. The total is still load-bearing:
 * a wrong branch-C total diverged the whole-machine trace at STACK 0x6BF7, frame
 * 487 (the spin-count / shifted-NMI-landing mechanism, README section 2).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0b06 as translated_0b06 } from "../../translated/state0.js";
import { loc_0b06 as optimized_0b06 } from "../loc_0b06.js";
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

const TARGET = 0x0b06;
const FRAMES = 520; // loc_0b06 dispatches 46x; paths A@441, B@442, C@486 all within

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80)
// then IN2 start1 (0x04) so the ROM's own credit/start logic starts a game and the
// Kong-climb intro runs. A fresh copy per machine keeps each run's tape independent.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

// The engine's factory: a DK Machine on this ROM with the coin+start tape loaded.
// Called with no argument for the baseline and with the wrapped override map for
// the optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously).
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// loc_0b06's own branch-C output store the teeth corrupt: 0x638D <- 5 (the record
// index for the next cutscene phase). It is written ONLY on path C, sits in the
// compared work-RAM dump, and is caught cleanly at the frame it is written (486)
// -- the representative "wrong value to one of the routine's own output addresses"
// bug the gate must catch.
const BROKEN_ADDR = 0x638d;

function broken_0b06(m) {
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
    return optimized_0b06(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- pristine per-branch entry capture (for the isolated branch/cycle checks) -----

/**
 * Which of the three paths loc_0b06 takes at a given entry: A (parity gate, odd
 * FRAME), C (the *0x63C2 byte is the 0x7F sentinel), else B (walk a real byte).
 */
function branchOf(mm) {
  const gate = mm.mem.read8(0x601a) & 1; // bit0 of FRAME -> ret c
  if (gate) return "A";
  const ptr = mm.mem.read8(0x63c2) | (mm.mem.read8(0x63c3) << 8);
  return mm.mem.read8(ptr) === 0x7f ? "C" : "B";
}

/** Capture the machine the instant loc_0b06 is FIRST entered on the given path. */
function captureEntry(which) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null && branchOf(mm) === which) entry = mm.clone();
    return translated_0b06(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error(`loc_0b06 path ${which} never entered within ${FRAMES} frames`);
  return entry;
}

const ENTRY = ROM_PRESENT
  ? { A: captureEntry("A"), B: captureEntry("B"), C: captureEntry("C") }
  : null;

/** Run `fn` on a fresh clone of an entry; return {m, cycles spent}. */
function runClone(entry, fn) {
  const c = entry.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Run the optimized routine but shave 1 cycle off its FIRST cycle charge (step or
 *  ret) -- a minimal wrong-total variant for the cycle teeth. */
function runCloneShaved(entry) {
  const c = entry.clone();
  const c0 = c.cycles;
  const realStep = c.step.bind(c);
  const realRet = c.ret.bind(c);
  let shaved = false;
  c.step = (a, cyc) => { const v = shaved ? cyc : (shaved = true, cyc - 1); return realStep(a, v); };
  c.ret = (cyc = 10) => { const v = shaved ? cyc : (shaved = true, cyc - 1); return realRet(v); };
  try { optimized_0b06(c); } finally { c.step = realStep; c.ret = realRet; }
  return c.cycles - c0;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0b06 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0b06]]));

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
      `override fired ${r.invocations.get(TARGET)}x (paths A@441, B@442, C@486 all exercised)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0b06 matches translated in RAM + registers", () => {
  // The FIRST entry is path A (the parity gate, frame 441) -- this pins the gate-
  // return path's RAM + full register file (+ pc). Paths B and C are proven by the
  // BRANCH COVERAGE test below.
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0b06, optimized_0b06, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (path A)");
});

// -- FULL BRANCH COVERAGE + CYCLE TOTALS --------------------------------------

test("BRANCH COVERAGE + CYCLE TOTALS: all three paths are EQUAL and preserve the total", () => {
  const expected = { A: "parity gate (ret c)", B: "walk a non-sentinel byte", C: "0x7F sentinel -> terminal setup" };
  for (const which of ["A", "B", "C"]) {
    const a = runClone(ENTRY[which], translated_0b06);
    const b = runClone(ENTRY[which], optimized_0b06);

    const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.m.regs, b.m.regs);
    assert.equal(ram, null, ram ? `path ${which}: RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
    assert.equal(regs, null, regs ? `path ${which}: reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
    assert.equal(a.m.pc, b.m.pc, `path ${which}: pc mismatch`);

    // Committed cycle teeth for each collapsed branch: the optimized total equals
    // the oracle's exactly (both run the same callees via m.call, so the delta
    // pins loc_0b06's own charges), ...
    assert.equal(b.cycles, a.cycles, `path ${which}: cycle total drifted (optimized ${b.cycles} vs oracle ${a.cycles})`);
    // ...and the assertion is not vacuous: shaving one cycle off the branch's first
    // charge makes the totals disagree.
    assert.notEqual(runCloneShaved(ENTRY[which]), a.cycles, `path ${which}: cycle-total assertion has no teeth`);

    console.log(`  BRANCH ${which} (${expected[which]}): EQUAL, cycle total ${b.cycles}t == oracle ${a.cycles}t; wrong-total caught`);
  }
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong branch-C output store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0b06]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong branch-C output store is CAUGHT and names 0x638D", () => {
  // Path A (the first entry) writes nothing, so the unit teeth run on the captured
  // path-C entry, where 0x638D is a real output store.
  const a = runClone(ENTRY.C, translated_0b06);
  const b = runClone(ENTRY.C, broken_0b06);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  assert.ok(ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
