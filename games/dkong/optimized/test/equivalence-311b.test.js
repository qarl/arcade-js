// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for guard_311b (ROM 0x311b) -- one of the four
 * 0x3110 GUARD FAMILY members, a SKIP-CAPABLE rst-0x28 dispatch target on the
 * NMI / sub_30fa path. It masks FRAME (0x601A) to its low 3 bits and returns
 * NORMALLY when that is < 5 (five frames in eight), else performs the CALLER-SKIP
 * idiom (inc sp / inc sp / ret) so control lands in the caller's CALLER. Modelled
 * as a boolean return: true = normal return, false = caller (entry_30ed) skipped.
 *
 * WHY THIS ROUTINE IS EXERCISED LIVE WHOLE-MACHINE (a poke, not just synthesis).
 * guard_311b IS reachable from boot. Its live reach is real and translated: the
 * attract-demo / gameplay cascade loc_197a (dispatched in the vblank NMI as game-
 * state 3's 0x0702-table handler) calls entry_30ed, which calls sub_30fa, which
 * reads DIFFICULTY (0x6380), clamps it to [0,5], and rst-0x28 dispatches the guard-
 * family table [3110,3110,311b,3126,3126,3131] -- selecting guard_311b at
 * DIFFICULTY == 2 (index 2). In pure attract DIFFICULTY is 1 (-> guard_3110), so an
 * IDENTICAL-BOTH-SIDES poke holds 0x6380 = 2 across the attract-demo window (Karl's
 * sanctioned "poke the board state to reach a state for validation"), which
 * dispatches guard_311b live 56x from frame ~586 -- and BOTH branches fire
 * naturally under it (35 normal-return + 21 caller-skip, as FRAME cycles 0..7). The
 * poke is threaded via a custom makeMachine factory (m.pokes) driving the game-
 * agnostic CORE equivalence engine (like equivalence-3126 / 16a3); the DK harness.js
 * wrapper bakes assets but not the timed pokes. Applied identically to baseline and
 * optimized, so the only difference the gate sees is translated vs optimized.
 *
 * Because it runs live whole-machine, the collapsed cycle totals get REAL whole-
 * machine teeth: a wrong total shifts the NMI's cost and the divergence surfaces
 * downstream at SPIN_COUNT (0x6019) -- demonstrated by the polarity TEETH below,
 * caught there. The per-branch totals are ALSO pinned in isolation (synth tests).
 *
 * The routine writes NO RAM and NO hardware register (no 0x7Dxx latch), so there
 * is no store to corrupt and no bus-cycle write-trace to pin -- the observable
 * outputs are the boolean, SP, PC and F, and the teeth target those (plus the
 * downstream state the caller-skip decision drives).
 *
 * THE CYCLE FINDING. guard_311b is ATOMIC by construction -- a pure LEAF (no
 * m.call, so nothing interruptible downstream) whose only live entry is on the NMI
 * path where the vblank NMI is masked. No NMI can land inside it, so its internal
 * cycle distribution is unobservable and each branch's per-instruction charges
 * collapse to one total: normal-return 38 t, caller-skip 54 t. Whole-machine EQUAL
 * (poke-driven) confirms the collapse is safe; the synthesised branch tests pin
 * each total to the oracle's and show a 1-cycle error is caught.
 *
 * Jobs: EQUAL (whole poke-driven, override fires 56x + unit synthesised +
 * exhaustive), DISPATCH (override fires through the live dispatcher), TEETH (whole
 * polarity, wrong SP, wrong polarity, wrong override, wrong cycle total -- each
 * CAUGHT).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { guard_311b as translated_311b } from "../../translated/state0.js";
import { guard_311b as optimized_311b } from "../guard_311b.js";
import { dispatchGameState } from "../../translated/nmi.js";
import { Machine } from "../../machine.js";
import { FRAME, DIFFICULTY } from "../ram.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
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

const TARGET = 0x311b;
const FRAMES = 640; // guard_311b dispatches ~frame 586..619 under the poke; run past it so a wrong total surfaces at SPIN_COUNT

// The predicate straight from the ROM bytes: normal-return (true) when the low 3
// bits of FRAME (0x601A) are < 5; caller-skip (false) when they are 5, 6 or 7.
const wantNormal = (v) => (v & 0x07) < 0x05;
// Per-branch cycle totals (README §2 collapse): normal 13+7+7+11, skip
// 13+7+7+5+6+6+10. The oracle is per-instruction; the optimized charges the
// total once -- both must land on the same number.
const NORMAL_CYCLES = 38;
const SKIP_CYCLES = 54;

// DIFFICULTY (0x6380). sub_30fa clamps it to [0,5] and dispatches the guard table
// [3110,3110,311b,3126,3126,3131]; value 2 -> index 2 -> guard_311b. Held across
// the attract-demo window so guard_311b dispatches live every frame the cascade runs.
const FORCE_311B_POKE = [{ addr: DIFFICULTY, val: 0x02, frame: 580, dur: 45 }];

// The engine's factory: a DK Machine on this ROM with the force poke loaded. Called
// with no argument for the baseline and with the wrapped override map for the
// optimized side; both get the SAME poke, so any state forcing is applied identically.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_311B_POKE.map((p) => ({ ...p }));
  return m;
};

