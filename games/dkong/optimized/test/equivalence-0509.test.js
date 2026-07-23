// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0509 (the bit6-clear arm of the (0x6227)==4
 * colour-blink block, ROM 0x0509). It is a two-way router: `ld a,(MARIO_X) / cp
 * 0x80` picks the blink polarity from which half of the screen Mario is on, then
 * TAIL-JUMPS (jp, no push16) to loc_04f9 (blink OFF, X>=0x80) or loc_04e1 (blink
 * ON, X<0x80). Its ONE caller is loc_04be (`jp z,0x0509`), reached via loc_197a ->
 * entry_03fb -> the loc_0413 colour tree -> loc_0486 -> loc_04be, the per-frame
 * in-game cascade — so it needs a credited game AND BOARD (0x6227)==4 to run.
 *
 * loc_0509 is COLD/latent: a driven board-1 game NEVER sees BOARD==4, so the colour
 * tree never routes into the (0x6227)==4 blink block. entry_03fb only runs during
 * the opening Kong-climb cutscene (frames ~1032-1229); actual gameplay past that
 * never re-enters it. So to exercise loc_0509, an identical-both-sides poke holds
 * 0x6227=4 from frame 1040 (mid-cutscene, while loc_197a is cascading through
 * entry_03fb). loc_04be's bit 6 of the frame counter is clear during the cutscene,
 * so it routes loc_04be -> loc_0509 every frame from ~f1041 (161x in a 1200-frame
 * window), and the run stays healthy (reaches the vblank spin every frame). The
 * poke is deterministic (oracle-vs-oracle under it is byte-identical), so the whole-
 * machine gate is meaningful, not vacuous.
 *
 * Seven jobs:
 *
 *   1. EQUAL (whole-machine) — idiomatic optimized loc_0509 reads EQUAL against its
 *      translated oracle every frame, override firing every cutscene frame (>=1).
 *
 *   2. EQUAL (unit) — translated vs optimized leave identical RAM + all registers
 *      (incl. F) + pc from the captured first-entry state (frame ~1041; MARIO_X=0x3f
 *      < 0x80 — the natural branch B, blink ON via loc_04e1).
 *
 *   3+4. BRANCH COVERAGE — loc_0509's ONE data-dependent guard (`cp 0x80` on MARIO_X)
 *      fans out to TWO exits. The driven run only reaches branch B (MARIO_X<0x80 in
 *      the cutscene). Each arm is proven EQUAL on clones of the captured entry with
 *      MARIO_X poked identically on BOTH sides (and C pinned to 0x00 so the shared
 *      downstream loc_04ac exit is deterministic), asserting RAM + regs + pc AND the
 *      branch's exact CYCLE TOTAL (kept per-instruction, so a wrong charge on a cold
 *      arm has explicit teeth), plus a blink-bit SIGNATURE that proves the intended
 *      leaf actually ran:
 *        - A  X>=0x80 (X=0xc0): -> loc_04f9 (blink OFF)  125 t;  0x6901/0x6905 bit7 CLEAR
 *        - B  X<0x80  (X=0x3f): -> loc_04e1 (blink ON)   135 t;  0x6901/0x6905 bit7 SET
 *
 *   5+6. TEETH (whole + unit) — a deliberately-broken twin whose first store on the
 *      routine's (natural, branch-B) path — 0x6901, written by the loc_04e1 leaf —
 *      lands the wrong value must be CAUGHT: NOT-EQUAL, naming 0x6901. (loc_0509 does
 *      no store of its own; the first store on either arm is 0x6901 in the leaf, and
 *      0x6901 sits in the compared work-RAM dump 0x6000-0x6BFF — the same address the
 *      loc_04e1 test uses as its proven-caught teeth.)
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Same reason as
 * its siblings loc_04be / loc_04e1 / entry_03fb: harness.js bakes a makeMachine on
 * `{}` assets that drives NO input, so it never credits a game and never dispatches
 * loc_197a -> ... -> loc_0509. This test calls the SAME core unitEquivalence /
 * wholeMachineEquivalence directly, with a makeMachine factory that attaches an
 * identical coin+start inputTape AND the identical BOARD=4 poke to BOTH sides (the
 * factory is shared, so every input/poke is applied identically to baseline and
 * optimized). A Machine built with no overrides runs the pure oracle.
 *
 * CYCLE FINDING this routine adds: loc_0509 is NON-ATOMIC and stays PER-INSTRUCTION,
 * byte-identical to the oracle. Its sole caller loc_04be sits inside the interruptible
 * loc_197a -> entry_03fb per-frame cascade (NMI mask ENABLED), and loc_0509 tail-jumps
 * into the interruptible blink leaves loc_04f9 / loc_04e1 (-> loc_04ac), so the vblank
 * NMI can land inside it — its internal cycle distribution is observable. Per the
 * ATOMICITY-IS-PER-CALL-PATH rule a leaf reached from an interruptible caller is not
 * atomic, so NO collapse (same decision as loc_04be / loc_04e1 / loc_04ac / entry_03fb
 * / loc_197a). Each branch's cycle TOTAL is asserted equal on clones anyway.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0509 as translated_0509 } from "../../translated/state0.js";
import { loc_0509 as optimized_0509 } from "../loc_0509.js";
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

const TARGET = 0x0509;
const FRAMES = 1200;     // loc_0509 dispatches every cutscene frame from ~f1041 (161x) once BOARD=4 is poked
const MAX_FRAMES = 1080; // loc_0509 first dispatches at frame ~1041

// The branch selector loc_0509 reads.
const MARIO_X = 0x6203;

