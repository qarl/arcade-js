// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0010 (the `rst 0x10` player-alive skip gate).
 * sub_0010 reads MARIO_ACTIVE (0x6200, 1 = Mario alive/processed, 0 = dead/inert),
 * rotates bit 0 into carry, and returns a SKIP BOOLEAN: bit 0 SET -> `ret c` returns
 * NORMALLY (caller resumes); bit 0 CLEAR -> `inc sp / inc sp / ret` splices past its
 * caller. So each player-context caller (`if (!m.call(0x0010)) return;`) runs its body
 * only while Mario is alive. It is a LEAF -- reached ONLY via m.call from many
 * routines, never a dispatch target -- so both gates reach it through the registry's
 * construction-time override (unitEquivalence handles this).
 *
 * THE POLARITY TRAP (mirrored from the routine header): sub_0010 is the EXACT MIRROR
 * of sub_0008 (`rst 0x08`), one opcode apart -- sub_0008 returns normally on `ret nc`
 * (bit CLEAR), sub_0010 on `ret c` (bit SET). Copying sub_0008's `if (regs.fNC)` onto
 * this routine takes the WRONG branch on every call. sub_0010 writes NO RAM, so the
 * write-gate can't see it; the teeth live in the REGISTER file (SP), and the unit
 * TEETH below flips exactly this (`fNC` for `fC`) and catches it as an SP divergence.
 *
 * NO RAM STORE. sub_0010 writes NO memory at all -- its only outputs are registers
 * (A = 0x6200 rotated right one, F = the rrca result, SP = +2 normal / +4 splice,
 * PC = the popped return) and the boolean. So the teeth live in the register file,
 * not a store.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- idiomatic optimized sub_0010 reads EQUAL against its
 *      translated oracle in RAM and the full register file (+ pc). Override fires
 *      (both branches naturally exercised: MARIO_ACTIVE alternates with Mario's alive
 *      state -- splice while inert during the attract lead-in, normal once the demo
 *      brings Mario alive).
 *   2. BRANCH COVERAGE + CYCLE TOTAL -- the one data-dependent split (bit 0 of
 *      MARIO_ACTIVE): NORMAL (bit0=1, ret c, boolean true, SP+2, 28 t) and SPLICE
 *      (bit0=0, inc sp/inc sp, boolean false, SP+4, 44 t). Both fire naturally AND are
 *      proven in isolation (RAM+regs+pc+return). Cycles are kept PER-INSTRUCTION (see
 *      the CYCLE DECISION below); each isolated arm pins its total to the oracle's.
 *   3. TEETH (whole + unit + cycle) -- the polarity twin is caught (SP / downstream),
 *      and a mis-timed twin (same state, +4 t) is caught by the cycle-total check, so
 *      the per-branch cycle assertions are not vacuous.
 *
 * CYCLE DECISION (see optimized/sub_0010.js): sub_0010 is kept PER-INSTRUCTION, NOT
 * collapsed. It is atomic on the NMI game-state path (mask cleared), but it is ALSO
 * reached from the INTERRUPTIBLE main-loop cascade loc_197a -- decisively non-atomic
 * -- via entry_2c03 (0x2C03) and entry_2ddb (0x2DDB), which `rst 0x10` into here while
 * the NMI mask is SET. A vblank NMI can therefore land inside this 4-6 instruction body
 * on the gameplay path; collapsing to one per-branch charge would move where it lands
 * and push a divergent stack PC. This test runs only ATTRACT frames, which do NOT run
 * loc_197a (no credited game), so it CANNOT prove atomicity on that path -- exactly why
 * per-instruction is the safe choice, like siblings sub_0020 / loc_197a. The oracle's
 * per-instruction DISTRIBUTION is reproduced charge-for-charge; each branch TOTAL is
 * the oracle's by construction (normal 28 / splice 44), which the branch-coverage
 * cycle assertions pin and the mis-timed cycle-teeth prove non-vacuous.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0010 as translated_0010 } from "../../translated/mainloop.js";
