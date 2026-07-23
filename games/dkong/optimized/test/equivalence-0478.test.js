// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0478 (a colour-cycle animation leaf at ROM
 * 0x0478: `ld hl,0x6908 / ld c,0x44 / rrca / jp nc,0x0485 / ld a,(0x63b7) / ld c,a /
 * rst 0x38`, a BOARD-bit1-gated choice of the rst-0x38 sprite stride index that then
 * repositions the 10-record SPRITE_OBJ_BLOCK and falls into the shared colour tail
 * loc_0486). Its ONE caller is loc_0450 @0x0457, reached from loc_0426 <- loc_0413 <-
 * entry_03fb <- loc_197a — the per-frame in-game cascade — so, like loc_197a and
 * entry_03fb, it needs a credited, in-progress game and is driven with a coin+start
 * inputTape. It first dispatches at frame ~1063 (once gameplay begins ~f1033).
 *
 * loc_0478 is reached from loc_0450 ONLY when BOARD (0x6227) bit0 is clear (even
 * boards 2/4). Board 1 (odd) never reaches it — so the driven run pokes BOARD to an
 * even value (identical on BOTH sides) to make loc_0478 dispatch, and also pokes the
 * colour-cycle frame flag 0x6391 = 1 (identical both sides) so loc_0413 routes into
 * loc_0426, whose 32-frame boundary is what falls through loc_0450 into loc_0478.
 * (0x6391 stays a hex literal here — never named in ram.js — it is only a test poke.)
 *
 * Six jobs:
 *
 *   1. EQUAL (whole-machine, BOARD=4) — idiomatic optimized loc_0478
 *      (optimized/loc_0478.js) reads EQUAL against its translated oracle every frame.
 *      It dispatches ~8x across ~f1063..f1290 (the bit1==0 / C=0x44 arm, since
 *      BOARD 4 has bit1 clear). The override must fire (asserted) or EQUAL is vacuous.
 *
 *   2. EQUAL (unit, BOARD=4) — translated vs optimized leave identical RAM +
 *      registers (incl. F) + pc from the captured first-dispatch entry (bit1==0 arm).
 *
 *   3+4. BRANCH COVERAGE — loc_0478's one data-dependent branch is `rrca / jp nc` on
 *      BOARD bit1 (A arrives as BOARD ror-1 from loc_0450). Each arm is proven EQUAL
 *      on the REAL captured entry of a driven run at that board, asserting RAM + regs
 *      + pc AND the branch's CYCLE TOTAL (kept per-instruction, so a wrong charge has
 *      explicit teeth):
 *        - BOARD 4 (bit1==0): jp nc taken, keep default stride C=0x44   (989 t)
 *        - BOARD 2 (bit1==1): fall-through reads the 0x63b7 scratch      (797 t)
 *      A sentinel written into 0x63b7 confirms which arm ran: the bit1==1 arm CONSUMES
 *      it (the first SPRITE_OBJ_BLOCK store 0x6908 = 0x63b7 + old, so it varies with
 *      the sentinel); the bit1==0 arm IGNORES it (0x6908 invariant to 0x63b7). This is
 *      the 0x63b7 read-back the batch-10 analysis flagged.
 *
 *   5+6. TEETH (whole + unit) — a deliberately-broken twin whose first SPRITE_OBJ_BLOCK
 *      store (0x6908, written on the path by rst 0x38 -> loc_0038) lands the wrong value
 *      must be CAUGHT: NOT-EQUAL, naming 0x6908.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Same reason as
 * loc_197a / entry_03fb: harness.js bakes a makeMachine on `{}` assets that drives NO
 * input, so it never credits a game and never dispatches loc_197a -> entry_03fb ->
 * loc_0478. This test calls the SAME core unitEquivalence / wholeMachineEquivalence
 * directly with a makeMachine factory that attaches an identical coin+start inputTape
 * AND identical BOARD + 0x6391 pokes to BOTH sides (the factory is shared, so every
 * input/poke is applied identically to baseline and optimized). A Machine built with
 * no overrides runs the pure oracle (machine.js: manifest optimized routines are NOT
 * auto-applied), so the baseline is the oracle loc_0478 inside an all-oracle machine.
 *
 * CYCLE FINDING this routine adds: loc_0478 is NON-ATOMIC and stays PER-INSTRUCTION,
 * byte-identical to the oracle. Its sole call path is the interruptible per-frame
 * cascade (NMI mask ENABLED): loc_197a (main-loop task) -> entry_03fb -> loc_0413 ->
 * loc_0426 -> loc_0450 -> loc_0478, and it spans rst 0x38 plus the entire interruptible
 * loc_0486 colour tree, so the vblank NMI can land inside it — its internal cycle
 * distribution is observable. Per the ATOMICITY-IS-PER-CALL-PATH rule, a leaf reached
 * from an interruptible caller is not atomic, so NO collapse: every oracle m.step charge
 * is retained (same decision as entry_03fb, loc_197a, handler_01c3). Each branch's cycle
 * TOTAL is asserted equal on clones anyway.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0478 as translated_0478 } from "../../translated/state0.js";
