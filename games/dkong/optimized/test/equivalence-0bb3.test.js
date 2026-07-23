// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0bb3 (the intro cutscene's TERMINAL step:
 * countdown-gated "wrap the 0x6385 sequence to 0 and advance GAME_SUBSTATE").
 * Reached via dispatchGameState (the NMI game-state path) as entry 7 of loc_0a76's
 * 0x0A7A rst-0x28 table, while GAME_SUBSTATE(0x600A)==7 and INTRO_STEP(0x6385)==7.
 *
 * Jobs:
 *   1. EQUAL (whole + unit) -- the idiomatic optimized loc_0bb3 reads EQUAL against
 *      its translated oracle in RAM and in the full register file (+ pc).
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *   3. FULL BRANCH COVERAGE + CYCLE TOTALS -- loc_0bb3 has three prologue arms
 *      (SUBSTATE_TIMER == 0x90 / == 0x18 / otherwise) and a countdown gate (expired
 *      / not). Only FOUR combinations are reachable (0x90 and 0x18 both decrement
 *      to non-zero, so they always take the early return; the epilogue is reached
 *      only through the "otherwise" arm at counter==1). Each is synthesised and
 *      proven EQUAL in RAM+regs+pc, and -- because every arm is CYCLE-COLLAPSED --
 *      its cycle TOTAL is pinned to the oracle's, with a wrong-total shim shown to
 *      be caught. The subtle CARRY finding (the `cp` carry survives sub_0018 to
 *      exit) gets its own teeth: a non-zero incoming carry must not leak.
 *   4. TEETH (whole + unit) -- a deliberately-wrong output store is CAUGHT, naming
 *      the diverging address (0x6919, loc_0bb3's own bookkeeping byte).
 *
 * WHY THIS TEST DRIVES INPUT (like equivalence-0a8a / 08f8 / 06fe). The intro
 * cutscene only runs once a credit is inserted and start is pressed -- loc_0bb3
 * NEVER dispatches in attract. So both gates feed the canonical coin+start tape via
 * a custom makeMachine factory and drive the game-agnostic CORE equivalence engine
 * (the DK harness.js wrapper bakes `inputs` but not the timed `inputTape`). With
 * this tape loc_0bb3 dispatches on 176 consecutive frames (689..864) as the counter
 * sweeps 0xB0 down to 1 -- naturally exercising ALL FOUR reachable arms: 0x90 at
 * frame 721, 0x18 at 841, the "otherwise" early return on the rest, and the expiry
 * epilogue at 864. FRAMES = 900 covers the epilogue plus downstream margin so a
 * wrong collapsed total would surface (README §2 spin-count), though the synthesised
 * branch tests pin every total directly.
 *
 * THE CYCLE FINDING this routine confirms: loc_0bb3 is ATOMIC and COLLAPSED. It
 * runs INSIDE the vblank NMI (dispatchGameState), which does not re-enter, so the
 * NMI never lands inside it or sub_0018 -- exactly loc_0a8a's property on the same
 * dispatch path. So each straight-line run collapses to one m.step total (prologue
 * 96/81/61t, epilogue 45t), the rst-0x18 charge and m.call(0x0018) scaffolding kept.
 * The total is still load-bearing (it feeds the spin count), so it is preserved and
 * proven both by whole-machine EQUAL and by the per-branch cycle assertions. There
 * are NO hardware (0x7Dxx) writes, so there is no write-bus-cycle trace to police.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0bb3 as translated_0bb3 } from "../../translated/state0.js";
import { loc_0bb3 as optimized_0bb3 } from "../loc_0bb3.js";
import { Machine } from "../../machine.js";
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

const TARGET = 0x0bb3;
const FRAMES = 900; // loc_0bb3 dispatches on frames 689..864 (176x); 900 covers + margin
const UNIT_MAXFRAMES = 720; // first entry is frame 689

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80)
// then IN2 start1 (0x04) so the ROM's own credit/start logic starts a game and the
// Kong-climb intro runs to its terminal step. A fresh copy per machine keeps runs
// independent.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 60, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 90, dur: 6 }, // start1
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

// loc_0bb3's own output store the teeth corrupt: 0x6919 (an unnamed frame-paced
// bookkeeping byte, inc'd on the 0x90 arm / dec'd on the 0x18 arm). It sits in the
// compared work-RAM dump and is NOT a dispatch selector, so a first-write flip
// diverges cleanly at the 0x90-arm frame (721) instead of crashing dispatch (which
// flipping the epilogue's 0x6385/0x600A control bytes would).
const BROKEN_ADDR = 0x6919;

