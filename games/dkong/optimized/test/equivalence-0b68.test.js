// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0b68 (opening-cutscene phase 6: walk the
 * 0x63C4 record table, render a record every other frame, count down to the next
 * phase). Reached via dispatchGameState (the NMI game-state path) as entry 6 of
 * loc_0a76's 0x0A7A rst-0x28 table, while GAME_SUBSTATE(0x600A)==7 and
 * INTRO_STEP(0x6385)==6.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_0b68 reads EQUAL
 *      against its translated oracle in RAM and in the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. With the
 *      coin+start tape loc_0b68 dispatches 170x over frames 519-688.
 *   3. FULL BRANCH COVERAGE + CYCLE TOTALS -- loc_0b68 has four data-dependent
 *      paths (GATE / ADVANCE / SENTINEL-C1 / SENTINEL-C2), ALL reached naturally
 *      in the 700-frame run. Each is captured at its pristine entry and proven
 *      EQUAL (RAM + regs + pc) in isolation, and -- because every branch is
 *      cycle-COLLAPSED -- each also pins its cycle TOTAL to the oracle's, with a
 *      wrong-total variant shown to be caught (committed teeth on the collapse).
 *   4. TEETH (whole + unit) -- a deliberately-wrong output store (the walk-pointer
 *      write to 0x63C4) is CAUGHT, naming the diverging address.
 *
 * WHY THIS TEST DRIVES INPUT (and uses core/equivalence.js directly, like
 * equivalence-0a8a/0a76). loc_0b68 is a Kong-climb intro phase; it never runs in
 * attract. Both gates feed the canonical coin+start tape (IN2 coin 0x80, then IN2
 * start1 0x04) via a custom makeMachine factory and drive the game-agnostic CORE
 * equivalence engine -- the DK harness.js wrapper bakes `inputs` but not the timed
 * `inputTape`. The core engine is still the standard gate (it installs the
 * snapshot override at CONSTRUCTION, so nothing here open-codes a reach-the-routine
 * workaround). FRAMES = 700 covers all four branches (SENTINEL/C2 fires last, at
 * frame 688).
 *
 * NOTE on the unit TEETH. loc_0b68's FIRST entry (frame 519) is a GATE branch,
 * which makes NO store -- so the standard unitEquivalence teeth (which captures the
 * first entry) would be vacuous. The whole-machine teeth is unaffected (it corrupts
 * the first store, at frame 520). For unit teeth we therefore capture the first
 * WRITING entry (an ADVANCE branch) and diff the oracle against the broken twin on
 * clones of it -- a real single-routine teeth on a branch that actually stores.
 *
 * THE CYCLE FINDING this routine adds: loc_0b68 is ATOMIC and fully COLLAPSED (no
 * hardware write anywhere, so -- unlike loc_0a8a -- there is no write-bus cycle to
 * preserve and the collapse is total, one lump per straight-line segment). It runs
 * INSIDE the vblank NMI (dispatchGameState), which is non-reentrant, and every
 * callee (rst 0x38 -> sub_003d; sub_0da7 -> ...) runs within that same NMI without
 * waiting for vblank, so the NMI never lands inside it -- its internal cycle
 * DISTRIBUTION is unobservable. Each branch's TOTAL is still load-bearing (it feeds
 * the main-loop spin count, README §2); whole-machine EQUAL over 700 frames plus
 * the per-branch cycle-total teeth pin every collapsed sum.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0b68 as translated_0b68 } from "../../translated/state0.js";
import { loc_0b68 as optimized_0b68 } from "../loc_0b68.js";
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

const TARGET = 0x0b68;
const FRAMES = 700; // loc_0b68 dispatches 170x over frames 519-688 (all 4 branches)

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin
// (0x80) then IN2 start1 (0x04) so the ROM's own credit/start logic starts a game
// and the Kong-climb intro runs. A fresh copy per machine keeps runs independent.
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

// loc_0b68's own output store the teeth corrupt: the walk pointer 0x63C4 (work
// RAM, in the compared dump). It is written by the ADVANCE and SENTINEL branches;
// the FIRST store loc_0b68 makes is the ADVANCE write at frame 520, so corrupting
// the first write to it diverges that frame -- the representative "wrong value to
// one of the routine's own output addresses" bug the gate must catch.
const BROKEN_ADDR = 0x63c4;

