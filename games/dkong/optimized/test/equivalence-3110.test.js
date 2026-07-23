// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for guard_3110 (the first of four sibling rst-0x28
 * dispatch guards at ROM 0x3110/311b/3126/3131). guard_3110 reads FRAME (0x601A,
 * the vblank frame counter), tests bit 0, and returns a SKIP BOOLEAN: bit 0 SET ->
 * `ret z` returns NORMALLY (caller resumes); bit 0 CLEAR -> `inc sp / inc sp / ret`
 * splices past its caller (and one rst-0x28 layer up, past entry_30ed). So it paces
 * entry_30ed's tail to run only on odd frames -- a 1-in-2 gate.
 *
 * SURPRISE (recorded in the routine + here): guard_3110's ORACLE header says "not
 * yet wired into the live dispatcher ... the rst 0x28 table is untranslated." That
 * is STALE. guard_3110 IS live-dispatched in plain attract via the fully-wired
 * entry_30ed -> sub_30fa -> sub_0028 -> m.call(0x3110) chain -- MEASURED: 916
 * dispatches over 1500 attract frames, first at frame 586, and BOTH branches occur
 * naturally as FRAME parity alternates (458 normal / 458 splice). So this suite uses
 * the STANDARD whole-machine + unit gates (like equivalence-0611 / -3069), not the
 * non-executing-frontier pattern (equivalence-2901).
 *
 * NO RAM STORE. guard_3110 writes NO memory at all -- its only outputs are registers
 * (A = FRAME & 1, F = the cp result, SP = +2 normal / +4 splice, PC = the popped
 * return) and the boolean. So the teeth live in the REGISTER file, not a store: the
 * unit TEETH below breaks the branch (the documented POLARITY TRAP -- `ret m` sign
 * instead of `ret z` equality) and it is caught as an SP divergence, and the
 * whole-machine TEETH catches the same twin downstream (0x6019, the spin count the
 * wrong branch's different cycle total shifts).
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- idiomatic optimized guard_3110 reads EQUAL against its
 *      translated oracle in RAM and the full register file (+ pc). Override fires
 *      (both branches naturally exercised).
 *   2. BRANCH COVERAGE + CYCLE TOTAL -- the one data-dependent split (FRAME bit 0):
 *      NORMAL (bit0=1, ret z, boolean true, 38 t) and SPLICE (bit0=0, inc sp/inc sp,
 *      boolean false, SP+4, 54 t). Both fire naturally AND are proven in isolation
 *      (RAM+regs+pc+return). guard_3110 is ATOMIC so its cycles are COLLAPSED to one
 *      per-branch total; each isolated arm pins that total to the oracle's.
 *   3. TEETH (whole + unit + cycle) -- the polarity twin is caught (SP / 0x6019), and
 *      a mis-timed twin (same state, +4 t) is caught by the cycle-total check, so the
 *      per-branch cycle assertions are not vacuous.
 *
 * CYCLE DECISION (see optimized/guard_3110.js): guard_3110 is ATOMIC -- it makes no
 * `m.call` (no interruptible callee), so the vblank NMI never lands inside it and its
 * internal cycle DISTRIBUTION is free. Harness-verified: collapsing each branch's
 * per-instruction charges to one total stays EQUAL whole-machine over 1000 frames.
 * The TOTAL is preserved (38 / 54) because it is load-bearing (it sets the main-loop
 * spin count, README §2) -- a wrong total diverges at 0x6019, which the mis-timed
 * cycle-teeth also proves.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { guard_3110 as translated_3110 } from "../../translated/state0.js";
import { guard_3110 as optimized_3110 } from "../guard_3110.js";
import { Machine } from "../../machine.js";
import { wholeMachineEquivalence, unitEquivalence } from "../harness.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x3110;
const FRAME = 0x601a; // the vblank frame counter guard_3110 reads (FRAME in ram.js)
const FRAMES = 640; // guard_3110 first dispatches at frame 586; this covers ~56 dispatches, both branches

// Cycle totals of the two branches (sums of the oracle's per-instruction charges).
const CYC_NORMAL = 38; // 13+7+7 + ret 11
const CYC_SPLICE = 54; // 13+7+7+5+6+6 + ret 10

/**
 * Deliberately-broken twin: the POLARITY TRAP. Identical to optimized_3110 EXCEPT it
 * branches on the SIGN flag (`ret m`, as the three siblings do) instead of the ZERO
 * flag (`ret z`). Since A after `and 0x01` is 0 or 1 and `cp 0x01` gives Z=!S, the two
 * conditions are exact OPPOSITES: this takes the wrong branch on EVERY frame, so its SP
 * / return / downstream control flow diverge from the oracle -- the representative
 * "copied a sibling's condition onto this guard" bug the gate must catch.
 */
function polarityBroken_3110(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(FRAME);
  regs.and(0x01);
  regs.cp(0x01);
  if (regs.fM) { // BUG: sign flag, not zero flag
    m.ret(38);
    return true;
  }
  m.step(0x311a, 44);
  regs.sp = (regs.sp + 2) & 0xffff;
  m.ret(10);
  return false;
}

/**
 * Deliberately MIS-TIMED twin: optimized_3110 with one spurious 4 t charge. Its final
 * state (RAM/regs/pc/return) is identical, but the cycle total is wrong -- so it must be
 * caught by the cycle-total comparison the branch-coverage arms rely on.
 */
function misTimed_3110(m) {
  m.step(TARGET, 4); // spurious extra charge; pc immediately overwritten by the real routine
  return optimized_3110(m);
}

// -- pristine-entry capture (for the isolated per-branch / teeth checks) -------

/** Capture the machine the instant guard_3110 is FIRST entered (frame 586, FRAME=0xBD -> NORMAL). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_3110(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("guard_3110 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/**
 * Run `fn` on a clone of the entry with FRAME optionally poked. `dumpBefore` is the
 * RAM dump AFTER the poke but BEFORE `fn`, so a "did the routine write RAM?" check
 * compares against the routine's true input state, not the pre-poke entry.
 */
function runClone(fn, frameVal) {
  const c = ENTRY.clone();
  if (frameVal !== undefined) c.mem.write8(FRAME, frameVal);
  const dumpBefore = c.dumpState();
  const c0 = c.cycles;
  const ret = fn(c);
  return { m: c, cycles: c.cycles - c0, ret, dumpBefore };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized guard_3110 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_3110]]));

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
      `override fired ${r.invocations.get(TARGET)}x (normal + splice both exercised)`,
  );
});

