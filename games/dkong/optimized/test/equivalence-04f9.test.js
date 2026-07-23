// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_04f9 (the blink-OFF leaf of the intro colour-
 * cycle driver, ROM 0x04F9). It ANDs off bit 7 from the two colour-cycle sprite-code
 * bytes 0x6901 and 0x6905: it stores 0x6901 itself and leaves (0x6905)&0x7f in A,
 * then tail-JUMPS (jp, no push16) into loc_04ac — the SHARED store that publishes A
 * to 0x6905 and runs its own 3-way blink-phase logic on C (the frame counter
 * loc_0486 loaded from 0x6390). loc_04f9 is the exact mirror of loc_04e1 (blink ON,
 * `or 0x80`): same six-instruction shape, same 63t own-total, same tail-jump.
 *
 * WHERE IT ROUTES FROM. loc_04be / loc_0509 pick blink OFF vs ON by MARIO_X (0x6203):
 * X >= 0x80 -> loc_04f9 (blink OFF), X < 0x80 -> loc_04e1 (blink ON). loc_04f9 is
 * reached via m.call from loc_04f1 (loc_04be's X>=0x80 fall-through, bit6 of C SET)
 * and loc_0509 (`jp nc,0x04f9`, bit6 of C CLEAR) — both under loc_197a -> entry_03fb
 * -> the loc_0413 colour tree, the per-frame in-game cascade. So it needs a credited
 * game AND BOARD (0x6227)==4 AND MARIO_X (0x6203)>=0x80.
 *
 * loc_04f9 is COLD/latent: a driven board-1 game NEVER sees BOARD==4, so the colour
 * tree never routes into the (0x6227)==4 blink block; and even under BOARD==4 the
 * cutscene keeps MARIO_X < 0x80 (which routes to loc_04e1, the ON twin — see its
 * test). entry_03fb only runs during the opening Kong-climb cutscene (frames
 * ~1032-1229). So to exercise loc_04f9, TWO identical-both-sides pokes hold, from
 * frame 1040 (mid-cutscene, while loc_197a is cascading through entry_03fb):
 *   0x6227 = 4     -> loc_0486's `cp 0x04 / jp z,0x04be` enters the blink block, and
 *   0x6203 = 0x90  -> MARIO_X >= 0x80, so loc_04be routes to loc_04f1->loc_04f9
 *                     (bit6 of C set) and loc_0509 to `jp nc,0x04f9` (bit6 clear).
 * loc_04f9 then dispatches every cutscene frame from ~f1041, and the run stays
 * healthy (reaches the vblank spin every frame). The pokes are deterministic
 * (oracle-vs-oracle under them is byte-identical), so the whole-machine gate is
 * meaningful, not vacuous. Because bit6 of the frame counter C flips over the
 * cutscene, BOTH entry paths (loc_04f1 via loc_04be, and loc_0509) are exercised.
 *
 * loc_04f9 has NO data-dependent branch of its own — it always runs the same six
 * instructions, then jumps into loc_04ac. Its "branch coverage" is therefore loc_04ac's
 * THREE exits, exercised END-TO-END THROUGH loc_04f9 by poking C (identical on both
 * sides): this proves loc_04f9 forwards C untouched AND that the whole loc_04f9 ->
 * loc_04ac path stays EQUAL, with each exit's cycle TOTAL asserted (per-instruction is
 * kept, so a wrong charge has explicit teeth).
 *
 * Seven jobs:
 *
 *   1. EQUAL (whole-machine) — idiomatic optimized loc_04f9 reads EQUAL against its
 *      translated oracle every frame, override firing every cutscene frame (>=1).
 *
 *   2. EQUAL (unit) — translated vs optimized leave identical RAM + all registers
 *      (incl. F) + pc from the captured first-entry state (frame ~1041).
 *
 *   3+4+5. loc_04ac-EXIT COVERAGE via loc_04f9 — C poked identically on both sides to
 *      drive each downstream exit, asserting RAM + regs + pc AND the exact cycle TOTAL
 *      (identical to loc_04e1's totals — same 63t own-total + loc_04ac's 32/52/80):
 *        - EXIT-1  C bit6 clear (c=0x00): ret z, blink stays OFF, no re-flip      95 t
 *        - EXIT-2  C bit6 set, C%8!=0 (c=0x41): ret nz, blink stays OFF, no flip 115 t
 *        - EXIT-3  C bit6 set, C%8==0 (c=0x40): xor 0x03 re-flips 0x6905 lo bits 143 t
 *      All three keep 0x6901 bit7 CLEAR (loc_04f9 always ANDs it off); EXIT-3
 *      additionally flips bits 0,1 of 0x6905 (bit7 untouched) — the signature its arm ran.
 *
 *   6+7. TEETH (whole + unit) — a deliberately-broken twin whose store to 0x6901
 *      (loc_04f9's only own store) lands the wrong value must be CAUGHT: NOT-EQUAL,
 *      naming 0x6901.
 *
 * WHY THE CORE ENGINE + A CUSTOM FACTORY (not harness.js's wrappers). Same reason as
 * its mirror twin loc_04e1 / parents entry_03fb / loc_04be: harness.js bakes a
 * makeMachine on `{}` assets that drives NO input, so it never credits a game and
 * never dispatches loc_197a -> ... -> loc_04f9. This test calls the SAME core
 * unitEquivalence / wholeMachineEquivalence directly, with a makeMachine factory that
 * attaches an identical coin+start inputTape AND the identical BOARD=4 + MARIO_X pokes
 * to BOTH sides (the factory is shared, so every input/poke is applied identically to
 * baseline and optimized). A Machine built with no overrides runs the pure oracle.
 *
 * CYCLE FINDING this routine adds: loc_04f9 is NON-ATOMIC and stays PER-INSTRUCTION,
 * byte-identical to the oracle. Both its callers (loc_04f1, loc_0509) sit inside the
 * interruptible loc_197a -> entry_03fb per-frame cascade (NMI mask ENABLED), and
 * loc_04f9 tail-jumps into the interruptible loc_04ac, so the vblank NMI can land
 * inside it — its internal cycle distribution is observable. Per the ATOMICITY-IS-
 * PER-CALL-PATH rule a leaf reached from an interruptible caller is not atomic, so NO
 * collapse (same decision as loc_04e1 / loc_04ac / loc_04be / entry_03fb / loc_197a).
 * Each exit's cycle TOTAL is asserted equal on clones anyway.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04f9 as translated_04f9 } from "../../translated/state0.js";
import { loc_04f9 as optimized_04f9 } from "../loc_04f9.js";
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

const TARGET = 0x04f9;
const FRAMES = 1200;    // loc_04f9 dispatches every cutscene frame from ~f1041 once BOARD=4 + X>=0x80 are poked
const MAX_FRAMES = 1080; // loc_04f9 first dispatches at frame ~1041

// The two colour-cycle sprite-code bytes loc_04f9 clears bit7 of (inside SPRITE_BUFFER).
const BYTE_6901 = 0x6901; // stored by loc_04f9 itself
const BYTE_6905 = 0x6905; // left in A, published by loc_04ac

// loc_04f9's only own store is 0x6901; corrupting it is the representative "wrong
// value to one of the routine's own output addresses" bug the gate must catch. It
// sits in the compared work-RAM dump (0x6000-0x6BFF) and is DMA'd to sprite RAM.
const BROKEN_ADDR = 0x6901;

// A coin+start tape (identical to loc_04be/loc_04e1's): coin on IN2 bit7 at frame 10,
// start1 on IN2 bit2 at frame 30 — credits and starts a game so the loc_197a ->
// entry_03fb -> loc_0486 cascade runs during the opening cutscene.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// loc_04f9 is COLD on board 1 AND (unlike its ON twin) needs MARIO_X >= 0x80. Hold
// BOARD (0x6227)=4 and MARIO_X (0x6203)=0x90 from frame 1040 (identical on both
// sides): 0x6227=4 makes loc_0486 route the colour tree into the blink block, and
// X>=0x80 makes loc_04be/loc_0509 route into loc_04f9 (blink OFF) every cutscene frame.
const STATE_POKES = [
  { addr: 0x6227, val: 0x04, frame: 1040, dur: null }, // BOARD = 4 (rivets) -> loc_04be
  { addr: 0x6203, val: 0x90, frame: 1040, dur: null }, // MARIO_X >= 0x80 -> blink-OFF arm
];

// The makeMachine factory the core engine drives, extended to attach BOTH the
// coin+start inputTape and the BOARD=4 + MARIO_X pokes. Called with no argument for
// the baseline (pure oracle) and with the wrapped override map for the optimized side
// — both get the SAME tape and the SAME pokes (fresh copies so neither side mutates
// the other's).
function makeMachine(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  m.pokes = STATE_POKES.map((p) => ({ ...p }));
  return m;
}

/**
 * Deliberately-broken twin: behaviourally optimized_04f9 EXCEPT the store to 0x6901
 * lands a wrong value (the correct byte XOR 0xFF, guaranteed to differ). Intercepting
 * exactly that one write lets the rest of the routine and loc_04ac run verbatim — the
 * representative "wrong value to an address on the routine's path" bug the gate must
 * catch. The `broke` flag is per-call (reset each dispatch), so it breaks loc_04f9's
 * single 0x6901 store on every frame it runs.
 */
function broken_04f9(m) {
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
    return optimized_04f9(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_04f9 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_04f9]]));

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
      `${r.invocations.get(TARGET)}x (per cutscene frame via loc_04be/loc_0509, ~f1041.., BOARD=4 + X>=0x80 poked)`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_04f9 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeMachine, TARGET, translated_04f9, optimized_04f9, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F, A, SP) + pc identical (first entry: frame ~1041)");
});

