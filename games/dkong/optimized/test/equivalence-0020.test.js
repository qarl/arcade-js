// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0020 (the `rst 0x20` skip helper: the LOW
 * half of a two-byte sub-state prescaler). A LEAF routine -- not a dispatch
 * target -- reached only via `m.call(0x0020)` from many sub-state handlers through
 * the caller-skip idiom `m.push16(ret); m.call(0x0020); if (!m.call(...)) return;`.
 * The unit gate reaches it because the snapshot override is installed at
 * CONSTRUCTION, so it fires however the routine is entered (dispatch OR m.call).
 *
 * Six jobs:
 *
 *   1. EQUAL (whole-machine) -- the idiomatic optimized sub_0020
 *      (optimized/sub_0020.js) reads EQUAL against its translated oracle every
 *      frame. The override is resolved through the routine registry, so it swaps
 *      at every `m.call(0x0020)` site; inert when the map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_0020
 *      first dispatches at frame 7 and fires 25x within the 30-frame window.
 *
 *   3. EQUAL (unit) -- translated vs optimized leave identical RAM + registers
 *      (incl. F, HL and SP) + pc from the captured entry state. The natural entry
 *      takes the NOT-TAKEN branch (0x6008 = 0 -> dec -> 0xFF, nonzero -> skip).
 *
 *   4. BRANCH + CONTRACT COVERAGE -- sub_0020's data-dependent branch is the
 *      `jr z 0x0018` on the low prescaler. Each arm (and, on the taken arm, each
 *      of sub_0018's two outcomes) is SYNTHESISED by poking 0x6008 / 0x6009
 *      identically on BOTH sides, then diffed RAM + regs + pc AND checked for the
 *      exact SP, boolean RETURN value, and CYCLE TOTAL the caller depends on:
 *        - 0x6008 != 1  (not taken -- skip):      ret FALSE, SP +4, 48 t
 *        - 0x6008 == 1, 0x6009 != 1 (taken, sub_0018 skips): ret FALSE, SP +4, 81 t
 *        - 0x6008 == 1, 0x6009 == 1 (taken, sub_0018 returns): ret TRUE, SP +2, 65 t
 *      The cycle-total assertion has teeth (a dropped m.step charge is CAUGHT).
 *
 *   5. TEETH (whole + unit) -- a deliberately-broken twin whose SUBSTATE_TIMER_LO
 *      (0x6008) store lands the wrong value must be CAUGHT: NOT-EQUAL, naming the
 *      diverging address.
 *
 * THE CYCLE DECISION this routine records: sub_0020 stays PER-INSTRUCTION (its
 * charges are NOT collapsed). It is NOT atomic -- a leaf `rst` helper entered from
 * many sub-state contexts (both NMI and main-loop paths), short enough for a
 * vblank NMI to land inside it, and its taken branch calls the interruptible
 * sub_0018. It is the EXACT `pop hl / ret` tail that handler_05e9 inlines and
 * documents as interruptible; collapsing its per-instruction m.step charges to one
 * per-branch lump would move where an NMI lands and change the PC pushed into
 * diffed stack RAM (README §2's "NMI lands mid-logic" caveat). Empirically the
 * collapse happens to stay EQUAL across a 240-frame ATTRACT window (the sub-state
 * handlers all run far from the vblank boundary there) -- but that is absence of
 * evidence, not atomicity, so the oracle's distribution is preserved to stay
 * correct in the gameplay contexts the attract window never exercises. The path
 * TOTALS (48 / 81 / 65 t) are the oracle's by construction and are asserted below.
 *
 * NO write-trace test: sub_0020's only store is `dec (hl)` on 0x6008, which is
 * WORK RAM (0x6000-0x6BFF), not a 0x7Dxx hardware latch -- it does not appear in
 * the emit.js --writes trace, so there is no hardware bus cycle to pin.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0020 as translated_0020 } from "../../translated/nmi.js";
import { sub_0020 as optimized_0020 } from "../sub_0020.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";
import { Machine } from "../../machine.js";
import { SUBSTATE_TIMER_LO, SUBSTATE_TIMER } from "../ram.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built -- run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0020;
const FRAMES = 30; // sub_0020 first fires at frame 7, 25x within 30

// The routine's only store into diffed RAM is `dec (hl)` on SUBSTATE_TIMER_LO
// (0x6008); it fires every frame, and the broken twin corrupts that store.
const BROKEN_ADDR = SUBSTATE_TIMER_LO; // 0x6008

/**
 * Deliberately-broken twin: behaviourally the optimized routine EXCEPT the store
 * to SUBSTATE_TIMER_LO lands a wrong value (correct value XOR 0xFF, guaranteed to
 * differ). The `dec8` flags/branch still use the REAL result -- only the stored
 * byte is corrupted -- so control flow is verbatim and the gate is catching a
 * "wrong value to the routine's own output address" bug, not a control-flow bug.
 */
function broken_0020(m) {
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
    return optimized_0020(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0020 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0020]]));

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

test("EQUAL (unit): idiomatic optimized sub_0020 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0020, optimized_0020);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, HL, SP) + pc identical");
});

