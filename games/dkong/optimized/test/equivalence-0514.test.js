// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_0514 (the colour-column FILL PRIMITIVE:
 * `ld b,3 / {ld (hl),a; add hl,de; dec a; djnz}` -- store A into three colour-RAM
 * cells, descending, stride DE). It is a LEAF called via `m.call` by the ATTRACT /
 * intro colour-cycle tree (loc_04a3 / loc_04be / loc_04f1 <- loc_0486 <- entry_03fb
 * <- loc_197a, the per-frame in-game cascade) and by sub_1708 -- so, like its
 * parents, it needs a credited game to run and is driven with a coin+start
 * inputTape. On the live board-1 run its ONLY caller is loc_04a3, which always
 * hands it HL=0x75C4, A=0x10, DE=0x20 (all 198 invocations over 1300 frames are
 * this single live-in; the loc_04be / sub_1708 callers are cold on board 1).
 *
 * Jobs:
 *
 *   1. EQUAL (whole-machine) -- idiomatic optimized sub_0514 (optimized/sub_0514.js)
 *      reads EQUAL against its translated oracle every frame. sub_0514 fires per
 *      frame of board 1 (first at frame ~1032). The override must actually fire
 *      (asserted) or EQUAL would be vacuous.
 *
 *   2. EQUAL (unit) -- translated vs optimized leave identical RAM + registers
 *      (incl. F) + pc from the captured entry state (first m.call of 0x0514).
 *
 *   3+4. PATH + CYCLES (unit) -- sub_0514 has NO data-dependent branch: B is hard-
 *      loaded to 3, so the loop count is INVARIANT (djnz taken, taken, not-taken --
 *      always exactly 3 passes) and there is no "loop 0/1/many" arm to cover. Its
 *      single path is proven EQUAL incl. the CYCLE TOTAL on clones of the captured
 *      entry (so a wrong m.step has explicit teeth). That path is then re-proven with
 *      the live-in A and DE poked (identical both sides) across the primitive's VALUE
 *      domain -- A=0x03 drives the final `dec a` to 0 (Z at ret), A=0x01 drives it to
 *      0xFE (S at ret, A wrapping through 0), and DE=0x08 proves the stride is honored
 *      (three different write addresses) rather than a hardcoded 0x20 -- giving the
 *      written values and the live-at-ret flags real teeth. (The carry out of the
 *      final `add hl,de` -- the C the oracle documents live at ret -- is UNREACHABLE
 *      to synthesise: with the 0x20 stride the only HL that carries pushes the writes
 *      into unmapped space, which throws. C is never set on any real call path (always
 *      0), and it is re-derived by the SAME `addHl` helper the oracle uses, so the
 *      natural path's F comparison -- which includes C=0 -- already covers it.)
 *
 *   5+6. TEETH (whole + unit) -- a deliberately-broken twin whose first colour-RAM
 *      store (0x75C4, the first `ld (hl),a`) lands the wrong value must be CAUGHT:
 *      NOT-EQUAL, naming 0x75C4.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Same reason as
 * entry_03fb / loc_197a / loc_04a3: harness.js bakes a makeMachine on `{}` assets that
 * drives NO input, so it never credits a game and never dispatches the colour cascade.
 * This test calls the SAME core unitEquivalence / wholeMachineEquivalence directly,
 * with a makeMachine factory that attaches an identical coin+start inputTape to BOTH
 * sides (the factory is shared, so any input/poke is applied identically to baseline
 * and optimized). A Machine built with no overrides runs the pure oracle.
 *
 * CYCLE FINDING. sub_0514 is NON-ATOMIC and stays PER-INSTRUCTION, byte-identical to
 * the oracle. By the ATOMICITY-IS-PER-CALL-PATH rule a leaf is atomic only if the
 * vblank NMI cannot fire inside it on ANY call path; every `m.call(0x0514)` site is
 * reached from the INTERRUPTIBLE per-frame cascade (loc_04a3/loc_04be/loc_04f1 <-
 * loc_0486 <- entry_03fb <- loc_197a, plus sub_1708 / 0x17cd) with the NMI mask
 * ENABLED, so the NMI can land between its instructions and push a PC into the diffed
 * stack RAM -- the internal cycle distribution is observable. NO collapse (same
 * decision as its parents loc_04a3 / entry_03fb / loc_197a).
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_0514 as translated_0514 } from "../../translated/state0.js";
import { sub_0514 as optimized_0514 } from "../sub_0514.js";
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