// -- loc_04ac-EXIT COVERAGE via loc_04f9 --------------------------------------

// Capture the pristine machine at loc_04f9's FIRST dispatch (frame ~1041), via the
// same construction-time snapshot the core unit gate uses. Memoised so the ~1080-
// frame host run happens once, not per branch test.
let ENTRY = null;
function captureEntry() {
  if (ENTRY) return ENTRY;
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_04f9(mm); // let the host run proceed to a clean stop
  }]]);
  const host = makeMachine(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_04f9 never dispatched within ${MAX_FRAMES} frames`);
  ENTRY = entry;
  return ENTRY;
}

// Run oracle vs optimized on two clones of the captured entry, with C poked
// identically on both sides, and diff RAM + regs + pc + cycle total. Returns
// diagnostics incl. the post-run blink-bit signature for both bytes.
function diffExit(c) {
  const entry = captureEntry();
  const a = entry.clone(); // translated
  const b = entry.clone(); // optimized
  const pre6905 = a.mem.read8(BYTE_6905);
  for (const cl of [a, b]) cl.regs.c = c;
  const cA0 = a.cycles, cB0 = b.cycles;
  translated_04f9(a);
  optimized_04f9(b);
  const dA = a.cycles - cA0, dB = b.cycles - cB0;

  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return {
    ram,
    regs,
    pcEq: a.pc === b.pc,
    dA,
    dB,
    pre6905,
    v6901: a.mem.read8(BYTE_6901),
    v6905: a.mem.read8(BYTE_6905),
    blink6901: (a.mem.read8(BYTE_6901) >> 7) & 1,
    blink6905: (a.mem.read8(BYTE_6905) >> 7) & 1,
  };
}

function assertExitEqual(r, expectedCycles) {
  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)} (${r.ram.a} vs ${r.ram.b})` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.ok(r.pcEq, "pc must match");
  assert.equal(r.dA, r.dB, `cycle-total mismatch (translated ${r.dA} vs optimized ${r.dB})`);
  assert.equal(r.dA, expectedCycles, `cycle total ${r.dA} != expected ${expectedCycles} (wrong loc_04ac exit / charge)`);
  // loc_04f9 ALWAYS clears bit7 of 0x6901 (its own store), on every exit.
  assert.equal(r.blink6901, 0, "loc_04f9 must clear 0x6901 bit7 (blink OFF)");
}

