// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_12ac (0x639D dispatch arm 1: a two-cell
 * blinker with a sub-phase countdown that advances the 0x639D state). Like
 * handler_01c3 it is an NMI game-state dispatch target (dispatchGameState),
 * reached as table[1] of the 0x639D rst-0x28 table (entry_127f @ ROM 0x1283)
 * during the attract sequence.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized loc_12ac
 *      (optimized/loc_12ac.js) reads EQUAL against its translated oracle, every
 *      frame. The override routes through dispatchGameState's override consult
 *      (nmi.js), inert when the map is empty.
 *
 *   2. EQUAL (unit) -- EQUAL in RAM + the whole register file (incl. F) + pc, on
 *      the naturally-captured first entry. loc_12ac first dispatches late (frame
 *      2619), so maxFrames is widened to reach it; that first entry takes the
 *      GATE-SKIP branch (rst 0x18 not expired), which the unit gate proves equal.
 *
 *   3. TEETH (whole-machine) -- a deliberately-broken twin (the first blink store
 *      to 0x694D lands the wrong value) must be CAUGHT: NOT-EQUAL, naming 0x694D.
 *
 *   4. TEETH (unit) -- the same wrong store, caught in isolation. The natural
 *      first entry is the gate-skip branch (it writes NOTHING), so a write-based
 *      TEETH needs a WRITING branch: this synthesises a blink-branch entry (poke
 *      SUBSTATE_TIMER=1, 0x639E=13), runs oracle vs broken directly, and asserts
 *      the first diff is the broken address 0x694D.
 *
 *   5. FULL BRANCH COVERAGE -- loc_12ac's three data-dependent branches each
 *      proven EQUAL on a synthesised entry (RAM + registers + pc), AND -- because
 *      the cycles are COLLAPSED to one charge per branch -- each branch's CYCLE
 *      TOTAL is asserted equal to the oracle's, so a wrong collapsed total has
 *      teeth even though the whole-machine run already reaches all three:
 *        A  gate-skip   (SUBSTATE_TIMER != 1)          -> early return, no writes
 *        B  advance     (== 1, 0x639E -> 0)            -> tail 0x12CB, state bump
 *        C  blink       (== 1, 0x639E still counting)  -> toggle 0x694D/0x694E
 *
 * THE CYCLE FINDING this routine adds: loc_12ac is ATOMIC and its per-branch
 * total is COLLAPSED to a single m.step charge (blink 140, advance 145). It runs
 * inside the NMI handler, where the hardware NMI mask is cleared (no nested NMI)
 * and -- with NMI_CYCLE_IN_FRAME=0 -- ~50688 cycles from the next frame boundary
 * (no mid-routine state capture), so its internal cycle DISTRIBUTION is
 * unobservable. The TOTAL is still load-bearing (the NMI handler's cost sets the
 * main-loop spin count that seeds the PRNG, README §2); preserving each branch's
 * total keeps the whole-machine trace identical, which tests 1 and 5 both prove.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_12ac as translated_12ac } from "../../translated/state0.js";
import { loc_12ac as optimized_12ac } from "../loc_12ac.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";
import { Machine } from "../../machine.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x12ac;
// loc_12ac first dispatches at frame 2619 (gate-skip), first blink at 2626, first
// advance at 2722 -- so a 2730-frame window covers all three branches naturally.
const FRAMES = 2730;
const MAXFRAMES_UNIT = 2650; // enough to reach the first (frame-2619) entry

// The first blink store lands the sprite-code cell 0x694D; on the natural run the
// first write to it is at frame 2626 (branch C), and it survives to the frame
// boundary, so the corrupted value shows in the captured state dump.
const BROKEN_ADDR = 0x694d;

// RAM address of 0x639E (sub-phase counter) and SUBSTATE_TIMER (0x6009), the two
// bytes that steer the branch when synthesising entries.
const SUBSTATE_TIMER = 0x6009;
const PHASE_639E = 0x639e;