/**
 * Synthesise the entry the family is reached in (matching equivalence-3126/3131):
 * SP = 0x6C00 with two return frames beneath it -- the caller's CALLER first
 * (0xCAFE), then the caller's own return (0xBEEF) -- and FRAME poked to v. A normal
 * return pops 0xBEEF (caller); the caller-skip discards it and pops 0xCAFE (caller's
 * caller). Fresh machine, so `cycles` starts at 0 and after the routine equals the
 * branch total.
 */
function entry(v) {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0xcafe); // caller's caller
  m.push16(0xbeef); // caller's own return
  m.mem.write8(FRAME, v);
  return m;
}

/**
 * Run `fnA` (oracle) and `fnB` (under test) on two identical synthesised entries
 * and diff RAM + registers + PC + cycle total + the boolean return.
 */
function synthDiff(v, fnA, fnB) {
  const a = entry(v);
  const b = entry(v);
  const retA = fnA(a);
  const retB = fnB(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
    retA,
    retB,
    spA: a.regs.sp,
    spB: b.regs.sp,
    cyclesA: a.cycles,
    cyclesB: b.cycles,
  };
}

// -- deliberately-broken twins (this routine writes no RAM; corrupt an output) --

/** Skip path performs ONE inc sp instead of two: SP ends one short and the ret
 *  pops the wrong return -- the "wrong outgoing SP/return" bug the gate must catch. */
function broken_sp(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(FRAME);
  regs.and(0x07);
  regs.cp(0x05);
  if (regs.fM) {
    m.ret(38);
    return true;
  }
  regs.sp = (regs.sp + 1) & 0xffff; // BUG: one inc sp, not two
  m.ret(54);
  return false;
}

/** The documented POLARITY TRAP: compares against 0x04 instead of 0x05 -- flips
 *  the boolean, PC and F for the input FRAME&7 == 4 (normal -> caller-skip). */
function broken_polarity(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(FRAME);
  regs.and(0x07);
  regs.cp(0x04); // BUG: wrong compare, one below 0x05
  if (regs.fM) {
    m.ret(38);
    return true;
  }
  regs.sp = (regs.sp + 2) & 0xffff;
  m.ret(54);
  return false;
}

/** A 1-cycle-wrong collapsed total on the normal branch (37 not 38): behaviourally
 *  identical but the total drifts -- the teeth for the collapsed cycle assertion. */
function broken_cycles(m) {
  const { regs, mem } = m;
  regs.a = mem.read8(FRAME);
  regs.and(0x07);
  regs.cp(0x05);
  if (regs.fM) {
    m.ret(37); // BUG: 37 not 38
    return true;
  }
  regs.sp = (regs.sp + 2) & 0xffff;
  m.ret(54);
  return false;
}

// -- EQUAL (whole-machine, poke-driven: the override actually fires) -----------

test("EQUAL (whole-machine): idiomatic optimized guard_311b matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_311b]]));

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
      `override fired ${r.invocations.get(TARGET)}x (both branches exercised under the DIFFICULTY=2 poke)`,
  );
});

// -- DISPATCH (the override actually fires through the live dispatcher) --------