test("EXIT-1 via loc_04f9 (unit): C bit6 clear -> ret z, blink OFF, no re-flip EQUAL (RAM+regs+pc+95t)", () => {
  const r = diffExit(0x00);
  assertExitEqual(r, 95);
  // No xor: 0x6905 == (entry 0x6905)&0x7f, bit7 clear.
  assert.equal(r.v6905, (r.pre6905 & 0x7f) & 0xff, "EXIT-1 must publish (0x6905)&0x7f unflipped");
  assert.equal(r.blink6905, 0, "EXIT-1 leaves 0x6905 bit7 CLEAR");
  console.log(`  EXIT-1: C=0x00 EQUAL, 0x6901 bit7 OFF, 0x6905=0x${r.v6905.toString(16)} (unflipped), cycles match (${r.dA} t)`);
});

test("EXIT-2 via loc_04f9 (unit): C bit6 set, C%8!=0 -> ret nz, blink OFF, no re-flip EQUAL (RAM+regs+pc+115t)", () => {
  const r = diffExit(0x41);
  assertExitEqual(r, 115);
  assert.equal(r.v6905, (r.pre6905 & 0x7f) & 0xff, "EXIT-2 must publish (0x6905)&0x7f unflipped");
  assert.equal(r.blink6905, 0, "EXIT-2 leaves 0x6905 bit7 CLEAR");
  console.log(`  EXIT-2: C=0x41 EQUAL, 0x6901 bit7 OFF, 0x6905=0x${r.v6905.toString(16)} (unflipped), cycles match (${r.dA} t)`);
});

test("EXIT-3 via loc_04f9 (unit): C bit6 set, C%8==0 -> xor 0x03 re-flips 0x6905 EQUAL (RAM+regs+pc+143t)", () => {
  const r = diffExit(0x40);
  assertExitEqual(r, 143);
  // xor 0x03: low 2 bits of (0x6905&0x7f) flipped, bit7 untouched (still clear).
  assert.equal(r.v6905, ((r.pre6905 & 0x7f) ^ 0x03) & 0xff, "EXIT-3 must re-flip 0x6905 low 2 bits (xor 0x03)");
  assert.equal(r.blink6905, 0, "EXIT-3 leaves 0x6905 bit7 CLEAR (xor 0x03 does not touch bit7)");
  console.log(`  EXIT-3: C=0x40 EQUAL, 0x6901 bit7 OFF, 0x6905=0x${r.v6905.toString(16)} (xor-flipped), cycles match (${r.dA} t)`);
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong 0x6901 store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeMachine, MAX_FRAMES, new Map([[TARGET, broken_04f9]]));

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
  const r = unitEquivalence(makeMachine, TARGET, translated_04f9, broken_04f9, { maxFrames: MAX_FRAMES });

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
