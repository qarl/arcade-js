// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0464 (the counter-wrap RESET leaf of
 * entry_03fb's per-frame colour-cycle animation tree, ROM 0x0464). loc_0426 keeps
 * a private frame counter at 0x6390 and jumps here the frame it `inc`s to 0x80;
 * loc_0464 zeroes that counter AND its companion latch 0x6391, then dispatches on
 * a mode byte 0x6393: != 0 tail-jumps the colour tail loc_0486 (HOT), == 0 reloads
 * the sprite-object block via sub_004e and rejoins loc_0450 (COLD). Its ONLY caller
 * is loc_0426 <- loc_0413 <- entry_03fb <- loc_197a, the per-frame in-game cascade,
 * so — like its whole family — it needs a credited game and is driven with a
 * coin+start inputTape.
 *
 * Six jobs:
 *
 *   1. EQUAL (whole-machine) — idiomatic optimized loc_0464 (optimized/loc_0464.js)
 *      reads EQUAL against its translated oracle every frame. loc_0464 dispatches
 *      when the 0x6390 counter wraps to 0x80; with this tape that FIRST happens at
 *      frame 1929 (the counter only advances once 0x6391 latches, and then needs
 *      128 frames), so the run window reaches past it. The override must actually
 *      fire (asserted) or EQUAL would be vacuous.
 *
 *   2. EQUAL (unit) — translated vs optimized leave identical RAM + registers
 *      (incl. F) + pc from the captured entry state (first dispatch, frame 1929,
 *      0x6393 == 1 so the HOT / loc_0486 arm).
 *
 *   3+4. BRANCH COVERAGE — loc_0464's one data-dependent branch is `and a /
 *      jp nz,0x0486` on the mode byte 0x6393. The driven run only ever sees
 *      0x6393 == 1 (the HOT arm). Each arm is proven EQUAL on clones of the captured
 *      entry with 0x6393 poked identically on BOTH sides, asserting RAM + regs + pc
 *      AND the branch's CYCLE TOTAL (kept per-instruction, so a wrong charge on the
 *      COLD arm — which the natural run never reaches — has explicit teeth):
 *        - 0x6393 != 0 (poke 0x01): jp nz taken, tail-jump loc_0486        (322 t)
 *        - 0x6393 == 0 (poke 0x00): COLD arm — ld hl,0x385c / call sub_004e /
 *          jp loc_0450                                                    (1745 t)
 *      A sentinel poked into 0x6908 (SPRITE_OBJ_BLOCK) confirms which arm ran: the
 *      COLD arm's sub_004e block-copies the ROM template over it (its signature),
 *      the HOT arm never touches it.
 *
 *   5+6. TEETH (whole + unit) — a deliberately-broken twin whose (0x6391) = 0 store
 *      (the routine's signature write) lands the wrong value must be CAUGHT:
 *      NOT-EQUAL, naming 0x6391. loc_0413 is the only other writer of 0x6391 and it
 *      runs BEFORE loc_0464 in the frame, so the corruption survives to the sample.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Same reason
 * as entry_03fb / loc_197a: harness.js bakes a makeMachine on `{}` assets that
 * drives NO input, so it never credits a game and never dispatches loc_197a ->
 * entry_03fb -> ... -> loc_0464. This test calls the SAME core unitEquivalence /
 * wholeMachineEquivalence directly, with a makeMachine factory that attaches an
 * identical coin+start inputTape to BOTH sides (the factory is shared, so any
 * input/poke is applied identically to baseline and optimized). A Machine built
 * with no overrides runs the pure oracle (machine.js: the manifest's optimized
 * routines are NOT auto-applied), so the baseline is the oracle loc_0464 inside an
 * all-oracle machine.
 *
 * CYCLE FINDING: loc_0464 is NON-ATOMIC and stays PER-INSTRUCTION, byte-identical
 * to the oracle. Its call path (loc_0426 <- ... <- loc_197a) is the interruptible
 * per-frame cascade (NMI mask ENABLED), and loc_0464 spans the sub_004e block copy
 * plus the whole loc_0486 / loc_0450 colour subtree — the vblank NMI can land
 * inside it, so its internal cycle distribution is observable. Per the ATOMICITY-
 * IS-PER-CALL-PATH rule, NO collapse: every oracle m.step charge is retained (same
 * decision as entry_03fb, loc_197a, handler_01c3). Each branch's cycle TOTAL is
 * asserted equal on clones anyway.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0464 as translated_0464 } from "../../translated/state0.js";
import { loc_0464 as optimized_0464 } from "../loc_0464.js";
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

const TARGET = 0x0464;
const FRAMES = 2000; // loc_0464 first dispatches at frame 1929 (once in this window)
const MAX_FRAMES = 1960; // enough to reach the first dispatch

// Branch selector: `ld a,(0x6393) / and a / jp nz,0x0486`.
const MODE = 0x6393;

// The COLD arm's SIGNATURE region: sub_004e block-copies the ROM template at 0x385c
// into SPRITE_OBJ_BLOCK (0x6908-0x692F). 0x6908 is written ONLY on the COLD arm (the
// HOT/loc_0486 tail never touches it), so a sentinel poked here tells the arms apart.
const ARM_MARKER = 0x6908;
const ARM_SENTINEL = 0xaa;

// The routine's signature store: `ld (0x6391),a` with A==0. loc_0464 always writes
// it; the only other writer (loc_0413) runs earlier in the frame, so a corruption
// survives to the frame sample. 0x6391 sits in the compared work-RAM dump.
const BROKEN_ADDR = 0x6391;

// A coin+start tape (identical to entry_03fb / loc_197a's): coin on IN2 bit7 at
// frame 10, start1 on IN2 bit2 at frame 30. Credits and starts a game so the
// loc_197a -> entry_03fb -> loc_0426 -> loc_0464 chain runs.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The makeMachine factory the core engine drives, extended to attach the coin+start
// inputTape. Called with no argument for the baseline (pure oracle) and with the
// wrapped override map for the optimized side — both get the SAME tape.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
}

/**
 * Deliberately-broken twin: behaviourally optimized_0464 EXCEPT the store to 0x6391
 * lands a wrong value (the correct byte XOR 0xFF, i.e. 0x00 -> 0xFF, guaranteed to
 * differ). Intercepting exactly that one write lets the rest of the routine and
 * every subroutine it calls run verbatim — the representative "wrong value to one
 * of the routine's own output addresses" bug the gate must catch.
 */
function broken_0464(m) {
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
    return optimized_0464(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_0464 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0464]]));

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
      `${r.invocations.get(TARGET)}x (counter wrap at ~f1929 via loc_0426)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_0464 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0464, optimized_0464, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, HL) + pc identical (first entry: frame 1929, 0x6393==1 / HOT arm)");
});

