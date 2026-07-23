// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_196b (THE 0x0702 phase-table arm at index 23
 * / ROM 0x196B: a computed phase transition -- `call 0x0852` to wipe the tile
 * field, then `ld a,(0x600e) / add a,0x12 / ld (0x600a),a` to jump the master
 * sub-state byte GAME_SUBSTATE into the next phase group). It is dispatched from
 * the NMI game-state path (ROM 0x06FE `ld a,(0x600a) / rst 0x28` through the
 * 0x0702 table) while GAME_SUBSTATE == 0x17.
 *
 * Jobs, mirroring loc_197a / entry_0611:
 *
 *   1. EQUAL -- the idiomatic optimized loc_196b (optimized/loc_196b.js) reads
 *      EQUAL against its translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous.
 *      loc_196b is a RARE phase transition: it does NOT dispatch in plain boot
 *      (0 over 400 frames) NOR in an ordinary coin+start game (0 over 1300),
 *      because reaching GAME_SUBSTATE==0x17 naturally needs a specific in-game
 *      board-phase transition. So it is DRIVEN: a coin+start inputTape credits a
 *      game (state 3 reached ~f1033), and an identical-both-sides POKE forces
 *      GAME_SUBSTATE (0x600A) = 0x17 across a small gameplay window (frames
 *      1040..1059). With 0x600A held at 0x17 the NMI's 0x06FE dispatch routes to
 *      loc_196b every frame; it fires 20x (frames ~1041..1060), all EQUAL. The
 *      poke is attached by the SHARED makeMachine factory, so it lands
 *      identically on the baseline and optimized sides.
 *
 *   3. TEETH -- a deliberately-broken twin (the first store on loc_196b's path,
 *      sub_0852's VRAM fill to 0x7400, lands the wrong value) must be CAUGHT:
 *      NOT-EQUAL, naming 0x7400 (whole-machine and unit). NB the routine's OWN
 *      output store (to 0x600A) is masked by the forcing poke every frame, so it
 *      would be an invalid teeth target; the un-masked 0x7400 fill on the path is
 *      used instead (the loc_196b analog of loc_197a's 0x75C4).
 *
 *   4. BRANCH + CYCLE COVERAGE. loc_196b is STRAIGHT-LINE -- one execution path,
 *      no data-dependent branch (the only variation is the DATA value of 0x600E
 *      feeding the add, not control flow). That single path is proven EQUAL 20x
 *      by the whole-machine gate and once by the unit gate. Because the optimized
 *      routine COLLAPSES the tail's per-instruction cycles into one m.ret(43)
 *      (safe: loc_196b runs under the NMI-handler's cleared mask, so it is
 *      un-interruptible and its cycle DISTRIBUTION is free -- only the TOTAL
 *      matters, README §2), a synthesised-entry test additionally measures the
 *      CYCLE TOTAL on both clones and asserts it equals the oracle's -- pinning
 *      the collapsed total directly rather than relying on downstream drift.
 *      (For the record: a wrong total IS also caught downstream -- charging 42
 *      instead of 43 diverges the whole-machine trace at stack 0x6BFE, frame
 *      1041, the same NMI-landing mechanism entry_0611 documents.)
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Same reason
 * as loc_197a: harness.js bakes a makeMachine on `{}` assets that drives NO input
 * and no poke, so it never credits a game and never reaches GAME_SUBSTATE==0x17.
 * This test calls the SAME core unitEquivalence / wholeMachineEquivalence
 * directly, with a makeMachine factory that attaches an identical coin+start
 * inputTape AND the forcing poke to BOTH sides (shared factory => applied
 * identically to baseline and optimized).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_196b as translated_196b } from "../../translated/state0.js";
import { loc_196b as optimized_196b } from "../loc_196b.js";
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

const TARGET = 0x196b;
const FRAMES = 1075; // loc_196b fires ~f1041..f1060 (20x) under the forcing poke
const MAX_FRAMES = 1060; // first dispatch is frame 1041

// Coin+start tape (identical to loc_197a's): coin on IN2 bit7 at frame 10,
// start1 on IN2 bit2 at frame 30 -- credits and starts a game (state 3 ~f1033).
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The forcing poke: hold GAME_SUBSTATE (0x600A) = 0x17 across frames 1040..1059
// (dur 20). Applied at each frame boundary BEFORE the NMI's 0x06FE dispatch, so
// the dispatch reads 0x17 and routes to loc_196b. Both sides get it (shared
// factory), so the whole-machine comparison stays valid.
const FORCE_POKE = [{ addr: 0x600a, val: 0x17, frame: 1040, dur: 20 }];

// The makeMachine factory the core engine drives, extended with the coin+start
// inputTape and the forcing poke. Called with no argument for the baseline and
// with the wrapped override map for the optimized side -- both get the SAME tape
// and poke (applied identically).
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = FORCE_POKE.map((p) => ({ ...p }));
  return m;
}

// The first store on loc_196b's path that lands in the compared state dump:
// sub_0852's tile-field fill writes VRAM 0x7400 = 0x10 as its very first store.
// 0x7400 is un-masked by the forcing poke (which only touches 0x600A), so a
// corruption there persists into the compared trace.
const BROKEN_ADDR = 0x7400;

/**
 * Deliberately-broken twin: behaviourally optimized_196b EXCEPT the first store
 * to 0x7400 lands a wrong value (the correct byte XOR 0xFF). Intercepting exactly
 * that one write lets the whole routine and every subroutine it calls run verbatim
 * -- the representative "wrong value to an address on the routine's path" bug the
 * gate must catch.
 */
function broken_196b(m) {
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
    return optimized_196b(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_196b matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_196b]]));

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
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (forced 0x600A=0x17 over frames 1040..1059)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_196b matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_196b, optimized_196b, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first entry: frame 1041)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong store on loc_196b's path is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_196b]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong store on loc_196b's path is CAUGHT and names 0x7400", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_196b, broken_196b, { maxFrames: MAX_FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- BRANCH + CYCLE COVERAGE --------------------------------------------------

// Capture the pristine machine state at loc_196b's FIRST dispatch (frame 1041),
// via the same construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_196b(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_196b never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

test("BRANCH + CYCLE COVERAGE: the single straight-line path is EQUAL incl. collapsed cycle total", () => {
  const entry = captureEntry();
  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized

  const cA0 = a.cycles, cB0 = b.cycles;
  translated_196b(a);
  optimized_196b(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (${ram.a} vs ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (${regs.a} vs ${regs.b})` : "");
  assert.equal(a.pc, b.pc, "pc must match");
  // The collapsed m.ret(43) must reproduce the oracle's TOTAL cycle cost exactly
  // (loc_196b's own 60 t + sub_0852's fills). A mis-collapsed arm has teeth here.
  assert.equal(dA, dB, `cycle-total mismatch (translated ${dA} vs optimized ${dB})`);
  // Confirm this really is loc_196b's transition: GAME_SUBSTATE := (0x600E)+0x12.
  const expected = (entry.mem.read8(0x600e) + 0x12) & 0xff;
  assert.equal(a.mem.read8(0x600a), expected, "translated must write GAME_SUBSTATE = (0x600E)+0x12");
  assert.equal(b.mem.read8(0x600a), expected, "optimized must write GAME_SUBSTATE = (0x600E)+0x12");
  console.log(
    `  BRANCH+CYCLE: single path EQUAL (RAM+regs+pc), cycle total ${dA} == ${dB}, ` +
      `0x600A := 0x${expected.toString(16)} = (0x600E=0x${entry.mem.read8(0x600e).toString(16)})+0x12`,
  );
});
