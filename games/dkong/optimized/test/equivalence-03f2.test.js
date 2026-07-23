// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_03f2 (the periodic-event tail of sub_03a2:
 * store B at (HL), then conditionally inc B and store again, gated on bit 0 of the
 * spin count). Like sub_0008 it is a LEAF reached only via `m.call(0x03f2)` -- from
 * both arms of sub_03a2 (mainloop.js 0x03CE / 0x03EC) -- and, like sub_0008, it is
 * kept PER-INSTRUCTION because sub_03a2 runs in the mask-ENABLED main loop.
 *
 * WHY THIS TEST DRIVES DISPATCH WITH A GUARD POKE (and uses core/equivalence.js
 * directly, like equivalence-0a8a/0008). sub_03a2 only reaches sub_03f2 once four
 * gates pass: rst 0x10 (0x6200 bit0 set), rst 0x30 (a bit of A=3 indexed by BOARD),
 * (0x6350) bit0 clear, the 0x62B8 down-counter hitting 0, and (0x62B9) bit0 set.
 * None of those hold in attract -- sub_03f2 fires 0x over 6000 attract frames (0x62B9
 * is written 1 only by a board-setup screen, loc_101f). So both gates run through a
 * custom makeMachine that HOLDS the five guard bytes with an identical poke tape
 * (m.pokes) on baseline AND optimized alike -- the sanctioned identical-both-sides
 * poke. With it sub_03f2 dispatches every serviced frame from frame 7 (24x in 30
 * frames), and because the spin count's bit 0 jitters frame to frame BOTH branches
 * are exercised naturally: a clean 12 taken / 12 not-taken split. The core engine is
 * still the standard gate (snapshot override installed at CONSTRUCTION, so it reaches
 * this m.call-only leaf); nothing here open-codes a reach-the-routine workaround.
 *
 * Eight jobs:
 *   1. EQUAL (whole-machine) -- optimized == oracle every frame; override fires 24x,
 *      both branches. 2. EQUAL (unit) -- == in RAM + full register file + pc at the
 *      first entry (frame 7, the NOT-taken/double-store branch). 3-4. FULL BRANCH
 *      COVERAGE -- taken (bit0=1) and not-taken (bit0=0) synthesised: EQUAL (RAM,
 *      regs, pc) AND per-instruction cycle total == the oracle's 35 t / 50 t. 5.
 *      CYCLE TEETH -- stripping the charges is CAUGHT at SPIN_COUNT 0x6019, proving
 *      the preserved total is load-bearing. 6. WRITE-SEQUENCE -- the routine's
 *      signature double store: the optimized write sequence to 0x6A29 is byte-
 *      identical to the oracle on both branches ([0x40,0x41] not-taken, [0x40]
 *      taken), and DROPPING the first store -- invisible to the state gate, which
 *      the same test shows stays EQUAL -- is caught by the sequence. 7-8. STATE
 *      TEETH -- a wrong FINAL store to 0x6A29 is CAUGHT (whole + unit, naming it).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_03f2 as translated_03f2 } from "../../translated/mainloop.js";
import { sub_03f2 as optimized_03f2 } from "../sub_03f2.js";
import { Machine } from "../../machine.js";
import { SPIN_COUNT } from "../ram.js";
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

const TARGET = 0x03f2;
const FRAMES = 30;      // sub_03f2 first fires at frame 7, 24x total, both branches
const HL = 0x6a29;      // the address sub_03a2 supplies in HL (sprite shadow buffer)

// Identical-both-sides guard poke: hold the five bytes sub_03a2 gates on so it
// reaches sub_03f2 every serviced frame. bit1 of 0x62B9 is clear -> the 0x03EC arm
// (B = 0x40). Applied to BOTH baseline and optimized via makeMachine below.
const GUARD_POKES = [
  { addr: 0x6200, val: 0x01, frame: 5, dur: null }, // MARIO_ACTIVE bit0 -> rst 0x10 proceeds
  { addr: 0x6227, val: 0x01, frame: 5, dur: null }, // BOARD=1 -> rst 0x30 (rrca A=3 once) carry set
  { addr: 0x6350, val: 0x00, frame: 5, dur: null }, // bit0 clear -> the 0x03AA ret c not taken
  { addr: 0x62b8, val: 0x01, frame: 5, dur: null }, // dec -> 0 each frame -> proceed
  { addr: 0x62b9, val: 0x01, frame: 5, dur: null }, // bit0 set -> the 0x03B6 ret nc not taken
];

function toEntries(ov) {
  return ov instanceof Map ? [...ov] : Object.entries(ov).map(([k, v]) => [parseInt(k, 16), v]);
}

