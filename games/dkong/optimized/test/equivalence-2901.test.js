// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_2901 (a one-group wrapper around entry_2913's
 * object-list search; the twin of sub_28b0/sub_28e0). ROM 0x2901-0x2912.
 *
 * sub_2901 is a NON-EXECUTING FRONTIER on today's translated game. It is reached
 * ONLY through entry_3e88's rst-0x28 table (base 0x3E8D), and entry_3e88 is called
 * only from 0x286B (untranslated, < 0x3000). Nothing in translated source invokes
 * entry_3e88, so sub_2901 never dispatches on the executed NMI (0x00CA) / substate
 * (0x0748) / sub_30fa (0x3104) paths -- grep-confirmed in the oracle header, and
 * probe-confirmed here: it fires 0x over 1500 attract frames (REACHABILITY test),
 * while its LIVE twin sub_2880 fires ~2017x over 2500 attract frames and entry_2913
 * ~6044x. It becomes live only once handler_1977 lands and that chain runs.
 *
 * Consequently the STANDARD whole-machine / unit gates cannot NATURALLY dispatch
 * sub_2901 (unitEquivalence would throw "never entered"; the whole-machine override
 * would fire 0x and prove nothing). So this suite:
 *
 *   1. REACHABILITY (standard harness.js wholeMachineEquivalence) -- proves the
 *      frontier: wiring optimized_2901 at 0x2901 is INERT (0 dispatches, EQUAL every
 *      frame), which is why EQUAL/TEETH are proven at UNIT level below.
 *
 *   2. EQUAL (unit, captured entry) -- captures a REAL live machine at its LIVE twin
 *      sub_2880's entry (frame 586; sub_2880 does the same `pop hl` + entry_2913
 *      sweep, so its entry is a faithful, poppable, record-populated state), then runs
 *      translated vs optimized sub_2901 on clones and diffs RAM + all registers + pc.
 *      This is the brief-sanctioned synthesise-the-entry path for an unreached routine.
 *
 *   3. BRANCH COVERAGE -- sub_2901's one data-dependent split is entry_2913's return:
 *      NORMAL (list exhausted, A=0, sub_2901 rets) vs HIT (match, A=1, entry_2913
 *      discards our return address and rets to OUR caller; sub_2901 returns without a
 *      second ret). Both are SYNTHESISED from the captured entry (records poked) and
 *      proven EQUAL (RAM+regs+pc). Both also assert the per-branch CYCLE TOTAL equals
 *      the oracle's (NORMAL 529 t, HIT 276 t) -- committed cycle teeth, since NO
 *      whole-machine run reaches either arm.
 *
 *   4. TEETH (unit, state) -- a deliberately-broken twin whose store to sub_2901's own
 *      output (0x63B9, the sweep count) lands the wrong value must be CAUGHT, naming
 *      0x63B9.
 *
 *   5. TEETH (cycle) -- a deliberately MIS-TIMED twin (one extra m.step charge, same
 *      final state) must be caught by the cycle-total comparison -- proving the cycle
 *      teeth in test 3 are not vacuous (a timing-only bug is CAUGHT).
 *
 * CYCLE DECISION (see optimized/sub_2901.js): cycles are kept PER-INSTRUCTION, NOT
 * collapsed. A collapse is permitted (README §2) only once the harness proves it
 * EQUAL whole-machine, which is impossible for a routine that never runs in a frame.
 * Per-instruction is byte-identical to the oracle's distribution -- no unverifiable
 * timing claim -- and the per-branch totals are asserted equal regardless.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_2901 as translated_2901, sub_2880 } from "../../translated/state0.js";
