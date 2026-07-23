// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for entry_3e99 (a collision-severity scorer: clear the
 * overlap counter 0x6060, run entry_3ec3's object-overlap sweep over two record
 * groups, then map the accumulated count to a severity code in A). ROM 0x3E99-0x3EC2.
 *
 * entry_3e99 IS on a live path: entry_1ac3 (movement) -> entry_2853 @0x1C20 ->
 * entry_3e88 @0x286B -> its rst-0x28 table (base 0x3E8D, index = 0x6227/BOARD)
 * selects entry_3e99 on board 1. Over 1500 attract frames it dispatches 4x and
 * naturally reaches BOTH the count-0 -> code-0 arm (3x) and the count-1 -> code-1
 * arm (once, frame 1136). (The frozen oracle header's "not yet wired" note is stale;
 * corrected in optimized/entry_3e99.js, not in the oracle.) So the STANDARD gates
 * apply, mirroring equivalence-0611:
 *
 *   1. EQUAL (whole-machine, standard harness.js) -- optimized entry_3e99 reads EQUAL
 *      against its oracle every frame over the 1500-frame window, and the override
 *      actually dispatches (>= 1, in fact 4x) so EQUAL is not vacuous. This is also
 *      the harness verification of the CYCLE COLLAPSE (README §2): the collapsed
 *      per-branch totals stay EQUAL, whereas stripping the charges entirely diverges
 *      at 0x6019 (SPIN_COUNT) -- see the routine's block comment.
 *
 *   2. EQUAL (unit, standard unitEquivalence) -- captured at entry_3e99's own first
 *      natural entry (frame 606); RAM + all registers (incl. F) + pc identical.
 *
 *   3. BRANCH COVERAGE -- entry_3e99's four data-dependent exits are keyed on the
 *      accumulated overlap count in 0x6060: count 0 -> code 0, 1 -> 1, 2 -> 3,
 *      >= 3 -> 7. Arms 0 and 1 are reached by the natural whole-machine run above;
 *      arms 2 and 3 are not. Each is SYNTHESISED from a captured entry by poking the
 *      object records so entry_3ec3 tallies exactly N overlaps, then proven EQUAL
 *      (RAM+regs+pc, A = the expected code). Because the cycles are COLLAPSED, each
 *      arm ALSO asserts its per-branch CYCLE TOTAL equals the oracle's -- committed
 *      cycle teeth for the arms no whole-machine run reaches.
 *
 *   4. TEETH (whole-machine) -- a deliberately-broken twin whose store to 0x6060
 *      lands the wrong value must be CAUGHT (NOT-EQUAL, naming an address).
 *
 *   5. TEETH (unit, state) -- the same broken store must be CAUGHT and name 0x6060
 *      (proven on the count-0 arm, where entry_3ec3 never rewrites it).
 *
 *   6. TEETH (cycle) -- a deliberately MIS-TIMED twin (one extra m.step charge, same
 *      final state) must be caught by the cycle-total comparison -- proving the cycle
 *      teeth in test 3 are not vacuous.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { entry_3e99 as translated_3e99 } from "../../translated/state0.js";
import { entry_3e99 as optimized_3e99 } from "../entry_3e99.js";
import { Machine } from "../../machine.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x3e99;
const FRAMES = 1500; // dispatches 4x (frames ~606/1136/1250/1470); reaches code-0 + code-1 arms
const UNIT_MAXFRAMES = 700; // first natural entry at frame 606
const COUNT_ADDR = 0x6060; // entry_3e99's own output: the overlap counter it clears + tallies into

// entry_3e99 sweeps group 1 = 10 records at 0x6700 and group 2 = 5 records at 0x6400,
// both stride 0x20. Its callee entry_3ec3 counts an overlap when a record is active
// (bit0 of (ix+0) set) AND both axis compares pass.
const GROUP1 = Array.from({ length: 10 }, (_, i) => (0x6700 + i * 0x20) & 0xffff);
const GROUP2 = Array.from({ length: 5 }, (_, i) => (0x6400 + i * 0x20) & 0xffff);

// Arm the captured entry so entry_3ec3 tallies EXACTLY `n` overlaps. Every record is
// first made inactive (bit0 clear); then the first `n` group-1 records are armed as
// counting overlaps with delta-0 pokes (|C-(ix+5)|+1 < L on axis 1, |(iy+3)-(ix+3)| <
// H on axis 2 -- the same overlap-forcing set equivalence-2901's armHit uses on the
// sibling entry_2913 sweep), so each counts once.
function armCount(n) {
  return (c) => {
    for (const r of GROUP1) c.mem.write8(r, 0x00); // bit0 clear -> inactive
    for (const r of GROUP2) c.mem.write8(r, 0x00);
    // Axis references / thresholds entry_3ec3 reads as live-ins.
    c.regs.c = 0x40;
    c.regs.l = 0x02;
    c.regs.h = 0x01;
    c.regs.iy = 0x6300;
    c.mem.write8(0x6303, 0x30); // (iy+3)
    for (let i = 0; i < n; i++) {
      const base = GROUP1[i];
      c.mem.write8(base + 0, 0x01); // header bit0 set -> active
      c.mem.write8(base + 5, 0x40); // (ix+5) == C        -> axis-1 delta 0
      c.mem.write8(base + 3, 0x30); // (ix+3) == (iy+3)   -> axis-2 delta 0
    }
  };
}

// -- EQUAL (whole-machine) ----------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized entry_3e99 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_3e99]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ${r.invocations.get(TARGET)}x ` +
      "(cycle collapse harness-verified: EQUAL)",
  );
});

