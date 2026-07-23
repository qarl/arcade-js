// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0315 (the blinking player-up "1UP"/"2UP"
 * indicator, redrawn every 16th frame from the main loop). It is NOT a dispatch
 * target: mainLoop reaches it directly via `m.call(0x0315)` once per pass, so the
 * override is wired at CONSTRUCTION (both the whole-machine gate and the core unit
 * gate install it that way) and fires ~140x/frame.
 *
 * Six jobs (the four core gates + two branch-coverage sweeps):
 *
 *   1. EQUAL -- the idiomatic optimized sub_0315 reads EQUAL against its translated
 *      oracle, whole-machine (two drivers, see below) and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_0315 is
 *      m.call'd every main-loop pass from boot, so it fires thousands of times even
 *      in a short attract window.
 *
 *   3. TEETH -- a deliberately-broken twin (the first store to the P1 indicator cell
 *      0x7740 lands the wrong value) must be CAUGHT: NOT-EQUAL, naming 0x7740.
 *
 *   4. BRANCH COVERAGE -- sub_0315 has four data-dependent branches -> five arms:
 *        A  ret nz            (frame low-nibble != 0)                  -- attract + game
 *        B  rst-skip          (16th frame, ATTRACT bit0 set: sub_0008 -> false)
 *        C  bit4 clear        (blink phase 0: lit glyphs, loc_033e tail)
 *        D  bit4 set, 1-player (blank glyphs, `ret z` on TWO_PLAYER_GAME==0)
 *        E  bit4 set, 2-player (also repaints the OTHER player's column)
 *      Reached NATURALLY (proven by the whole-machine gates): A, B (plain boot's
 *      extended attract), C and D (a coin+start credits a game at ~f13, so both
 *      blink phases run over f4..f130). E needs a 2-player game and is NOT reached,
 *      so it is SYNTHESISED. For belt-and-suspenders teeth every arm A-E is
 *      synthesised from a captured entry and diffed (RAM+regs+pc AND cycle total --
 *      this routine is kept PER-INSTRUCTION, so a wrong charge on an arm no frame
 *      reaches would otherwise have no teeth).
 *
 * WHY PER-INSTRUCTION (no cycle collapse). The vblank NMI lands INSIDE this routine
 * on real gameplay -- 0x0315/0x0318/0x0319/0x031B are among the most-hit NMI-landing
 * addresses (doc 06). It runs from the main loop with the NMI mask ENABLED, so a
 * frame boundary routinely falls mid-routine; collapsing the m.step charges would
 * move where the NMI lands and change the PC it pushes into diffed stack RAM (the
 * loc_197a / entry_0611 mechanism). So the charges stay byte-identical to the oracle.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Same reason as
 * loc_197a: to attach a coin+start inputTape identically to both sides. The factory
 * is shared, so any input is applied identically to baseline and optimized.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0315 as translated_0315 } from "../../translated/mainloop.js";
import { sub_0315 as optimized_0315 } from "../sub_0315.js";
import { Machine } from "../../machine.js";
import {
  unitEquivalence,
  wholeMachineEquivalence,
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

const TARGET = 0x0315;

// Plain-boot attract exercises arms A (ret nz) + B (rst-skip); the one credited
// window at frames 4-5 also hits C once. 60 frames is ample.
const PLAIN_FRAMES = 60;

// A coin+start tape (identical to loc_197a's): coin on IN2 bit7 @ f10, start1 on
// IN2 bit2 @ f30. ATTRACT (0x6007) goes 0 again at ~f13, so sub_0315's body runs
// through the intro -- blink phase 0 (arm C: f4,f36,f68,f100) AND phase 1 (arm D:
// f20,f52,f84,f116) both occur within ~130 frames, long before gameplay proper.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];
const COIN_FRAMES = 130;

// The P1 indicator's top cell, written by every body run (arm C: value player+1;
// arm D/E: value 0x10). Inside the compared video-RAM dump (0x7400-0x77FF), and
// sub_0315 is its only writer during a credited game, so a corruption persists.
const BROKEN_ADDR = 0x7740;

// makeMachine factory the core engine drives, with an optional coin+start tape
// attached identically to whichever side (baseline / optimized) the engine builds.
function makeFactory(tape) {
  return (overrides) => {
    const m = new Machine(ROM, overrides ? { overrides } : {});
    if (tape) m.inputTape = tape.map((t) => ({ ...t }));
    return m;
  };
}
const plainBoot = makeFactory(null);
const coinStart = makeFactory(COIN_START_TAPE);

/**
 * Deliberately-broken twin: behaviourally optimized_0315 EXCEPT the first store to
 * 0x7740 lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly that
 * one write lets the rest of the routine and its callees run verbatim -- the
 * representative "wrong value to one of the routine's own output cells" bug.
 */
function broken_0315(m) {
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
    return optimized_0315(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine, plain boot): optimized sub_0315 matches translated every frame", () => {
  const r = wholeMachineEquivalence(plainBoot, PLAIN_FRAMES, new Map([[TARGET, optimized_0315]]));

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
  assert.equal(r.framesCompared, PLAIN_FRAMES);
  console.log(
    `  EQUAL/whole (plain): ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (arms A ret-nz + B rst-skip + one C)`,
  );
});