import { sub_2901 as optimized_2901 } from "../sub_2901.js";
import { Machine } from "../../machine.js";
import { wholeMachineEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2901;
const CAPTURE_TARGET = 0x2880; // sub_2901's LIVE twin -- same pop-hl + entry_2913 sweep shape
const REACH_FRAMES = 1500; // attract window proving the 0x2901 frontier (0 dispatches)
const CAPTURE_FRAMES = 700; // sub_2880 first dispatches at frame 586
const COUNT_ADDR = 0x63b9; // sub_2901's own output: entry_2913's shared sweep-count byte

// entry_2913 sweeps B records at IX, stride DE; sub_2901 uses B=7, IX=0x6400, DE=0x20.
const RECORDS = [0x6400, 0x6420, 0x6440, 0x6460, 0x6480, 0x64a0, 0x64c0];

// NORMAL arm: clear bit0 of every record header -> every slot inactive -> entry_2913
// exhausts the list (A=0) and sub_2901 rets normally.
function armNormal(c) {
  for (const r of RECORDS) c.mem.write8(r, 0x00);
}

// HIT arm: arm record 0 so entry_2913 matches on the first iteration (A=1) and takes
// the frame-skip exit; the rest are cleared so only record 0 can hit. The pokes make
// every range compare pass on the taken path (|C-(ix+5)|+1 < L, |(iy+3)-(ix+3)| < H).
function armHit(c) {
  for (let i = 1; i < RECORDS.length; i++) c.mem.write8(RECORDS[i], 0x00);
  c.regs.c = 0x40;
  c.regs.l = 0x02;
  c.regs.h = 0x01;
  c.regs.iy = 0x6300;
  c.mem.write8(0x6303, 0x30); // (iy+3)
  c.mem.write8(0x6400, 0x01); // (ix+0): bit0 set -> slot active
  c.mem.write8(0x6405, 0x40); // (ix+5) == C   -> axis-1 delta 0
  c.mem.write8(0x6403, 0x30); // (ix+3) == (iy+3) -> axis-2 delta 0
}

// -- REACHABILITY -------------------------------------------------------------

test("REACHABILITY: sub_2901 is a non-executing frontier — 0 dispatches, wiring is inert", () => {
  const r = wholeMachineEquivalence(ROM, {}, REACH_FRAMES, new Map([[TARGET, optimized_2901]]));

  assert.equal(
    r.invocations.get(TARGET),
    0,
    `sub_2901 was expected UNREACHED on live paths but dispatched ${r.invocations.get(TARGET)}x — ` +
      "the frontier assumption (and the unit-level gating below) would need revisiting",
  );
  assert.equal(r.equal, true, "wiring an unreached override must be inert (EQUAL every frame)");
  assert.equal(r.framesCompared, REACH_FRAMES);
  console.log(
    `  REACHABILITY: 0x2901 fired 0x over ${REACH_FRAMES} attract frames — EQUAL/TEETH proven at unit level`,
  );
});

// -- captured-entry helper ----------------------------------------------------

// Capture the pristine machine at sub_2880's first entry (frame 586). sub_2880 is
// sub_2901's live twin: it does the identical `pop hl` and drives entry_2913 over
// the 0x6400 record region, so this is a faithful entry-shaped state for sub_2901 --
// a poppable stack and live records/registers. Memoised: the 700-frame run is done once.
let _entry = null;
function captureEntry() {
  if (_entry) return _entry;
  let entry = null;
  const snap = new Map([[CAPTURE_TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return sub_2880(mm); // let the host run proceed to a clean stop
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(CAPTURE_FRAMES);
  if (entry === null) throw new Error(`sub_2880 never entered within ${CAPTURE_FRAMES} frames`);
  _entry = entry;
  return entry;
}

// Run one implementation on a clone with `arm` applied, returning post-run
// dump/regs/pc + the routine's measured cycle total and the clone itself.
function runArm(entry, arm, fn) {
  const c = entry.clone();
  arm(c);
  const before = c.cycles;
  const ret = fn(c);
  return { dump: c.dumpState(), regs: c.regs, pc: c.pc, cycles: c.cycles - before, ret, c };
}

// -- EQUAL (unit, captured entry) ---------------------------------------------

test("EQUAL (unit): idiomatic optimized sub_2901 matches translated in RAM + registers + pc", () => {
  const entry = captureEntry();
  const a = entry.clone();
  const b = entry.clone();

  translated_2901(a);
  optimized_2901(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, "pc must match");
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, HL, DE, IX, SP) + pc identical (captured sub_2880 entry, frame 586)");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

test("BRANCH COVERAGE: NORMAL + HIT arms EQUAL (RAM+regs+pc), incl. per-branch cycle totals", () => {
  const entry = captureEntry();

  const arms = [
    { name: "NORMAL (list exhausted, A=0)", arm: armNormal, expA: 0x00, expCyc: 529 },
    { name: "HIT (match, A=1, frame-skip)", arm: armHit, expA: 0x01, expCyc: 276 },
  ];

  for (const { name, arm, expA, expCyc } of arms) {
    const t = runArm(entry, arm, translated_2901);
    const o = runArm(entry, arm, optimized_2901);

    const ram = firstStateDiff(t.dump, o.dump, (off) => entry.stateOffsetToAddr(off));
    const regs = firstRegDiff(t.regs, o.regs);
    assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
    assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
    assert.equal(t.pc, o.pc, `${name}: pc mismatch`);
    assert.equal(t.ret, o.ret, `${name}: return value mismatch`);

    // The arm actually took the intended path (A distinguishes the two exits).
    assert.equal(o.c.regs.a, expA, `${name}: A must be 0x${expA.toString(16)} on this arm`);
    // sub_2901 always writes its sweep count 0x07 to 0x63B9 on both arms.
    assert.equal(o.c.mem.read8(COUNT_ADDR), 0x07, `${name}: 0x63B9 sweep count`);

    // Per-instruction cycles are kept, so the total must match the oracle exactly.
    // Committed cycle teeth for arms no whole-machine run reaches.
    assert.equal(o.cycles, t.cycles, `${name}: cycle total ${o.cycles} != oracle ${t.cycles}`);
    assert.equal(o.cycles, expCyc, `${name}: expected ${expCyc} t total, got ${o.cycles}`);
  }
  console.log("  BRANCH COVERAGE: NORMAL (529 t) + HIT (276 t) arms EQUAL (RAM+regs+pc); totals oracle-matched");
});

// -- TEETH (state) ------------------------------------------------------------

/**
 * Deliberately-broken twin: behaviourally optimized_2901 EXCEPT its store to 0x63B9
 * lands the wrong value (correct byte XOR 0xFF). entry_2913 never rewrites 0x63B9,
 * so the corruption persists -- the representative "wrong value to one of the
 * routine's own output addresses" bug the gate must catch.
 */
function brokenStore_2901(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === COUNT_ADDR) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_2901(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

test("TEETH (unit, state): a wrong 0x63B9 store is CAUGHT and names 0x63B9", () => {
  const entry = captureEntry();
  const a = entry.clone();
  const b = entry.clone();

  translated_2901(a);
  brokenStore_2901(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.ok(ram != null, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(
    ram.addr,
    COUNT_ADDR,
    `expected first diff at 0x${COUNT_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/state: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});

// -- TEETH (cycle) ------------------------------------------------------------

/**
 * Deliberately MIS-TIMED twin: optimized_2901 with one extra m.step charge (4 t).
 * Final state is identical, but the cycle total is wrong -- so it must be caught by
 * the cycle-total comparison the branch-coverage test relies on.
 */
function misTimed_2901(m) {
  m.step(0x2901, 4); // spurious extra charge; overwritten immediately by the real first step
  return optimized_2901(m);
}

test("TEETH (cycle): a mis-timed twin (extra charge, same state) is CAUGHT by the cycle-total check", () => {
  const entry = captureEntry();
  const t = runArm(entry, armNormal, translated_2901);
  const bad = runArm(entry, armNormal, misTimed_2901);

  // Same observable state (the mis-timing does not change RAM/regs/pc)...
  const ram = firstStateDiff(t.dump, bad.dump, (off) => entry.stateOffsetToAddr(off));
  assert.equal(ram, null, "the mis-timed twin should leave state identical (only timing differs)");
  // ...but its cycle total differs, which the branch-coverage cycle assertion would reject.
  assert.notEqual(bad.cycles, t.cycles, "cycle-total check is vacuous — a timing bug slipped through");
  assert.equal(bad.cycles, t.cycles + 4, "the mis-timed twin should be exactly 4 t heavier");
  console.log(`  TEETH/cycle: caught mis-timing (${bad.cycles} t vs oracle ${t.cycles} t)`);
});