// The engine's factory: a DK Machine on this ROM with the guard poke tape loaded.
// Called with no argument for the baseline and with the wrapped override map for the
// optimized side (the core engine wraps each override with its own invocation
// counter, so an EQUAL that never dispatched cannot pass vacuously).
const makeMachine = (overrides) => {
  const map = new Map();
  if (overrides) for (const [k, v] of toEntries(overrides)) map.set(k, v);
  const m = new Machine(ROM, map.size ? { overrides: map } : {});
  m.pokes = GUARD_POKES.map((p) => ({ ...p }));
  return m;
};

// -- pristine-entry capture (for the synthesised per-branch + cycle assertions) --

/** Capture the machine the instant sub_03f2 is FIRST entered (frame 7). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_03f2(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error(`sub_03f2 never dispatched within ${FRAMES} frames`);
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry with SPIN_COUNT's bit 0 forced to `bit0`. */
function runOn(fn, bit0) {
  const c = ENTRY.clone();
  c.mem.write8(SPIN_COUNT, (c.mem.read8(SPIN_COUNT) & 0xfe) | bit0);
  const before = c.cycles;
  fn(c);
  return { m: c, cyc: c.cycles - before, finalHL: c.mem.read8(HL) };
}

/** Prove oracle == optimized on one branch: RAM + regs + pc + cycle total. */
function assertBranchEqual(bit0, expectedCyc, label) {
  const a = runOn(translated_03f2, bit0); // oracle
  const b = runOn(optimized_03f2, bit0); // optimized
  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (o) => a.m.stateOffsetToAddr(o));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${(ram.addr ?? 0).toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");
  assert.equal(a.cyc, expectedCyc, `oracle ${label} total should be ${expectedCyc}, got ${a.cyc}`);
  assert.equal(b.cyc, expectedCyc, `per-instruction ${label} total ${b.cyc} != oracle ${expectedCyc}`);
  return { a, b };
}

/** Collect the value of every write to 0x6A29 that `fn` performs, in order. */
function writeSeq(fn, bit0) {
  const c = ENTRY.clone();
  c.mem.write8(SPIN_COUNT, (c.mem.read8(SPIN_COUNT) & 0xfe) | bit0);
  const real = c.mem.write8.bind(c.mem);
  const seq = [];
  c.mem.write8 = (a, v, o) => { if (a === HL) seq.push(v); return real(a, v, o); };
  try { fn(c); } finally { c.mem.write8 = real; }
  return { seq, m: c };
}

// -- deliberately-broken twins ------------------------------------------------

/**
 * WRONG-CYCLES twin: correct writes + values, but each branch charges 0 T-states.
 * A frame that reaches the vblank spin sooner spins once more and reseeds the PRNG,
 * so this must diverge at SPIN_COUNT (0x6019).
 */
function wrongCycles_03f2(m) {
  const { regs, mem } = m;
  mem.write8(regs.hl, regs.b);
  regs.a = mem.read8(SPIN_COUNT);
  regs.rrca();
  if (regs.fC) { m.ret(0); return; }
  regs.b = regs.inc8(regs.b);
  mem.write8(regs.hl, regs.b);
  m.ret(0);
}

/**
 * DROP-FIRST twin: behaviourally the optimized routine EXCEPT it omits the FIRST
 * store. On the not-taken branch the final value is UNCHANGED (the second store
 * still lands B+1), so the state gate cannot see it -- but the write SEQUENCE loses
 * its leading element. The routine-appropriate "trace-visible, state-invisible" bug.
 */
function dropFirst_03f2(m) {
  const { regs, mem } = m;
  m.step(0x03f3, 7); // (first ld (hl),b omitted)
  regs.a = mem.read8(SPIN_COUNT);
  m.step(0x03f6, 13);
  regs.rrca();
  m.step(0x03f7, 4);
  if (regs.fC) { m.ret(11); return; }
  m.step(0x03f8, 5);
  regs.b = regs.inc8(regs.b);
  m.step(0x03f9, 4);
  mem.write8(regs.hl, regs.b);
  m.step(0x03fa, 7);
  m.ret();
}

/**
 * WRONG-STORE twin: every store to 0x6A29 lands the value XOR 0xFF, so the FINAL
 * value is wrong on either branch (on the not-taken branch corrupting only the
 * first store would be masked by the second, so both are corrupted). The
 * representative "wrong value to the routine's own output address" bug.
 */
