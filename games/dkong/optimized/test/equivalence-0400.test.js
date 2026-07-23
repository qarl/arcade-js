// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for entry_0400 (ROM 0x0400: the attract/intro
 * colour-cycle driver ENTERED at the `jp nz,0x0413` mid-way through entry_03fb,
 * with the Z flag as a LIVE-IN). It shares its body and its loc_0413 tail with
 * entry_03fb; the only difference is that it skips the `ld a,(0x6227) / cp 0x02`
 * and takes Z from its caller.
 *
 * WHY THIS TEST SYNTHESISES BOTH BRANCHES INSTEAD OF DRIVING A LIVE DISPATCH.
 * entry_0400 is NEVER dispatched in the current build. The translator named it a
 * "scheduled task 0x0400 handler", but the ROM task-handler table at 0x0307 does NOT
 * contain address 0x0400 (entries: 051c/059b/05c6/05e9/0611/062a/06b8, verified by
 * dumping the table), so dispatchTask can never jump to it. Nothing does m.call(0x0400),
 * and no other transfer targets 0x0400 — only entry_03fb flows THROUGH the address as
 * part of its own body. Measured here (test 4): 0 entries over 1300 coin+start frames,
 * with the no-override baseline running the whole window clean — a live dispatch would
 * throw NotImplemented from dispatchTask, which has no 0x0400 arm. So neither the plain
 * whole-machine EQUAL/DISPATCH gate (the override could never fire, and a real dispatch
 * would crash the baseline) nor the plain unit gate (unitEquivalence throws "never
 * entered") can reach it.
 *
 * Instead we do exactly what the brief's FULL-BRANCH-COVERAGE clause prescribes for an
 * arm no natural/driven run reaches: SYNTHESISE the entry. entry_0400 is byte-for-byte
 * the tail of entry_03fb, whose REAL entry state IS reachable (its one caller loc_197a,
 * the per-frame in-game cascade, dispatches from ~frame 1033 under a coin+start tape).
 * We capture that pristine 0x03FB entry — a state with a proper stack (loc_197a pushed
 * 0x19B3) and realistic RAM, the exact context the loc_0413 colour tree is built to run
 * in — then clone it and force the deciding Z flag to exercise each of entry_0400's two
 * branches, running the translated oracle vs the optimized rewrite on independent clones
 * and diffing RAM + all registers (incl. F) + pc + the CYCLE TOTAL. Because the routine
 * is kept PER-INSTRUCTION (non-atomic — see entry_0400.js), the cycle-total assertion is
 * meaningful teeth against a wrong charge on an arm no whole-machine frame reaches.
 *
 * Four jobs:
 *   1. EQUAL (branch A, Z clear -> jp nz -> loc_0413): synthesised, EQUAL incl. cycles.
 *   2. EQUAL (branch B, Z set  -> 0x63a3/rst38/0x63b7 preamble -> loc_0413): EQUAL incl. cycles.
 *   3. TEETH (branch B): a deliberately-broken twin whose 0x63b7 store lands the wrong
 *      value must be CAUGHT — NOT-EQUAL, naming 0x63b7 (the routine's one own output).
 *   4. NEVER-DISPATCHED (whole-machine measurement, with teeth): a counting override that
 *      delegates to the oracle fires 0x over 1300 coin+start frames, and the no-override
 *      baseline stays healthy — proving the routine is unreached, not merely unobserved.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  entry_0400 as translated_0400,
  entry_03fb as translated_03fb,
} from "../../translated/state0.js";
import { entry_0400 as optimized_0400 } from "../entry_0400.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0400;
const SIBLING = 0x03fb; // reachable capture point (entry_0400 == entry_03fb entered later)
const F_Z = 0x40; // Z flag bit in F
const CAPTURE_FRAMES = 1080; // loc_197a -> entry_03fb first enters ~frame 1033
const SWEEP_FRAMES = 1300; // wide window: attract + credited game + gameplay
const BROKEN_ADDR = 0x63b7; // entry_0400's one own store (the Z-set arm's derived index)

// Canonical coin+start tape (same contract as loc_197a's): coin on IN2 bit7 at
// frame 10, start1 on IN2 bit2 at frame 30 — credits and starts a game so the
// per-frame cascade (and thus entry_03fb) begins dispatching.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 },
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 },
];

function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
}