test("DISPATCH: the override fires through the live rst-0x28 dispatcher and returns the oracle's value", () => {
  let fired = 0;
  const wrapped = (mm) => {
    fired += 1;
    return optimized_311b(mm);
  };
  // Wire the override at construction, exactly as the manifest path does, then
  // reach it the way the ROM does: dispatchGameState(m, 0x311b). Its override
  // consult (nmi.js) must route to our optimized routine.
  const m = new Machine(ROM, { overrides: new Map([[TARGET, wrapped]]) });
  m.regs.sp = 0x6c00;
  m.push16(0xcafe);
  m.push16(0xbeef);
  m.mem.write8(FRAME, 0x02); // normal-return input (2 < 5)
  assert.ok(m.overrides.has(TARGET), "override must be registered on the machine");

  const result = dispatchGameState(m, TARGET);

  assert.ok(fired >= 1, `override at 0x${TARGET.toString(16)} never dispatched (fired=${fired})`);
  // And it returned the oracle's boolean for the same input.
  const oracle = translated_311b(entry(0x02));
  assert.equal(result, oracle, "override result must equal the oracle's for the same input");
  console.log(`  DISPATCH: override fired ${fired}x via live dispatchGameState, returned ${result}`);
});

// -- EQUAL (unit, synthesised per-branch) -------------------------------------

test("EQUAL (unit, synthesised): normal-return branch (0x601A=2, (v&7)<5) matches in RAM + regs + PC + cycles", () => {
  const d = synthDiff(0x02, translated_311b, optimized_311b);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)}` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg}` : "");
  assert.equal(d.pc, null, "pc must match");
  assert.equal(d.retA, true, "oracle returns true (normal return)");
  assert.equal(d.retB, true, "optimized returns true (normal return)");
  assert.equal(d.spA, 0x6bfe, "normal return pops the caller's own return -> SP = 0x6BFE");
  assert.equal(d.spB, d.spA, "SP must match");
  assert.equal(d.cyclesA, NORMAL_CYCLES, "oracle normal-branch total");
  assert.equal(d.cyclesB, NORMAL_CYCLES, "optimized normal-branch total (collapse preserves it)");
  console.log(`  EQUAL/unit normal: RAM+regs+PC identical, ret=true, SP=0x${d.spA.toString(16)}, cycles=${d.cyclesB}`);
});

test("EQUAL (unit, synthesised): caller-skip branch (0x601A=5, (v&7)>=5) matches in RAM + regs + PC + cycles", () => {
  const d = synthDiff(0x05, translated_311b, optimized_311b);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)}` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg}` : "");
  assert.equal(d.pc, null, "pc must match");
  assert.equal(d.retA, false, "oracle returns false (caller skipped)");
  assert.equal(d.retB, false, "optimized returns false (caller skipped)");
  assert.equal(d.spA, 0x6c00, "skip discards its own return -> SP back to 0x6C00");
  assert.equal(d.spB, d.spA, "SP must match");
  assert.equal(d.cyclesA, SKIP_CYCLES, "oracle skip-branch total");
  assert.equal(d.cyclesB, SKIP_CYCLES, "optimized skip-branch total (collapse preserves it)");
  console.log(`  EQUAL/unit skip: RAM+regs+PC identical, ret=false, SP=0x${d.spA.toString(16)}, cycles=${d.cyclesB}`);
});

// -- FULL BRANCH COVERAGE (exhaustive over the deciding byte) ------------------