import { sub_0010 as optimized_0010 } from "../sub_0010.js";
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

const TARGET = 0x0010;
const MARIO_ACTIVE = 0x6200; // the player-alive byte sub_0010 reads (MARIO_ACTIVE in ram.js)
const FRAMES = 640; // sub_0010 dispatches from frame 5; by 640 BOTH branches occur (225 normal / 577 splice)

// Cycle totals of the two branches (sums of the oracle's per-instruction charges).
const CYC_NORMAL = 28; // 13 (ld) + 4 (rrca) + ret c 11
const CYC_SPLICE = 44; // 13 (ld) + 4 (rrca) + 5 (ret-c-not-taken) + 6 (inc sp) + 6 (inc sp) + ret 10

/**
 * Deliberately-broken twin: the POLARITY TRAP. Identical to optimized_0010 EXCEPT it
 * returns on the CARRY-CLEAR condition (`ret nc`, as sub_0008 does) instead of
 * CARRY-SET (`ret c`). The two conditions are exact OPPOSITES, so this takes the wrong
 * branch on EVERY call -- its SP / return / downstream control flow diverge from the
 * oracle. The representative "copied sub_0008's condition onto rst 0x10" bug.
 */
function polarityBroken_0010(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(MARIO_ACTIVE);
  regs.rrca();
  if (regs.fNC) { // BUG: carry-CLEAR (sub_0008's polarity), not carry-SET
    m.ret(28);
    return true;
  }
  m.step(0x0017, 34);
  regs.sp = (regs.sp + 2) & 0xffff;
  m.ret(10);
  return false;
}

/**
 * Deliberately MIS-TIMED twin: optimized_0010 with one spurious 4 t charge. Its final
 * state (RAM/regs/pc/return) is identical, but the cycle total is wrong -- so it must be
 * caught by the cycle-total comparison the branch-coverage arms rely on.
 */
function misTimed_0010(m) {
  m.step(TARGET, 4); // spurious extra charge; pc immediately overwritten by the real routine
  return optimized_0010(m);
}

// -- pristine-entry capture (for the isolated per-branch / teeth checks) -------

/** Capture the machine the instant sub_0010 is FIRST entered (frame 5, MARIO_ACTIVE=0 -> SPLICE). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0010(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("sub_0010 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/**
 * Run `fn` on a clone of the entry with MARIO_ACTIVE optionally poked. `dumpBefore` is
 * the RAM dump AFTER the poke but BEFORE `fn`, so a "did the routine write RAM?" check
 * compares against the routine's true input state, not the pre-poke entry.
 */
function runClone(fn, aliveVal) {
  const c = ENTRY.clone();
  if (aliveVal !== undefined) c.mem.write8(MARIO_ACTIVE, aliveVal);
  const dumpBefore = c.dumpState();
  const c0 = c.cycles;
  const ret = fn(c);
  return { m: c, cycles: c.cycles - c0, ret, dumpBefore };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0010 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0010]]));

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