test("EQUAL (whole-machine, coin+start): optimized sub_0315 matches translated every frame", () => {
  const r = wholeMachineEquivalence(coinStart, COIN_FRAMES, new Map([[TARGET, optimized_0315]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "override never dispatched");
  assert.equal(
    r.equal,
    true,
    r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
  assert.equal(r.framesCompared, COIN_FRAMES);
  console.log(
    `  EQUAL/whole (coin+start): ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (adds arm C blink-phase-0 + arm D blink-phase-1)`,
  );
});

test("EQUAL (unit): optimized sub_0315 matches translated in RAM + registers", () => {
  const r = unitEquivalence(plainBoot, TARGET, translated_0315, optimized_0315, { maxFrames: 20 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (first entry, ~frame 4)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong indicator store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(coinStart, COIN_FRAMES, new Map([[TARGET, broken_0315]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

// Capture the pristine entry state of the FIRST body-writing dispatch -- a frame
// where the routine actually stores to VRAM (16th frame AND a game credited, so
// the rst-0x08 gate does not skip). Under plain boot that is frame 4 (arm C).
function captureBodyEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null &&
        (mm.mem.read8(0x601a) & 0x0f) === 0 &&
        (mm.mem.read8(0x6007) & 0x01) === 0) {
      entry = mm.clone(); // this dispatch will run the body and store to VRAM
    }
    return translated_0315(mm);
  }]]);
  const host = plainBoot(snap);
  host.runFrames(20);
  if (entry === null) throw new Error("sub_0315 never reached a body-writing dispatch");
  return entry;
}

test("TEETH (unit): a wrong indicator store is CAUGHT and names 0x7740", () => {
  const entry = captureBodyEntry();
  const a = entry.clone(); // translated
  const b = entry.clone(); // broken-optimized

  translated_0315(a);
  broken_0315(b);

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.ok(ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${ram.addr.toString(16)} (translated ${ram.a} vs broken ${ram.b})`);
});

// -- BRANCH COVERAGE ----------------------------------------------------------

// Capture any pristine sub_0315 entry to use as a clone base for synthesis. The
// entry's registers are all overwritten by the routine (A is reloaded from FRAME
// first), so only its RAM + SP matter -- and we set the deciding RAM per arm.
function captureAnyEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0315(mm);
  }]]);
  const host = plainBoot(snap);
  host.runFrames(20);
  if (entry === null) throw new Error("sub_0315 never entered");
  return entry;
}

// Run oracle vs optimized on two clones of `entry` after applying `mutate` to both,
// and diff RAM + regs + pc + cycle total.
function diffArm(entry, mutate) {
  const a = entry.clone();
  const b = entry.clone();
  mutate(a);
  mutate(b);
  const cA0 = a.cycles, cB0 = b.cycles;
  translated_0315(a);
  optimized_0315(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return { ram, regs, pcEq: a.pc === b.pc, dA: a.cycles - cA0, dB: b.cycles - cB0 };
}

const ARMS = [
  // name, mutate(m), sanity(a) -- a check that the intended arm really ran
  ["A ret-nz", (m) => { m.mem.write8(0x601a, 0x07); }, null],
  ["B rst-skip", (m) => { m.mem.write8(0x601a, 0x00); m.mem.write8(0x6007, 0x01); }, null],
  ["C bit4-clear (phase 0)", (m) => {
    m.mem.write8(0x601a, 0x00); m.mem.write8(0x6007, 0x00);
    m.mem.write8(0x600d, 0x00); m.mem.write8(0x600f, 0x00);
  }, (a) => assert.equal(a.mem.read8(0x7740), 0x01, "arm C must write the lit '1' glyph to 0x7740")],
  ["D bit4-set 1P (phase 1)", (m) => {
    m.mem.write8(0x601a, 0xf0); m.mem.write8(0x6007, 0x00);
    m.mem.write8(0x600d, 0x00); m.mem.write8(0x600f, 0x00);
  }, (a) => assert.equal(a.mem.read8(0x7740), 0x10, "arm D must write the blank glyph 0x10 to 0x7740")],
  ["E bit4-set 2P (both columns)", (m) => {
    m.mem.write8(0x601a, 0xf0); m.mem.write8(0x6007, 0x00);
    m.mem.write8(0x600d, 0x00); m.mem.write8(0x600f, 0x01);
  }, (a) => {
    assert.equal(a.mem.read8(0x7740), 0x10, "arm E must blank the P1 column at 0x7740");
    assert.equal(a.mem.read8(0x74e0), 0x02, "arm E must draw the '2' digit in the P2 column at 0x74E0");
  }],
];

test("BRANCH COVERAGE: all five arms A-E are EQUAL (RAM+regs+pc+cycles), incl. the un-reached 2P arm", () => {
  const entry = captureAnyEntry();
  for (const [name, mutate, sanity] of ARMS) {
    const r = diffArm(entry, mutate);
    assert.equal(r.ram, null, r.ram ? `${name}: RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
    assert.equal(r.regs, null, r.regs ? `${name}: reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
    assert.ok(r.pcEq, `${name}: pc mismatch`);
    assert.equal(r.dA, r.dB, `${name}: cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
    if (sanity) {
      // Re-run the oracle once to assert the intended arm actually executed.
      const a = entry.clone();
      mutate(a);
      translated_0315(a);
      sanity(a);
    }
  }
  console.log("  BRANCH COVERAGE: A ret-nz / B rst-skip / C phase-0 / D phase-1-1P / E phase-1-2P all EQUAL (RAM+regs+pc+cycles)");
});