import { loc_0478 as optimized_0478 } from "../loc_0478.js";
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

const TARGET = 0x0478;
const FRAMES = 1300; // loc_0478 dispatches ~f1063..f1290 (8x) via the loc_197a cascade
const MAX_FRAMES = 1120; // first dispatch is ~frame 1063 (gameplay begins ~f1033)
const TEETH_FRAMES = 1100; // enough to reach the first dispatch (~f1063)

// The colour-cycle scratch loc_0478 reads on the bit1==1 arm (`ld a,(0x63b7)`),
// written by entry_03fb's BOARD==2 prologue. Poking a sentinel here tells the arms
// apart: the bit1==1 arm consumes it (first SPRITE_OBJ_BLOCK store = 0x63b7 + old),
// the bit1==0 arm ignores it. Stays a hex literal (engine scratch, unnamed in ram.js).
const ARM_MARKER = 0x63b7;

// The first SPRITE_OBJ_BLOCK store on loc_0478's path: rst 0x38 -> loc_0038 writes the
// 10 records from 0x6908 upward (0x6908 = c + old). It sits in the compared work-RAM
// dump (0x6000-0x6BFF), so a corruption there is a clean caught diff.
const BROKEN_ADDR = 0x6908;

// A coin+start tape (identical to loc_197a's / entry_03fb's): coin on IN2 bit7 at
// frame 10, start1 on IN2 bit2 at frame 30. Credits and starts a game so the in-game
// cascade loc_197a -> entry_03fb -> ... -> loc_0478 runs.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The makeMachine factory the core engine drives, extended to attach the coin+start
// inputTape AND the two identical-both-sides pokes that make loc_0478 dispatch:
//   0x6227 (BOARD) = `board` — even, so loc_0450 falls into loc_0478.
//   0x6391 = 1 — routes loc_0413 into loc_0426 every frame so its 32-frame boundary
//                reaches loc_0450 (otherwise the colour-cycle gate never opens here).
// Called with no argument for the baseline (pure oracle) and with the wrapped override
// map for the optimized side — both get the SAME tape and pokes.
function makeMachine(board) {
  return (overrides) => {
    const m = new Machine(ROM, overrides ? { overrides } : {});
    m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
    m.pokes = [
      { addr: 0x6227, val: board, frame: 40, dur: null },
      { addr: 0x6391, val: 1, frame: 40, dur: null },
    ];
    return m;
  };
}

/**
 * Deliberately-broken twin: behaviourally optimized_0478 EXCEPT the first store to
 * 0x6908 lands a wrong value (the correct byte XOR 0xFF, guaranteed to differ).
 * Intercepting exactly that one write lets the rest of the routine and every
 * subroutine it calls run verbatim — the representative "wrong value to an address on
 * the routine's path" bug the gate must catch.
 */
