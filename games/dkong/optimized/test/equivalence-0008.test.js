// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0008 (the `rst 0x08` conditional caller-skip
 * helper). Unlike the dispatch-target handlers, sub_0008 is a LEAF reached only
 * via `m.call(0x0008)` -- the idiom `if (!m.call(0x0008)) return;` in four callers
 * (mainloop.js x3, state0.js x1). The harness installs its snapshot override at
 * CONSTRUCTION, so it reaches this m.call-only routine; no workaround is open-coded.
 *
 * sub_0008 writes NO work RAM: its entire contract is SP (+2 normal / +4 skip), PC
 * (caller / caller's-caller), A + F (rrca of ATTRACT), and the BOOLEAN it returns
 * for the caller-skip idiom. So the teeth here are on SP / the return / cycles, not
 * on a store -- there is no store to break.
 *
 * Seven jobs:
 *
 *   1. EQUAL (whole-machine) -- optimized sub_0008 reads EQUAL against its oracle
 *      every frame. The override must fire (or EQUAL is vacuous); it dispatches
 *      242x in 30 frames, exercising BOTH branches naturally (bit0-clear "normal"
 *      57x, bit0-set "skip" 185x).
 *
 *   2. EQUAL (unit) -- optimized == oracle in RAM + the full register file (incl.
 *      SP, A, F) + pc, at the first natural entry (the NORMAL branch, ATTRACT=0).
 *
 *   3. BRANCH normal (bit0=0) -- synthesised: oracle vs optimized EQUAL (RAM, regs,
 *      pc, return value) AND the per-instruction cycle total == the oracle's 28 t.
 *
 *   4. BRANCH skip (bit0=1) -- synthesised: the two `inc sp` + ret path. oracle vs
 *      optimized EQUAL (RAM, regs incl. SP+4, pc = caller's caller, return=false)
 *      AND the per-instruction cycle total == the oracle's 44 T-states.
 *
 *   5. CYCLE TEETH (whole-machine) -- a twin with the RIGHT SP/return but a WRONG
 *      total (charges 0) is CAUGHT at SPIN_COUNT 0x6019, proving the preserved
 *      per-instruction total is load-bearing, not a free parameter.
 *
 *   6. TEETH (whole-machine) -- a twin that ALWAYS skips (wrong SP + wrong skip
 *      decision, but stack-aligned so it does not crash) is CAUGHT: NOT-EQUAL.
 *
 *   7. TEETH (unit) -- the same always-skip twin is CAUGHT at the NORMAL first
 *      entry and names the diverging register, `sp` (0x6bfe vs 0x6c00).
 *
 * THE CYCLE DECISION this routine records: sub_0008 is kept PER-INSTRUCTION, NOT
 * collapsed. It is atomic on the NMI game-state path (mask-cleared), but it is a
 * leaf `rst` helper ALSO reached from the mask-ENABLED main loop -- entry_051c
 * (mainloop.js) `rst 0x08`s it as its enable guard -- so a vblank NMI CAN land
 * inside its ~4 instructions. A collapsed `m.ret(28/44)` would push the ret-target
 * PC where the oracle pushes 0x000b..0x000e, diverging in diffed stack RAM (the
 * same reason sub_0020 / loc_197a stay per-instruction; README §2's mid-logic NMI
 * caveat). A 30-frame attract run does NOT exercise that interruptible path, so it
 * could not prove a collapse safe. Preserving the oracle's per-instruction charge
 * distribution keeps the pushed PC identical on every path.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0008 as translated_0008 } from "../../translated/mainloop.js";
import { sub_0008 as optimized_0008 } from "../sub_0008.js";
import { Machine } from "../../machine.js";
import { ATTRACT } from "../ram.js";
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

const TARGET = 0x0008;
const FRAMES = 30; // sub_0008 fires 242x here; both branches covered (57 normal, 185 skip)

// -- pristine-entry capture (for the synthesised per-branch + cycle assertions) --

/**
 * Capture the machine at the instant sub_0008 is FIRST entered (an m.call from the
 * main loop, ATTRACT=0 so it is the NORMAL branch), via the same construction-time
 * snapshot the core unit gate uses. Each branch is then forced by poking bit 0 of
 * ATTRACT on a clone -- applied identically to the oracle and optimized clones.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0008(mm); // let the host run proceed to a clean stop
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(FRAMES);
  if (entry === null) throw new Error(`sub_0008 never dispatched within ${FRAMES} frames`);
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry with ATTRACT's bit 0 forced to `bit0`. */
function runOn(fn, bit0) {
  const c = ENTRY.clone();
  c.mem.write8(ATTRACT, (c.mem.read8(ATTRACT) & 0xfe) | bit0);
  const before = c.cycles;
  const ret = fn(c);
  return { m: c, ret, cyc: c.cycles - before };
}

/** Prove oracle == optimized on one branch: RAM + regs + pc + return + cycle total. */
function assertBranchEqual(bit0, expectedRet, expectedCyc, label) {
  const a = runOn(translated_0008, bit0); // oracle
  const b = runOn(optimized_0008, bit0); // optimized
  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (o) => a.m.stateOffsetToAddr(o));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${(ram.addr ?? 0).toString(16)}` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match");
  assert.equal(a.ret, expectedRet, `oracle return should be ${expectedRet}`);
  assert.equal(b.ret, expectedRet, `optimized return should be ${expectedRet}`);
  assert.equal(a.cyc, expectedCyc, `oracle ${label} total should be ${expectedCyc}, got ${a.cyc}`);
  assert.equal(b.cyc, expectedCyc, `per-instruction ${label} total ${b.cyc} != oracle ${expectedCyc}`);
  return { a, b };
}

// -- deliberately-broken twins ------------------------------------------------

/**
 * ALWAYS-SKIP twin: does the skip path (inc sp x2 + ret, return false) regardless
 * of bit 0 -- a WRONG SP (+4 where the oracle returns +2) and a WRONG skip decision,
 * but stack-aligned so it pops a valid return and does not crash. The representative
 * "wrong SP / wrong caller-skip" bug the SP-contract gate must catch.
 */
function alwaysSkip_0008(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(ATTRACT);
  regs.rrca();
  regs.sp = (regs.sp + 2) & 0xffff;
  m.ret(44);
  return false;
}

/**
 * WRONG-CYCLES twin: correct SP + return, but each branch charges 0 T-states
 * instead of its 28/44 total. A frame that reaches the vblank spin sooner spins one
 * extra time and reseeds the PRNG, so this must diverge at SPIN_COUNT (0x6019).
 */
function wrongCycles_0008(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(ATTRACT);
  regs.rrca();
  if (regs.fNC) { m.ret(0); return true; }
  regs.sp = (regs.sp + 2) & 0xffff;
  m.ret(0);
  return false;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0008 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_0008]]));

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
      `override fired ${r.invocations.get(TARGET)}x (both branches)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0008 matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0008, optimized_0008);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. SP, A, F) + pc identical (normal branch)");
});