// Capture the pristine machine state at the sibling entry_03fb's FIRST entry, via
// the same construction-time snapshot the core unit gate uses. entry_0400 IS this
// body entered one instruction later, so this is the faithful entry context.
function captureSiblingEntry() {
  let entry = null;
  const snap = new Map([[SIBLING, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_03fb(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(CAPTURE_FRAMES);
  if (entry === null) {
    throw new Error(`sibling 0x${SIBLING.toString(16)} never entered within ${CAPTURE_FRAMES} frames`);
  }
  return entry;
}

// Run oracle vs optimized on two clones of `entry` with Z forced to `zset`, and diff
// RAM + regs + pc + cycle total. `mutate` optionally wraps the optimized fn (teeth).
function diffBranch(entry, zset, optFn = optimized_0400) {
  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  a.regs.f = zset ? (a.regs.f | F_Z) : (a.regs.f & ~F_Z);
  b.regs.f = zset ? (b.regs.f | F_Z) : (b.regs.f & ~F_Z);

  const cA0 = a.cycles, cB0 = b.cycles;
  translated_0400(a);
  optFn(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return { ram, regs, pcEq: a.pc === b.pc, dA, dB, aPc: a.pc, bPc: b.pc };
}

/**
 * Deliberately-broken twin: behaviourally the optimized entry_0400 EXCEPT the first
 * store to 0x63b7 (the Z-set arm's derived index — the routine's one own output) lands
 * a wrong value (the correct byte XOR 0xFF, guaranteed to differ). Nothing on the path
 * rewrites 0x63b7, so the corruption persists into the state dump.
 */
function broken_0400(m) {
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
    return optimized_0400(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (branch A, Z clear -> jp nz -> loc_0413): optimized matches translated (RAM+regs+pc+cycles)", () => {
  const entry = captureSiblingEntry();
  const r = diffBranch(entry, /* zset */ false);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, `pc mismatch (0x${r.aPc.toString(16)} vs 0x${r.bPc.toString(16)})`);
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
  console.log(`  EQUAL/branch A: RAM+regs(incl F)+pc identical, cycles ${r.dA}t (jp nz -> loc_0413)`);
});

test("EQUAL (branch B, Z set -> 0x63b7 preamble -> loc_0413): optimized matches translated (RAM+regs+pc+cycles)", () => {
  const entry = captureSiblingEntry();
  const r = diffBranch(entry, /* zset */ true);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, `pc mismatch (0x${r.aPc.toString(16)} vs 0x${r.bPc.toString(16)})`);
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
  console.log(`  EQUAL/branch B: RAM+regs(incl F)+pc identical, cycles ${r.dA}t (rst38 + 0x63b7 -> loc_0413)`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (branch B): a wrong 0x63b7 store is CAUGHT and names 0x63B7", () => {
  const entry = captureSiblingEntry();
  const r = diffBranch(entry, /* zset */ true, broken_0400);

  assert.ok(r.ram != null, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/branch B: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`);
});

// -- NEVER-DISPATCHED (whole-machine measurement, with teeth) -----------------

test("NEVER-DISPATCHED: entry_0400 fires 0x over 1300 coin+start frames; baseline stays healthy", () => {
  // A counting override that delegates to the oracle. It is consulted by dispatchTask
  // (m.overrides) AND resolves any m.call(0x0400), so it sees EVERY possible entry.
  let count = 0;
  const counting = new Map([[TARGET, (mm) => { count++; return translated_0400(mm); }]]);
  const probe = makeMachine(counting);
  probe.runFrames(SWEEP_FRAMES);
  assert.equal(probe.stoppedBy, null, `counting run stopped early: ${probe.stoppedBy}`);
  assert.equal(
    count,
    0,
    `entry_0400 WAS entered (${count}x) — it is reachable after all; a live dispatch test is then required`,
  );

  // The no-override baseline runs the whole window clean: had 0x0400 ever dispatched,
  // dispatchTask (no 0x0400 arm, no override) would have thrown NotImplemented.
  const baseline = makeMachine();
  baseline.runFrames(SWEEP_FRAMES);
  assert.equal(baseline.stoppedBy, null, `baseline stopped early: ${baseline.stoppedBy}`);
  assert.equal(baseline.frames.length, SWEEP_FRAMES, "baseline did not reach the full window");
  console.log(`  NEVER-DISPATCHED: 0 entries / ${SWEEP_FRAMES} frames; baseline healthy (proven unreached, tested by synthesis)`);
});