function broken_0b68(m) {
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
    return optimized_0b68(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- per-branch pristine-entry capture (for isolated branch + cycle checks) ----

/** Which of loc_0b68's four paths this entry state will take. */
function branchOf(mm) {
  if (mm.mem.read8(0x601a) & 1) return "GATE";
  const tableByte = mm.mem.read8(mm.mem.read16(0x63c4));
  if (tableByte !== 0x7f) return "ADVANCE";
  return mm.mem.read8(0x638d) === 1 ? "C2" : "C1"; // SENTINEL: counter->0 is C2
}

/** Capture the machine at the FIRST entry of each of the four branches. */
function captureBranches() {
  const entries = { GATE: null, ADVANCE: null, C1: null, C2: null };
  const snap = new Map([[TARGET, (mm) => {
    const b = branchOf(mm);
    if (entries[b] === null) entries[b] = mm.clone();
    return translated_0b68(mm);
  }]]);
  makeMachine(snap).runFrames(FRAMES);
  for (const [b, e] of Object.entries(entries)) {
    if (e === null) throw new Error(`branch ${b} never reached within ${FRAMES} frames`);
  }
  return entries;
}

const BRANCHES = ROM_PRESENT ? captureBranches() : null;

/** Run `fn` on a fresh clone of the entry; return {m, cycles spent}. */
function runClone(entry, fn) {
  const c = entry.clone();
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** Run optimized_0b68 on a clone but shave 1 cycle off its FIRST charge (m.step
 *  or, since m.ret delegates to m.step, the ret) -- the wrong-total variant whose
 *  detection proves the branch's cycle-total assertion has teeth. */
function runWrongTotal(entry) {
  const c = entry.clone();
  const c0 = c.cycles;
  const realStep = c.step.bind(c);
  let first = true;
  c.step = (addr, cyc) => {
    if (first) { first = false; return realStep(addr, cyc - 1); }
    return realStep(addr, cyc);
  };
  try { optimized_0b68(c); } finally { c.step = realStep; }
  return c.cycles - c0;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0b68 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0b68]]));

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
      `override fired ${r.invocations.get(TARGET)}x (frames 519-688)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0b68 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0b68, optimized_0b68, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (first entry: GATE)");
});

// -- FULL BRANCH COVERAGE + CYCLE TOTALS --------------------------------------

test("BRANCH COVERAGE: all four paths (GATE/ADVANCE/C1/C2) are EQUAL and preserve their cycle totals", () => {
  const expectTotals = { GATE: 28, ADVANCE: null, C1: null, C2: null }; // GATE has no callee; others include m.call'd callees
  for (const name of ["GATE", "ADVANCE", "C1", "C2"]) {
    const entry = BRANCHES[name];

    const a = runClone(entry, translated_0b68); // oracle
    const b = runClone(entry, optimized_0b68); // optimized

    const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.m.regs, b.m.regs);
    assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
    assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
    assert.equal(a.m.pc, b.m.pc, `${name}: pc must match`);

    // Collapsed-branch cycle teeth: optimized total == oracle total exactly...
    assert.equal(b.cycles, a.cycles, `${name}: cycle total drifted (optimized ${b.cycles} vs oracle ${a.cycles})`);
    if (expectTotals[name] != null) {
      assert.equal(b.cycles, expectTotals[name], `${name}: expected ${expectTotals[name]}t`);
    }

    // ...and the assertion is not vacuous: a 1-cycle error is caught.
    assert.notEqual(runWrongTotal(entry), a.cycles, `${name}: cycle-total assertion has no teeth`);

    console.log(`  BRANCH ${name.padEnd(7)}: EQUAL (RAM+regs+pc); cycle total ${b.cycles}t == oracle; wrong-total caught`);
  }
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong walk-pointer store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0b68]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong walk-pointer store is CAUGHT and names 0x63C4", () => {
  // First entry is a non-writing GATE, so use the first WRITING (ADVANCE) entry
  // for a non-vacuous single-routine teeth (see the header note).
  const entry = BRANCHES.ADVANCE;
  const a = runClone(entry, translated_0b68);
  const b = runClone(entry, broken_0b68);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  assert.ok(ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});