/**
 * Deliberately-broken twin: behaviourally the optimized handler EXCEPT the first
 * store to 0x694D lands a wrong value (the correct byte XOR 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine run
 * verbatim -- the representative "wrong value to one of the routine's own output
 * addresses" bug the gate must catch.
 */
function broken_12ac(m) {
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
    return optimized_12ac(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- shared entry snapshot for the synthesised branch tests --------------------
// Capture the machine at the instant loc_12ac is first entered, ONCE, and clone
// it per branch. (The unit harness does the same internally for tests 2 and 4.)
let ENTRY = null;
function capturedEntry() {
  if (ENTRY) return ENTRY;
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_12ac(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(MAXFRAMES_UNIT);
  assert.ok(entry !== null, "loc_12ac never entered — cannot synthesise branches");
  ENTRY = entry;
  return ENTRY;
}

/**
 * Run oracle and optimized from an identical synthesised entry (SUBSTATE_TIMER
 * and 0x639E poked to force a branch), and return the RAM/reg/pc diffs plus each
 * side's cycle delta across the routine.
 */
function runBranch(timer, phase) {
  const base = capturedEntry();
  const a = base.clone();
  a.mem.write8(SUBSTATE_TIMER, timer);
  a.mem.write8(PHASE_639E, phase);
  const b = base.clone();
  b.mem.write8(SUBSTATE_TIMER, timer);
  b.mem.write8(PHASE_639E, phase);

  const ca0 = a.cycles;
  const cb0 = b.cycles;
  translated_12ac(a);
  optimized_12ac(b);

  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pcEqual: a.pc === b.pc,
    cyclesOracle: a.cycles - ca0,
    cyclesOptimized: b.cycles - cb0,
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_12ac matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_12ac]]));

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

test("EQUAL (unit): idiomatic optimized loc_12ac matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_12ac, optimized_12ac, { maxFrames: MAXFRAMES_UNIT });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (first entry = gate-skip branch)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong blink store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_12ac]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong blink store is CAUGHT and names 0x694D", () => {
  // The natural first entry is the gate-skip branch (writes nothing), so this
  // synthesises a BLINK entry -- the writing branch the broken store lives on.
  const base = capturedEntry();
  const a = base.clone();
  a.mem.write8(SUBSTATE_TIMER, 1);
  a.mem.write8(PHASE_639E, 13);
  const b = base.clone();
  b.mem.write8(SUBSTATE_TIMER, 1);
  b.mem.write8(PHASE_639E, 13);

  translated_12ac(a);
  broken_12ac(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.ok(ram != null, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (RAM + regs + pc + collapsed cycle total) ------------

test("BRANCH A (gate-skip): EQUAL RAM + regs + pc + cycle total", () => {
  const r = runBranch(8, 13); // SUBSTATE_TIMER != 1 -> rst 0x18 skips, early return
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch A cycle total must equal the oracle's");
  console.log(`  BRANCH A: EQUAL, cycles ${r.cyclesOptimized} (== oracle)`);
});

test("BRANCH B (advance/tail 0x12CB): EQUAL RAM + regs + pc + cycle total", () => {
  const r = runBranch(1, 1); // gate passes, 0x639E dec -> 0 -> advance state
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch B cycle total must equal the oracle's");
  console.log(`  BRANCH B: EQUAL, cycles ${r.cyclesOptimized} (== oracle; collapsed tail total 145)`);
});

test("BRANCH C (blink): EQUAL RAM + regs + pc + cycle total", () => {
  const r = runBranch(1, 13); // gate passes, 0x639E still counting -> blink
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.ok(r.pcEqual, "pc must match");
  assert.equal(r.cyclesOptimized, r.cyclesOracle, "branch C cycle total must equal the oracle's");
  console.log(`  BRANCH C: EQUAL, cycles ${r.cyclesOptimized} (== oracle; collapsed blink total 140)`);
});