test("EQUAL (exhaustive): every 0x601A in 0x00..0x0F matches oracle in RAM + regs + PC + boolean + SP + cycle total", () => {
  let normalSeen = 0;
  let skipSeen = 0;
  for (let v = 0; v <= 0x0f; v++) {
    const d = synthDiff(v, translated_311b, optimized_311b);
    const want = wantNormal(v);
    assert.equal(d.ram, null, `v=0x${v.toString(16)}: RAM diff${d.ram ? ` at 0x${d.ram.addr.toString(16)}` : ""}`);
    assert.equal(d.regs, null, `v=0x${v.toString(16)}: reg diff${d.regs ? ` at ${d.regs.reg}` : ""}`);
    assert.equal(d.pc, null, `v=0x${v.toString(16)}: pc must match`);
    assert.equal(d.retA, want, `v=0x${v.toString(16)}: oracle boolean`);
    assert.equal(d.retB, want, `v=0x${v.toString(16)}: optimized boolean must equal predicate`);
    assert.equal(d.spB, d.spA, `v=0x${v.toString(16)}: SP must match`);
    assert.equal(d.spA, want ? 0x6bfe : 0x6c00, `v=0x${v.toString(16)}: SP proves ${want ? "normal return" : "the caller was SKIPPED"}`);
    // Cycle-total teeth on the collapsed branches (both sides).
    const wantCycles = want ? NORMAL_CYCLES : SKIP_CYCLES;
    assert.equal(d.cyclesA, wantCycles, `v=0x${v.toString(16)}: oracle cycle total`);
    assert.equal(d.cyclesB, wantCycles, `v=0x${v.toString(16)}: optimized cycle total (collapse)`);
    if (want) normalSeen++;
    else skipSeen++;
  }
  // Prove both branches were actually exercised (not a vacuous all-one-way loop).
  assert.ok(normalSeen > 0 && skipSeen > 0, `both branches must be covered (normal=${normalSeen}, skip=${skipSeen})`);
  console.log(`  EQUAL/exhaustive: 16 inputs identical — ${normalSeen} normal, ${skipSeen} skip, both branches + cycle totals proven`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong polarity (cp 0x04) is CAUGHT live and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_polarity]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong polarity — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized}) — wrong caller-skip decision drifts downstream`,
  );
});

test("TEETH (unit): a wrong outgoing SP on the skip branch is CAUGHT and names SP", () => {
  const d = synthDiff(0x05, translated_311b, broken_sp);
  assert.ok(d.regs != null || d.pc != null, "harness FAILED to catch a wrong SP — it is worthless");
  assert.equal(d.regs && d.regs.reg, "sp", `expected the SP register to diverge, got ${d.regs ? d.regs.reg : "no reg diff"}`);
  assert.ok(d.pc != null, "the wrong SP also pops the wrong return -> PC must diverge");
  console.log(`  TEETH/unit SP: caught at reg ${d.regs.reg} (oracle 0x${d.regs.a.toString(16)} vs broken 0x${d.regs.b.toString(16)}), pc 0x${d.pc.a.toString(16)} vs 0x${d.pc.b.toString(16)}`);
});

test("TEETH (unit): the polarity trap (cp 0x04 instead of 0x05) is CAUGHT — flips boolean + flags", () => {
  const d = synthDiff(0x04, translated_311b, broken_polarity);
  assert.notEqual(d.retA, d.retB, "polarity change must flip the boolean at 0x601A=4");
  assert.ok(d.regs != null, "a wrong compare must diverge the register file (F at least)");
  assert.ok(d.pc != null, "the flipped predicate takes the other branch -> PC diverges");
  console.log(`  TEETH/unit polarity: boolean ${d.retA}->${d.retB}, reg ${d.regs.reg} 0x${d.regs.a.toString(16)}->0x${d.regs.b.toString(16)}, pc 0x${d.pc.a.toString(16)}->0x${d.pc.b.toString(16)}`);
});

test("TEETH (unit): a 1-cycle-wrong collapsed total (37 not 38) is CAUGHT — the cycle assertion has teeth", () => {
  const d = synthDiff(0x02, translated_311b, broken_cycles);
  // Behaviour is identical (RAM/regs/pc match); only the collapsed total drifts.
  assert.equal(d.ram, null, "the cycle bug changes no RAM/regs — only the total");
  assert.equal(d.regs, null, "the cycle bug changes no register");
  assert.notEqual(d.cyclesB, d.cyclesA, "a wrong collapsed total must diverge from the oracle's");
  assert.equal(d.cyclesA, NORMAL_CYCLES, "oracle stays 38");
  console.log(`  TEETH/unit cycles: oracle ${d.cyclesA}t vs broken ${d.cyclesB}t — CAUGHT (collapse assertion is not vacuous)`);
});

test("TEETH (dispatch): a wrong override through the live dispatcher returns the wrong boolean and is CAUGHT", () => {
  let fired = 0;
  const wrapped = (mm) => {
    fired += 1;
    return broken_polarity(mm);
  };
  const m = new Machine(ROM, { overrides: new Map([[TARGET, wrapped]]) });
  m.regs.sp = 0x6c00;
  m.push16(0xcafe);
  m.push16(0xbeef);
  m.mem.write8(FRAME, 0x04);

  const result = dispatchGameState(m, TARGET);
  const oracle = translated_311b(entry(0x04));

  assert.ok(fired >= 1, "broken override must have dispatched");
  assert.notEqual(result, oracle, "harness FAILED to catch a wrong override through the live dispatcher");
  console.log(`  TEETH/dispatch: broken override fired ${fired}x, returned ${result} vs oracle ${oracle} — CAUGHT`);
});