function wrongStore_03f2(m) {
  const real = m.mem.write8.bind(m.mem);
  m.mem.write8 = (a, v, o) => real(a, a === HL ? v ^ 0xff : v, o);
  try { return optimized_03f2(m); } finally { m.mem.write8 = real; }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_03f2 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_03f2]]));

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
      `override fired ${r.invocations.get(TARGET)}x (both branches)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_03f2 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_03f2, optimized_03f2, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. A, B, F) + pc identical (not-taken entry)");
});

// -- FULL BRANCH COVERAGE (EQUAL + per-instruction cycle total) ---------------

test("BRANCH taken (spin bit0=1): EQUAL + per-instruction total == oracle 35t, (HL) = B", () => {
  const { a, b } = assertBranchEqual(1, 35, "taken");
  assert.equal(a.finalHL, 0x40, "oracle taken leaves (HL) = B (0x40)");
  assert.equal(b.finalHL, 0x40, "optimized taken leaves (HL) = B (0x40)");
  console.log(`  BRANCH/taken: (HL)=0x${b.finalHL.toString(16)} (=B), ${b.cyc}t (== oracle) — RAM+regs+pc identical`);
});

test("BRANCH not-taken (spin bit0=0): EQUAL + per-instruction total == oracle 50t, (HL) = B+1", () => {
  const { a, b } = assertBranchEqual(0, 50, "not-taken");
  assert.equal(a.finalHL, 0x41, "oracle not-taken leaves (HL) = B+1 (0x41)");
  assert.equal(b.finalHL, 0x41, "optimized not-taken leaves (HL) = B+1 (0x41)");
  console.log(`  BRANCH/not-taken: (HL)=0x${b.finalHL.toString(16)} (=B+1), ${b.cyc}t (== oracle) — RAM+regs+pc identical`);
});

// -- CYCLE TEETH --------------------------------------------------------------

test("CYCLE TEETH (whole-machine): a WRONG cycle total is CAUGHT at SPIN_COUNT 0x6019", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongCycles_03f2]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "cycle-teeth override must have dispatched");
  assert.equal(r.equal, false, "a wrong total was NOT caught — the preserved total would be a free parameter");
  assert.equal(r.addr, 0x6019, `expected divergence at SPIN_COUNT 0x6019, got 0x${(r.addr ?? 0).toString(16)}`);
  console.log(
    `  CYCLE TEETH: wrong total caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs stripped ${r.optimized})`,
  );
});

// -- WRITE-SEQUENCE (the double-store signature the state gate cannot fully see) --

test("WRITE-SEQUENCE: optimized double-store to 0x6A29 == oracle; a dropped first store is CAUGHT", () => {
  // The optimized write sequence to 0x6A29 is byte-identical to the oracle on both
  // branches -- both stores preserved, in order.
  for (const [bit0, expected, label] of [[0, [0x40, 0x41], "not-taken"], [1, [0x40], "taken"]]) {
    const o = writeSeq(translated_03f2, bit0).seq;
    const p = writeSeq(optimized_03f2, bit0).seq;
    assert.deepEqual(o, expected, `oracle ${label} write sequence unexpected: ${JSON.stringify(o)}`);
    assert.deepEqual(p, o, `optimized ${label} write sequence ${JSON.stringify(p)} != oracle ${JSON.stringify(o)}`);
  }

  // Teeth: dropping the FIRST store is INVISIBLE to the state gate on the not-taken
  // branch (the second store still lands B+1) ...
  const oracle = runOn(translated_03f2, 0);
  const dropped = writeSeq(dropFirst_03f2, 0);
  const stateDiff = firstStateDiff(oracle.m.dumpState(), dropped.m.dumpState(), (o) => oracle.m.stateOffsetToAddr(o));
  assert.equal(stateDiff, null, "precondition: a dropped first store must be invisible to the state gate here");
  // ... but the write SEQUENCE catches it (loses its leading 0x40).
  assert.deepEqual(dropped.seq, [0x41], "dropped-first sequence should be just [0x41]");
  assert.notDeepEqual(dropped.seq, writeSeq(translated_03f2, 0).seq, "write-sequence check has no teeth");
  console.log(
    `  WRITE-SEQUENCE: oracle==optimized ([0x40,0x41]/[0x40]); dropped-first ([0x41]) ` +
      "state-invisible but sequence-caught",
  );
});

// -- STATE TEETH (wrong final value at the output address) --------------------

test("TEETH (whole-machine): a wrong store to 0x6A29 is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongStore_03f2]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs broken ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong store is CAUGHT at the first entry and names 0x6A29", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_03f2, wrongStore_03f2, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    HL,
    `expected first diff at the broken address 0x${HL.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