function broken_0478(m) {
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
    return optimized_0478(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0478 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine(4), FRAMES, new Map([[TARGET, optimized_0478]]));

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
      `${r.invocations.get(TARGET)}x (per-frame via loc_197a cascade, ~f1063..f1290, bit1==0 arm)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0478 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine(4), TARGET, translated_0478, optimized_0478, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first entry: frame ~1063, BOARD=4 / bit1==0 arm)");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

// Capture the pristine machine at loc_0478's FIRST dispatch on `board`, via the same
// construction-time snapshot the core unit gate uses.
function captureEntry(board) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0478(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(board)(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_0478 never dispatched within ${MAX_FRAMES} frames (board ${board})`);
  return entry;
}

// Run oracle vs optimized on two clones of `entry` and diff RAM + regs + pc + cycle
// total. Returns diagnostics.
function diffBranch(entry) {
  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  const cA0 = a.cycles, cB0 = b.cycles;
  translated_0478(a);
  optimized_0478(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return { ram, regs, pcEq: a.pc === b.pc, dA, dB };
}

// First 12 bytes of SPRITE_OBJ_BLOCK (the records rst 0x38 -> loc_0038 rewrites), as a
// hex string — used to detect whether a 0x63b7 change reached the sprite stride.
function spriteBlock(m) {
  let s = "";
  for (let i = 0; i < 12; i++) s += m.mem.read8(0x6908 + i).toString(16).padStart(2, "0");
  return s;
}

test("BRANCH (unit): BOARD 4 (bit1==0, jp nc taken) — default-stride arm EQUAL (RAM+regs+pc+cycles)", () => {
  const entry = captureEntry(4);
  assert.equal(entry.regs.a & 0x01, 0, "captured bit1==0 arm: entry A bit0 must be 0 (BOARD 4 ror-1)");
  const r = diffBranch(entry);
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, "pc must match");
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);

  // bit1==0 arm must NOT consume 0x63b7: the sprite block is invariant to the sentinel.
  const s1 = entry.clone(); s1.mem.write8(ARM_MARKER, 0xaa); translated_0478(s1);
  const s2 = entry.clone(); s2.mem.write8(ARM_MARKER, 0x55); translated_0478(s2);
  assert.equal(spriteBlock(s1), spriteBlock(s2), "bit1==0 arm must ignore 0x63b7 (jp nc taken before the read)");
  console.log(`  BRANCH/bit1==0: default-stride arm EQUAL, 0x63b7 ignored, cycles match (${r.dA} t)`);
});

test("BRANCH (unit): BOARD 2 (bit1==1, fall-through) — 0x63b7-read arm EQUAL (RAM+regs+pc+cycles)", () => {
  const entry = captureEntry(2);
  assert.equal(entry.regs.a & 0x01, 1, "captured bit1==1 arm: entry A bit0 must be 1 (BOARD 2 ror-1)");
  const r = diffBranch(entry);
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, "pc must match");
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);

  // bit1==1 arm MUST consume 0x63b7: the sprite block varies with the sentinel
  // (first store 0x6908 = 0x63b7 + old), so a change in 0x63b7 changes the output.
  const s1 = entry.clone(); s1.mem.write8(ARM_MARKER, 0xaa); translated_0478(s1);
  const s2 = entry.clone(); s2.mem.write8(ARM_MARKER, 0x55); translated_0478(s2);
  assert.notEqual(spriteBlock(s1), spriteBlock(s2), "bit1==1 arm must consume 0x63b7 as the rst-0x38 stride");
  console.log(`  BRANCH/bit1==1: 0x63b7-read arm EQUAL, 0x63b7 consumed (0x6908 tracks the sentinel), cycles match (${r.dA} t)`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SPRITE_OBJ_BLOCK store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine(4), TEETH_FRAMES, new Map([[TARGET, broken_0478]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong SPRITE_OBJ_BLOCK store is CAUGHT and names 0x6908", () => {
  const r = unitEquivalence(makeMachine(4), TARGET, translated_0478, broken_0478, { maxFrames: MAX_FRAMES });

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