// loc_0509 does NO store of its own; the first store on its natural (branch-B)
// path is 0x6901, written by the loc_04e1 leaf (`ld (0x6901),a`). It sits in the
// compared work-RAM dump (0x6000-0x6BFF) and is DMA'd to sprite RAM — the same
// proven-caught teeth address the loc_04e1 equivalence test uses.
const BROKEN_ADDR = 0x6901;

// A coin+start tape (identical to loc_04be / loc_04e1's): coin on IN2 bit7 at frame
// 10, start1 on IN2 bit2 at frame 30 — credits and starts a game so the loc_197a ->
// entry_03fb -> loc_0486 cascade runs during the opening cutscene.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// loc_0509 is COLD on board 1; hold BOARD (0x6227)=4 from frame 1040 (identical on
// both sides) so loc_0486's `cp 0x04 / jp z,0x04be` routes the colour tree into the
// blink block, whose bit6-clear arm jumps into loc_0509 every cutscene frame.
const BOARD_POKE = [{ addr: 0x6227, val: 0x04, frame: 1040, dur: null }];

// The makeMachine factory the core engine drives, extended to attach BOTH the
// coin+start inputTape and the BOARD=4 poke. Called with no argument for the baseline
// (pure oracle) and with the wrapped override map for the optimized side — both get
// the SAME tape and the SAME poke (fresh copies so neither side mutates the other's).
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = BOARD_POKE.map((p) => ({ ...p }));
  return m;
}

/**
 * Deliberately-broken twin: behaviourally optimized_0509 EXCEPT the first store to
 * 0x6901 (made by the loc_04e1 leaf it tail-jumps to) lands a wrong value (the correct
 * byte XOR 0xFF, guaranteed to differ). Intercepting exactly that one write lets the
 * rest of the routine and every subroutine it calls run verbatim — the representative
 * "wrong value to an address on the routine's path" bug the gate must catch. The
 * `broke` flag is per-call (reset each dispatch), so it breaks the store on every
 * frame loc_0509 runs.
 */
function broken_0509(m) {
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
    return optimized_0509(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0509 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0509]]));

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
      `${r.invocations.get(TARGET)}x (per cutscene frame via loc_04be, ~f1041.., BOARD=4 poked)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0509 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0509, optimized_0509, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first entry: frame ~1041, branch B, blink ON)");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

// Capture the pristine machine at loc_0509's FIRST dispatch (frame ~1041), via the
// same construction-time snapshot the core unit gate uses. Memoised so the ~1080-
// frame host run happens once, not per branch test.
let ENTRY = null;
function captureEntry() {
  if (ENTRY) return ENTRY;
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0509(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_0509 never dispatched within ${MAX_FRAMES} frames`);
  ENTRY = entry;
  return ENTRY;
}

// Run oracle vs optimized on two clones of the captured entry, with MARIO_X and C
// poked identically on both sides, and diff RAM + regs + pc + cycle total. C is
// pinned to 0x00 (loc_04ac EXIT-1) so the shared downstream tail is deterministic.
// Returns diagnostics incl. the post-run blink-bit signature.
function diffBranch(x) {
  const entry = captureEntry();
  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  for (const cl of [a, b]) {
    cl.regs.c = 0x00;
    cl.mem.write8(MARIO_X, x);
  }
  const cA0 = a.cycles, cB0 = b.cycles;
  translated_0509(a);
  optimized_0509(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return {
    ram,
    regs,
    pcEq: a.pc === b.pc,
    dA,
    dB,
    v6901: a.mem.read8(0x6901),
    v6905: a.mem.read8(0x6905),
    blink6901: (a.mem.read8(0x6901) >> 7) & 1,
    blink6905: (a.mem.read8(0x6905) >> 7) & 1,
  };
}

test("BRANCH A (unit): X>=0x80 -> loc_04f9 (blink OFF) EQUAL (RAM+regs+pc+125t)", () => {
  const r = diffBranch(0xc0);
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, "pc must match");
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
  assert.equal(r.dA, 125, `cycle total ${r.dA} != expected 125 (wrong branch / charge)`);
  // Signature: loc_04f9 cleared bit7 of BOTH 0x6901 and 0x6905 (blink OFF).
  assert.equal(r.blink6901, 0, "branch A must clear 0x6901 bit7 (loc_04f9, OFF)");
  assert.equal(r.blink6905, 0, "branch A must clear 0x6905 bit7 (loc_04f9, OFF)");
  console.log(`  BRANCH/A: X>=0x80 arm EQUAL -> loc_04f9, blink OFF (0x6901=0x${r.v6901.toString(16)}, 0x6905=0x${r.v6905.toString(16)}), cycles match (${r.dA} t)`);
});

test("BRANCH B (unit): X<0x80 -> loc_04e1 (blink ON) EQUAL (RAM+regs+pc+135t)", () => {
  const r = diffBranch(0x3f);
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, "pc must match");
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
  assert.equal(r.dA, 135, `cycle total ${r.dA} != expected 135 (wrong branch / charge)`);
  // Signature: loc_04e1 set bit7 of BOTH 0x6901 and 0x6905 (blink ON).
  assert.equal(r.blink6901, 1, "branch B must set 0x6901 bit7 (loc_04e1, ON)");
  assert.equal(r.blink6905, 1, "branch B must set 0x6905 bit7 (loc_04e1, ON)");
  console.log(`  BRANCH/B: X<0x80 arm EQUAL -> loc_04e1, blink ON (0x6901=0x${r.v6901.toString(16)}, 0x6905=0x${r.v6905.toString(16)}), cycles match (${r.dA} t)`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x6901 store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, broken_0509]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong 0x6901 store is CAUGHT and names 0x6901", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0509, broken_0509, { maxFrames: MAX_FRAMES });

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