// -- BRANCH COVERAGE ----------------------------------------------------------

// Capture the pristine machine at loc_0464's FIRST dispatch (frame 1929), via the
// same construction-time snapshot the core unit gate uses.
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0464(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_0464 never dispatched within ${MAX_FRAMES} frames`);
  return entry;
}

// Run oracle vs optimized on two clones of `entry`, with 0x6393 poked to `mode` and a
// sentinel poked into 0x6908 (both pokes identical on both sides), and diff RAM + regs
// + pc + cycle total. Returns diagnostics incl. the post-run 0x6908 (arm marker).
function diffBranch(entry, mode) {
  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  for (const c of [a, b]) {
    c.mem.write8(MODE, mode);
    c.mem.write8(ARM_MARKER, ARM_SENTINEL);
  }
  const cA0 = a.cycles, cB0 = b.cycles;
  translated_0464(a);
  optimized_0464(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return { ram, regs, pcEq: a.pc === b.pc, dA, dB, marker: a.mem.read8(ARM_MARKER) };
}

test("BRANCH (unit): 0x6393 != 0 (jp nz taken) — HOT loc_0486 arm EQUAL (RAM+regs+pc+cycles)", () => {
  const r = diffBranch(captureEntry(), 0x01);
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, "pc must match");
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
  // HOT arm: loc_0464 -> loc_0486 never writes 0x6908, so the sentinel survives.
  assert.equal(r.marker, ARM_SENTINEL, "!= 0 arm must NOT write 0x6908 (HOT tail-jumps loc_0486)");
  console.log(`  BRANCH/!=0: HOT loc_0486 arm EQUAL, 0x6908 untouched, cycles match (${r.dA} t)`);
});

test("BRANCH (unit): 0x6393 == 0 (COLD) — sub_004e + loc_0450 arm EQUAL (RAM+regs+pc+cycles)", () => {
  const r = diffBranch(captureEntry(), 0x00);
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, "pc must match");
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
  // COLD arm: sub_004e block-copies the ROM template over 0x6908 (its signature).
  assert.notEqual(r.marker, ARM_SENTINEL, "== 0 arm must write 0x6908 (sub_004e block copy)");
  console.log(`  BRANCH/==0: COLD sub_004e+loc_0450 arm EQUAL, 0x6908 rewritten to 0x${r.marker.toString(16)}, cycles match (${r.dA} t)`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong (0x6391) reset store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, broken_0464]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong (0x6391) reset store is CAUGHT and names 0x6391", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0464, broken_0464, { maxFrames: MAX_FRAMES });

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