const TARGET = 0x0514;
const FRAMES = 1300; // sub_0514 runs per-frame via the colour cascade, ~f1032..f1230
const MAX_FRAMES = 1080; // sub_0514 first reached (via loc_04a3) at frame ~1032

// The first colour-RAM store on sub_0514's path: the first `ld (hl),a`, with the
// captured-entry HL = 0x75C4. It sits in the compared video-RAM dump (0x7400-0x77FF)
// and is written exactly once (HL then steps away by DE), so a corruption there is a
// clean caught diff.
const BROKEN_ADDR = 0x75c4;

// A coin+start tape (identical to entry_03fb / loc_197a / loc_04a3): coin on IN2 bit7
// at frame 10, start1 on IN2 bit2 at frame 30. Credits and starts a game so the colour
// cascade (loc_197a -> entry_03fb -> ... -> loc_04a3 -> sub_0514) runs.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// The makeMachine factory the core engine drives, extended to attach the coin+start
// inputTape. Called with no argument for the baseline (pure oracle) and with the
// wrapped override map for the optimized side -- both get the SAME tape.
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
}

/**
 * Deliberately-broken twin: behaviourally optimized_0514 EXCEPT the first store to
 * 0x75C4 lands a wrong value (the correct byte XOR 0xFF, guaranteed to differ).
 * Intercepting exactly that one write lets the rest of the routine run verbatim --
 * the representative "wrong value to one of the routine's own output cells" bug the
 * gate must catch.
 */
function broken_0514(m) {
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
    return optimized_0514(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_0514 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_0514]]));

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
      `${r.invocations.get(TARGET)}x (per-frame via the colour cascade)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_0514 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0514, optimized_0514, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, B, HL, SP) + pc identical (first m.call, frame ~1032)");
});

// -- PATH + CYCLES ------------------------------------------------------------

// Capture the pristine machine at sub_0514's FIRST entry (via the same construction-
// time snapshot the core unit gate uses; sub_0514 is reached only by m.call).
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0514(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`sub_0514 never entered within ${MAX_FRAMES} frames`);
  return entry;
}

// Run oracle vs optimized on two clones of `entry`, optionally poking the live-in
// A / HL / DE (identical on both sides), and diff RAM + regs + pc + cycle total.
function diffPath(entry, poke = {}) {
  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  for (const c of [a, b]) {
    if (poke.a !== undefined) c.regs.a = poke.a;
    if (poke.hl !== undefined) c.regs.hl = poke.hl;
    if (poke.de !== undefined) c.regs.de = poke.de;
  }
  const cA0 = a.cycles, cB0 = b.cycles;
  translated_0514(a);
  optimized_0514(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return { ram, regs, pcEq: a.pc === b.pc, dA, dB };
}

test("PATH (unit): sub_0514's single fixed 3-pass path EQUAL incl. cycle total", () => {
  const r = diffPath(captureEntry());
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, "pc must match");
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
  console.log(`  PATH: 3-pass fill EQUAL, cycles match (${r.dA} t = 7 + 2*35 + 30 + 10)`);
});

test("PATH (unit): value/stride domain (poked A, DE) EQUAL incl. cycle total", () => {
  const entry = captureEntry();
  // A=0x03 -> final dec a = 0 (Z at ret); A=0x01 -> final dec a = 0xFE (S at ret,
  // A wraps through 0); DE=0x08 (HL=0x7540) -> a different, honored stride, three
  // distinct colour-RAM writes. sub_0514 writes+decrements identically both sides.
  for (const [label, poke] of [
    ["A=0x03 (final A=0 -> Z)", { a: 0x03 }],
    ["A=0x01 (final A=0xFE -> S, wrap)", { a: 0x01 }],
    ["DE=0x08 HL=0x7540 (stride honored)", { de: 0x08, hl: 0x7540 }],
  ]) {
    const r = diffPath(entry, poke);
    assert.equal(r.ram, null, r.ram ? `[${label}] RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
    assert.equal(r.regs, null, r.regs ? `[${label}] reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
    assert.ok(r.pcEq, `[${label}] pc must match`);
    assert.equal(r.dA, r.dB, `[${label}] cycle-total mismatch (${r.dA} vs ${r.dB})`);
    console.log(`  PATH/${label}: EQUAL, cycles match (${r.dA} t)`);
  }
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong colour-RAM store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, broken_0514]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong colour-RAM store is CAUGHT and names 0x75C4", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_0514, broken_0514, { maxFrames: MAX_FRAMES });

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