// -- BRANCH + CONTRACT COVERAGE ----------------------------------------------

/** Capture the pristine machine the instant sub_0020 is first entered (via m.call,
 *  at frame 7). A constructor override snapshots the entry, then delegates to the
 *  translated oracle so the host run proceeds normally to a clean stop. */
function captureEntry(maxFrames = FRAMES) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0020(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error(`0x${TARGET.toString(16)} never entered in ${maxFrames} frames`);
  return entry;
}

/** Clone `entry`, apply identical pokes, run `fn`, and report the full contract:
 *  the boolean return, the resulting SP + PC, the RAM/reg state, and the cycles
 *  the routine charged (relative to entry, so it is base-independent). */
function runBranch(entry, pokes, fn) {
  const c = entry.clone();
  for (const [addr, val] of pokes) c.mem.write8(addr, val);
  const c0 = c.cycles;
  const ret = fn(c);
  return { ret, cycles: c.cycles - c0, sp: c.regs.sp, pc: c.pc, machine: c };
}

/** Prove one synthesised branch EQUAL across the WHOLE contract: RAM, registers,
 *  pc, the SP delta, the boolean return, and the cycle total. `expect` pins the
 *  return value and cycle total as absolute (structural, entry-independent) so a
 *  wrong total or a flipped boolean on this arm has committed teeth. */
function assertBranchEqual(label, pokes, expect) {
  const entry = captureEntry();
  const o = runBranch(entry, pokes, translated_0020);
  const p = runBranch(entry, pokes, optimized_0020);

  const ram = firstStateDiff(o.machine.dumpState(), p.machine.dumpState(), (off) => o.machine.stateOffsetToAddr(off));
  assert.equal(ram, null, ram ? `RAM diff at 0x${(ram.addr ?? 0).toString(16)}` : "");
  const regs = firstRegDiff(o.machine.regs, p.machine.regs);
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg}` : "");
  assert.equal(o.pc, p.pc, "pc must match between oracle and optimized");

  // return-value + SP + cycle-total contract (the boolean and cycles are NOT in
  // the RAM+regs dump the unit gate compares; SP is, but assert it explicitly).
  assert.equal(o.ret, p.ret, "boolean return must match the oracle");
  assert.equal(o.sp, p.sp, "SP must match the oracle");
  assert.equal(o.cycles, p.cycles, "cycle total must match the oracle");
  assert.equal(o.ret, expect.ret, `oracle return should be ${expect.ret} on this arm`);
  assert.equal(o.cycles, expect.cycles, `oracle cycle total should be ${expect.cycles} on this arm`);
  console.log(
    `  BRANCH/${label}: EQUAL -- ret ${p.ret}, SP 0x${p.sp.toString(16)}, ${p.cycles} t`,
  );
}

test("BRANCH (unit): 0x6008 != 1 -- jr z NOT taken (skip), ret FALSE, 48 t", () => {
  assertBranchEqual("not-taken", [[SUBSTATE_TIMER_LO, 2]], { ret: false, cycles: 48 });
});

test("BRANCH (unit): 0x6008 == 1, 0x6009 != 1 -- taken, sub_0018 skips, ret FALSE, 81 t", () => {
  assertBranchEqual("taken-skip", [[SUBSTATE_TIMER_LO, 1], [SUBSTATE_TIMER, 2]], { ret: false, cycles: 81 });
});

test("BRANCH (unit): 0x6008 == 1, 0x6009 == 1 -- taken, sub_0018 returns, ret TRUE, 65 t", () => {
  assertBranchEqual("taken-return", [[SUBSTATE_TIMER_LO, 1], [SUBSTATE_TIMER, 1]], { ret: true, cycles: 65 });
});

test("BRANCH-TEETH (cycles): a dropped m.step charge yields a wrong total and is CAUGHT", () => {
  const entry = captureEntry();
  const good = runBranch(entry, [[SUBSTATE_TIMER_LO, 2]], optimized_0020);
  // A variant that drops the `dec (hl)` 11 t charge -- same RAM/regs, wrong total.
  const dropped = runBranch(entry, [[SUBSTATE_TIMER_LO, 2]], (m) => {
    const { regs, mem } = m;
    regs.hl = SUBSTATE_TIMER_LO;
    m.step(0x0023, 10);
    mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)), 8); // (charge intentionally dropped)
    if (regs.fZ) { m.step(0x0018, 12); return m.call(0x0018); }
    m.step(0x0026, 7);
    regs.hl = m.pop16();
    m.step(0x0027, 10);
    m.ret();
    return false;
  });
  assert.equal(good.cycles, 48, "the correct not-taken total is 48 t");
  assert.notEqual(dropped.cycles, good.cycles, "cycle-total assertion has no teeth");
  console.log(`  BRANCH-TEETH: correct 48 t vs dropped-charge ${dropped.cycles} t -- caught`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SUBSTATE_TIMER_LO store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_0020]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store -- it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong SUBSTATE_TIMER_LO store is CAUGHT and names 0x6008", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0020, broken_0020);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store -- it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