// -- FULL BRANCH COVERAGE (EQUAL + return + per-instruction cycle total) ------

test("BRANCH normal (bit0=0): EQUAL + return true + per-instruction total == oracle 28t", () => {
  const { b } = assertBranchEqual(0, true, 28, "normal");
  console.log(`  BRANCH/normal: SP +2, return true, ${b.cyc}t (== oracle) — RAM+regs+pc identical`);
});

test("BRANCH skip (bit0=1): EQUAL + return false + per-instruction total == oracle 44t", () => {
  const { b } = assertBranchEqual(1, false, 44, "skip");
  console.log(`  BRANCH/skip: SP +4 (inc sp x2 + ret), return false, ${b.cyc}t (== oracle) — RAM+regs+pc identical`);
});

// -- CYCLE TEETH --------------------------------------------------------------

test("CYCLE TEETH (whole-machine): a WRONG cycle total is CAUGHT at SPIN_COUNT 0x6019", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, wrongCycles_0008]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "cycle-teeth override must have dispatched");
  assert.equal(r.equal, false, "a wrong total was NOT caught — the preserved total would be a free parameter");
  assert.equal(r.addr, 0x6019, `expected divergence at SPIN_COUNT 0x6019, got 0x${(r.addr ?? 0).toString(16)}`);
  console.log(
    `  CYCLE TEETH: wrong total caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs stripped ${r.optimized})`,
  );
});

// -- TEETH (SP / caller-skip contract) ----------------------------------------

test("TEETH (whole-machine): a wrong caller-skip (always-skip) is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, alwaysSkip_0008]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong SP/skip — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs broken ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong caller-skip is CAUGHT at the normal entry and names 'sp'", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_0008, alwaysSkip_0008);

  assert.equal(r.equal, false, "harness FAILED to catch a wrong SP — it is worthless");
  assert.ok(r.regs != null, "a caught divergence must name a register");
  assert.equal(
    r.regs.reg,
    "sp",
    `expected the SP contract to be the first diff, got ${r.regs.reg}`,
  );
  console.log(
    `  TEETH/unit: caught at register ${r.regs.reg} ` +
      `(oracle 0x${r.regs.a.toString(16)} vs broken 0x${r.regs.b.toString(16)})`,
  );
});