/** A twin identical to optimized_0bb3 except its first store to `addr` is flipped. */
function makeBroken(addr, impl = optimized_0bb3) {
  return function broken(m) {
    const realWrite = m.mem.write8.bind(m.mem);
    let broke = false;
    m.mem.write8 = (a, v, bo) => {
      if (!broke && a === addr) {
        broke = true;
        return realWrite(a, v ^ 0xff, bo);
      }
      return realWrite(a, v, bo);
    };
    try {
      return impl(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}
const broken_0bb3 = makeBroken(BROKEN_ADDR);

// -- synthesised-entry helper (for the isolated branch / cycle / unit-teeth checks) --

/**
 * Build a fresh machine parked on loc_0bb3's entry with SUBSTATE_TIMER == `timer`
 * (mirrors games/dkong/test/boot.test.js): a fake caller's-caller return address
 * on the stack so sub_0018's skip idiom has something to pop, and the sequence/
 * selector bytes seeded. `flagSeed` optionally poisons F (e.g. incoming carry).
 */
function entryWith(timer, flagSeed) {
  const m = new Machine(ROM);
  m.regs.sp = 0x6c00;
  m.push16(0x4d5e); // caller's caller (the rst-skip target)
  if (flagSeed !== undefined) m.regs.f = flagSeed;
  m.mem.write8(0x6009, timer); // SUBSTATE_TIMER
  m.mem.write8(0x6385, 0x07); // INTRO_STEP (parked on the terminal step)
  m.mem.write8(0x600a, 0x03); // GAME_SUBSTATE (arbitrary, so its ++ is visible)
  m.mem.write8(0x6919, 0x40); // bookkeeping byte, so inc/dec is observable
  return m;
}

/** Run `fn` on a fresh entry-with-`timer` machine; return { m, cycles }. */
function runBranch(timer, fn, flagSeed) {
  const m = entryWith(timer, flagSeed);
  const c0 = m.cycles;
  fn(m);
  return { m, cycles: m.cycles - c0 };
}

// The four reachable arms and their exact collapsed cycle totals (loc_0bb3 proper +
// sub_0018's identical charges): prologue + rst(11) + sub_0018 [+ epilogue 45 + ret 10].
const BRANCHES = [
  { label: "otherwise + expired (timer==1)", timer: 0x01, total: 159 },
  { label: "otherwise + not-expired (timer==2)", timer: 0x02, total: 120 },
  { label: "0x90 arm (roar-audio prime, always early return)", timer: 0x90, total: 155 },
  { label: "0x18 arm (dec 0x6919, always early return)", timer: 0x18, total: 140 },
];

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0bb3 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0bb3]]));

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
      `override fired ${r.invocations.get(TARGET)}x (frames 689..864, all 4 arms)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0bb3 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_0bb3, optimized_0bb3, { maxFrames: UNIT_MAXFRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- FULL BRANCH COVERAGE + CYCLE TOTALS --------------------------------------

test("BRANCHES: all four reachable arms are EQUAL in RAM+regs+pc AND preserve the cycle total", () => {
  for (const { label, timer, total } of BRANCHES) {
    const a = runBranch(timer, translated_0bb3);
    const b = runBranch(timer, optimized_0bb3);

    const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
    const regs = firstRegDiff(a.m.regs, b.m.regs);
    assert.equal(ram, null, ram ? `${label}: RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
    assert.equal(regs, null, regs ? `${label}: reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
    assert.equal(a.m.pc, b.m.pc, `${label}: pc must match`);

    // Collapsed-branch cycle teeth: optimized total == oracle total == expected.
    assert.equal(b.cycles, a.cycles, `${label}: cycle total drifted (optimized ${b.cycles} vs oracle ${a.cycles})`);
    assert.equal(a.cycles, total, `${label}: oracle total ${a.cycles} != expected ${total}`);
    console.log(`  BRANCH ${label}: EQUAL, ${a.cycles}t`);
  }

  // ...and the cycle assertion is not vacuous: a 1-cycle error in any collapsed
  // charge (here the merge charge at 0x0bd1) makes the totals disagree.
  const wrong = runBranch(0x01, makeMistotaled());
  assert.notEqual(wrong.cycles, 159, "cycle-total assertion has no teeth");
  console.log(`  CYCLE-TEETH: a 1-cycle-short merge charge is caught (${wrong.cycles} != 159)`);
});

test("CARRY: the cp carry survives sub_0018 to exit — a non-zero incoming carry must not leak", () => {
  // sub_0018's only flag op is `dec (hl)`, which leaves CARRY untouched, so on every
  // early-return arm the exit carry is whatever the last `cp` set — NOT the incoming
  // carry. Seed F = 0xFF (carry set) and require the optimized F to match the oracle
  // on all arms (a value-compare rewrite that dropped `cp` diverged here: 0x03 vs 0x02).
  for (const { label, timer } of BRANCHES) {
    const a = runBranch(timer, translated_0bb3, 0xff);
    const b = runBranch(timer, optimized_0bb3, 0xff);
    assert.equal(b.m.regs.f, a.m.regs.f, `${label}: F leaked incoming carry (optimized 0x${b.m.regs.f.toString(16)} vs oracle 0x${a.m.regs.f.toString(16)})`);
  }
  console.log("  CARRY: F identical to the oracle on all arms with F seeded 0xFF");
});

/** optimized_0bb3 with the merge (0x0bd1) charge one cycle short — a wrong total. */
function makeMistotaled() {
  return function mistotaled(m) {
    const realStep = m.step.bind(m);
    m.step = (addr, cyc) => realStep(addr, addr === 0x0bd1 ? cyc - 1 : cyc);
    try {
      return optimized_0bb3(m);
    } finally {
      m.step = realStep;
    }
  };
}

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x6919 store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_0bb3]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong 0x6919 store is CAUGHT and names 0x6919 (synthesised 0x90 arm)", () => {
  // The natural first entry (frame 689) is the "otherwise" arm, which makes no
  // store of loc_0bb3's own — so the unit teeth are exercised on the SYNTHESISED
  // 0x90 arm, where loc_0bb3 writes 0x6919 (inc). Diff a broken twin vs the oracle.
  const a = entryWith(0x90);
  const b = entryWith(0x90);
  translated_0bb3(a);
  makeBroken(BROKEN_ADDR)(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.ok(ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${ram.addr.toString(16)} (oracle ${ram.a} vs broken ${ram.b})`);
});