test("EQUAL (unit): idiomatic optimized sub_0010 matches translated in RAM + registers", () => {
  // unitEquivalence captures the FIRST entry (frame 5, MARIO_ACTIVE=0 -> SPLICE branch).
  const r = unitEquivalence(ROM, {}, TARGET, translated_0010, optimized_0010, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (splice entry)");
});

// -- BRANCH COVERAGE + CYCLE TOTAL --------------------------------------------

test("BRANCH normal: bit0 SET -- ret c, returns TRUE, SP+2, no store, per-instruction total 28 t == oracle", () => {
  const spBefore = ENTRY.regs.sp;
  const a = runClone(translated_0010, 0x01); // MARIO_ACTIVE alive -> bit 0 set
  const b = runClone(optimized_0010, 0x01);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");
  assert.equal(a.ret, b.ret, "return value must match");

  // Contract of the normal path: boolean true, A = rrca(0x01) = 0x80, SP advanced by exactly 2.
  assert.equal(b.ret, true, "normal path returns TRUE (caller resumes)");
  assert.equal(b.m.regs.a, 0x80, "A = rrca(0x01) = 0x80 on the normal path");
  assert.equal((b.m.regs.sp - spBefore) & 0xffff, 2, "normal ret pops one address (SP+2)");
  // The routine writes no RAM: the state dump is byte-identical to its input (post-poke).
  assert.equal(
    firstStateDiff(b.dumpBefore, b.m.dumpState(), (off) => b.m.stateOffsetToAddr(off)),
    null,
    "sub_0010 must not write RAM",
  );
  // Per-instruction cycle total is pinned to the oracle's (committed teeth for the total).
  assert.equal(b.cycles, a.cycles, `normal cycle total drifted: opt ${b.cycles} vs oracle ${a.cycles}`);
  assert.equal(b.cycles, CYC_NORMAL, `normal branch expected ${CYC_NORMAL} t, got ${b.cycles}`);
  console.log(`  BRANCH/normal: EQUAL, ret=true, A=0x80, SP+2, no store; total ${b.cycles}t == oracle`);
});

test("BRANCH splice: bit0 CLEAR -- inc sp/inc sp/ret, returns FALSE, SP+4, no store, per-instruction total 44 t == oracle", () => {
  const spBefore = ENTRY.regs.sp;
  const a = runClone(translated_0010, 0x00); // MARIO_ACTIVE inert -> bit 0 clear
  const b = runClone(optimized_0010, 0x00);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");
  assert.equal(a.ret, b.ret, "return value must match");

  // Contract of the splice path: boolean false, A = rrca(0x00) = 0, SP advanced by 4.
  assert.equal(b.ret, false, "splice path returns FALSE (caller must return at once)");
  assert.equal(b.m.regs.a, 0x00, "A = rrca(0x00) = 0 on the splice path");
  assert.equal((b.m.regs.sp - spBefore) & 0xffff, 4, "splice: inc sp/inc sp then ret pop (SP+4)");
  assert.equal(
    firstStateDiff(b.dumpBefore, b.m.dumpState(), (off) => b.m.stateOffsetToAddr(off)),
    null,
    "sub_0010 must not write RAM",
  );
  assert.equal(b.cycles, a.cycles, `splice cycle total drifted: opt ${b.cycles} vs oracle ${a.cycles}`);
  assert.equal(b.cycles, CYC_SPLICE, `splice branch expected ${CYC_SPLICE} t, got ${b.cycles}`);
  console.log(`  BRANCH/splice: EQUAL, ret=false, A=0, SP+4, no store; total ${b.cycles}t == oracle`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): the polarity twin (ret nc for ret c) is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, polarityBroken_0010]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong branch — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): the polarity twin is CAUGHT in the register file (SP), since sub_0010 writes no RAM", () => {
  // Natural entry is MARIO_ACTIVE=0 (bit0 CLEAR): oracle splices (SP+4); the polarity
  // twin takes the CARRY-CLEAR normal branch (SP+2), so SP diverges.
  const a = ENTRY.clone();
  const b = ENTRY.clone();
  translated_0010(a);
  polarityBroken_0010(b);

  // No RAM store on either side, so the RAM dump is identical -- the teeth are in registers.
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(ram, null, "sub_0010 writes no RAM: the divergence is register-only, not a store");
  const regs = firstRegDiff(a.regs, b.regs);
  assert.ok(regs != null, "harness FAILED to catch a wrong branch — it is worthless");
  assert.equal(regs.reg, "sp", `expected the wrong branch to diverge SP, got ${regs.reg}`);
  assert.notEqual(a.pc, b.pc, "the wrong branch also returns to a different PC");
  console.log(`  TEETH/unit: caught at register sp (oracle ${regs.a} vs broken ${regs.b}); pc also differs`);
});

test("TEETH (cycle): a mis-timed twin (same state, +4 t) is CAUGHT by the cycle-total check", () => {
  const good = runClone(translated_0010, 0x01);
  const bad = runClone(misTimed_0010, 0x01);

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