// -- EQUAL (unit) -------------------------------------------------------------

test("EQUAL (unit): idiomatic optimized entry_3e99 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_3e99, optimized_3e99, { maxFrames: UNIT_MAXFRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (captured entry_3e99 entry, frame 606)");
});

// -- captured-entry helper (for the synthesised branch + teeth arms) ----------

// Capture the pristine machine at entry_3e99's own first entry (frame 606): a live,
// poppable, register-populated state. Memoised. The synthesised arms clone this and
// poke the object records to drive each count -> code branch deterministically.
let _entry = null;
function captureEntry() {
  if (_entry) return _entry;
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_3e99(mm); // let the host run proceed to a clean stop
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(UNIT_MAXFRAMES);
  if (entry === null) throw new Error(`entry_3e99 never entered within ${UNIT_MAXFRAMES} frames`);
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

// -- BRANCH COVERAGE ----------------------------------------------------------

test("BRANCH COVERAGE: all four count->code arms EQUAL (RAM+regs+pc), incl. per-branch cycle totals", () => {
  const entry = captureEntry();

  const arms = [
    { name: "count 0 -> code 0 (also natural)", n: 0, expA: 0x00 },
    { name: "count 1 -> code 1 (also natural)", n: 1, expA: 0x01 },
    { name: "count 2 -> code 3 (synthesised)", n: 2, expA: 0x03 },
    { name: "count 3 -> code 7 (synthesised)", n: 3, expA: 0x07 },
  ];

  for (const { name, n, expA } of arms) {
    const arm = armCount(n);
    const t = runArm(entry, arm, translated_3e99);
    const o = runArm(entry, arm, optimized_3e99);

    const ram = firstStateDiff(t.dump, o.dump, (off) => entry.stateOffsetToAddr(off));
    const regs = firstRegDiff(t.regs, o.regs);
    assert.equal(ram, null, ram ? `${name}: RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
    assert.equal(regs, null, regs ? `${name}: reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
    assert.equal(t.pc, o.pc, `${name}: pc mismatch`);
    assert.equal(t.ret, o.ret, `${name}: return value mismatch`);

    // The arm actually took the intended exit: A is the severity code, and 0x6060
    // holds the tallied overlap count on both sides.
    assert.equal(o.c.regs.a, expA, `${name}: A must be 0x${expA.toString(16)} on this arm`);
    assert.equal(o.c.mem.read8(COUNT_ADDR), n, `${name}: 0x6060 overlap count must be ${n}`);

    // Cycles are COLLAPSED, so this proves the collapse preserved each branch's TOTAL
    // exactly -- committed cycle teeth for the arms no whole-machine run reaches.
    assert.equal(o.cycles, t.cycles, `${name}: cycle total ${o.cycles} != oracle ${t.cycles}`);
    console.log(`  BRANCH ${name}: EQUAL (RAM+regs+pc), A=0x${expA.toString(16)}, ${o.cycles} t (oracle-matched)`);
  }
});

// -- broken-store twin --------------------------------------------------------

/**
 * Deliberately-broken twin: behaviourally optimized_3e99 EXCEPT its FIRST store to
 * 0x6060 (the counter clear) lands the wrong value (0x00 XOR 0xFF = 0xFF) -- the
 * representative "wrong value to one of the routine's own output addresses" bug the
 * gate must catch.
 */
function brokenStore_3e99(m) {
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
    return optimized_3e99(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- TEETH (whole-machine) ----------------------------------------------------

test("TEETH (whole-machine): a wrong 0x6060 store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, brokenStore_3e99]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

// -- TEETH (unit, state) ------------------------------------------------------

test("TEETH (unit, state): a wrong 0x6060 store is CAUGHT and names 0x6060", () => {
  const entry = captureEntry();
  const arm = armCount(0); // entry_3ec3 never rewrites 0x6060 on this arm, so the break persists
  const a = entry.clone();
  const b = entry.clone();
  arm(a);
  arm(b);

  translated_3e99(a);
  brokenStore_3e99(b);

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
 * Deliberately MIS-TIMED twin: optimized_3e99 with one extra m.step charge (4 t).
 * Final state is identical, but the cycle total is wrong -- so it must be caught by
 * the cycle-total comparison the branch-coverage test relies on.
 */
function misTimed_3e99(m) {
  m.step(0x3e99, 4); // spurious extra charge; overwritten immediately by the real first step
  return optimized_3e99(m);
}

test("TEETH (cycle): a mis-timed twin (extra charge, same state) is CAUGHT by the cycle-total check", () => {
  const entry = captureEntry();
  const t = runArm(entry, armCount(0), translated_3e99);
  const bad = runArm(entry, armCount(0), misTimed_3e99);

  // Same observable state (the mis-timing does not change RAM/regs/pc)...
  const ram = firstStateDiff(t.dump, bad.dump, (off) => entry.stateOffsetToAddr(off));
  assert.equal(ram, null, "the mis-timed twin should leave state identical (only timing differs)");
  // ...but its cycle total differs, which the branch-coverage cycle assertion would reject.
  assert.notEqual(bad.cycles, t.cycles, "cycle-total check is vacuous — a timing bug slipped through");
  assert.equal(bad.cycles, t.cycles + 4, "the mis-timed twin should be exactly 4 t heavier");
  console.log(`  TEETH/cycle: caught mis-timing (${bad.cycles} t vs oracle ${t.cycles} t)`);
});