test("EQUAL (unit): idiomatic optimized guard_3110 matches translated in RAM + registers", () => {
  // unitEquivalence captures the FIRST entry (frame 586, FRAME=0xBD -> NORMAL branch).
  const r = unitEquivalence(ROM, {}, TARGET, translated_3110, optimized_3110, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (normal entry)");
});

// -- BRANCH COVERAGE + CYCLE TOTAL --------------------------------------------

test("BRANCH normal: bit0 SET -- ret z, returns TRUE, SP+2, no store, collapsed total 38 t == oracle", () => {
  const spBefore = ENTRY.regs.sp;
  const a = runClone(translated_3110, 0x01); // FRAME odd -> bit 0 set
  const b = runClone(optimized_3110, 0x01);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");
  assert.equal(a.ret, b.ret, "return value must match");

  // Contract of the normal path: boolean true, A = 1, SP advanced by exactly 2 (one ret pop).
  assert.equal(b.ret, true, "normal path returns TRUE (caller resumes)");
  assert.equal(b.m.regs.a, 0x01, "A = FRAME & 1 = 1 on the normal path");
  assert.equal((b.m.regs.sp - spBefore) & 0xffff, 2, "normal ret pops one address (SP+2)");
  // The routine writes no RAM: the state dump is byte-identical to its input (post-poke).
  assert.equal(
    firstStateDiff(b.dumpBefore, b.m.dumpState(), (off) => b.m.stateOffsetToAddr(off)),
    null,
    "guard_3110 must not write RAM",
  );
  // Collapsed cycle total is pinned to the oracle's (committed teeth for the collapse).
  assert.equal(b.cycles, a.cycles, `normal cycle total drifted: opt ${b.cycles} vs oracle ${a.cycles}`);
  assert.equal(b.cycles, CYC_NORMAL, `normal branch expected ${CYC_NORMAL} t, got ${b.cycles}`);
  console.log(`  BRANCH/normal: EQUAL, ret=true, A=1, SP+2, no store; total ${b.cycles}t == oracle`);
});

test("BRANCH splice: bit0 CLEAR -- inc sp/inc sp/ret, returns FALSE, SP+4, no store, collapsed total 54 t == oracle", () => {
  const spBefore = ENTRY.regs.sp;
  const a = runClone(translated_3110, 0x00); // FRAME even -> bit 0 clear
  const b = runClone(optimized_3110, 0x00);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");
  assert.equal(a.ret, b.ret, "return value must match");

  // Contract of the splice path: boolean false, A = 0, SP advanced by 4 (two inc sp + one ret pop).
  assert.equal(b.ret, false, "splice path returns FALSE (caller must return at once)");
  assert.equal(b.m.regs.a, 0x00, "A = FRAME & 1 = 0 on the splice path");
  assert.equal((b.m.regs.sp - spBefore) & 0xffff, 4, "splice: inc sp/inc sp then ret pop (SP+4)");
  assert.equal(
    firstStateDiff(b.dumpBefore, b.m.dumpState(), (off) => b.m.stateOffsetToAddr(off)),
    null,
    "guard_3110 must not write RAM",
  );
  assert.equal(b.cycles, a.cycles, `splice cycle total drifted: opt ${b.cycles} vs oracle ${a.cycles}`);
  assert.equal(b.cycles, CYC_SPLICE, `splice branch expected ${CYC_SPLICE} t, got ${b.cycles}`);
  console.log(`  BRANCH/splice: EQUAL, ret=false, A=0, SP+4, no store; total ${b.cycles}t == oracle`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): the polarity twin (ret m for ret z) is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, polarityBroken_3110]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong branch — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): the polarity twin is CAUGHT in the register file (SP), since guard_3110 writes no RAM", () => {
  // Natural entry is FRAME=0xBD (bit0 SET): oracle returns normally (SP+2); the polarity
  // twin takes the SIGN branch and splices (SP+4), so SP diverges.
  const a = ENTRY.clone();
  const b = ENTRY.clone();
  translated_3110(a);
  polarityBroken_3110(b);

  // No RAM store on either side, so the RAM dump is identical -- the teeth are in registers.
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(ram, null, "guard_3110 writes no RAM: the divergence is register-only, not a store");
  const regs = firstRegDiff(a.regs, b.regs);
  assert.ok(regs != null, "harness FAILED to catch a wrong branch — it is worthless");
  assert.equal(regs.reg, "sp", `expected the wrong branch to diverge SP, got ${regs.reg}`);
  assert.notEqual(a.pc, b.pc, "the wrong branch also returns to a different PC");
  console.log(`  TEETH/unit: caught at register sp (oracle ${regs.a} vs broken ${regs.b}); pc also differs`);
});

test("TEETH (cycle): a mis-timed twin (same state, +4 t) is CAUGHT by the cycle-total check", () => {
  const good = runClone(translated_3110, 0x01);
  const bad = runClone(misTimed_3110, 0x01);

  // Same observable state (the spurious charge changes no RAM/regs/pc/return)...
  const ram = firstStateDiff(good.m.dumpState(), bad.m.dumpState(), (off) => good.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(good.m.regs, bad.m.regs);
  assert.equal(ram, null, "the mis-timed twin should leave RAM identical");
  assert.equal(regs, null, "the mis-timed twin should leave registers identical");
  assert.equal(good.m.pc, bad.m.pc, "the mis-timed twin should leave pc identical");
  // ...but its cycle total differs, which the branch-coverage cycle assertions would reject.
  assert.notEqual(bad.cycles, good.cycles, "cycle-total check is vacuous — a timing bug slipped through");
  assert.equal(bad.cycles, good.cycles + 4, "the mis-timed twin should be exactly 4 t heavier");
  console.log(`  TEETH/cycle: caught mis-timing (${bad.cycles} t vs oracle ${good.cycles} t)`);
});
