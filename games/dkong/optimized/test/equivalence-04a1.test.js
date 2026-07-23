// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_04a1 (the "low colour code = 0x10" preset arm
 * of the colour-cycle tail: `ld a,0x10` then fall into loc_04a3, the VRAM colour-
 * column fill). loc_04a1 is a LEAF reached only via `m.call` -- from loc_0486, on
 * the interruptible main-loop cascade (loc_197a -> entry_03fb -> loc_0413 ->
 * loc_0486, NMI mask ENABLED). It is therefore NOT atomic; being one instruction
 * its per-instruction charge (7t) is also its whole total, so there is nothing to
 * collapse -- the single `m.step(0x04a3, 7)` is kept at the oracle's cycle.
 *
 * SINGLE PATH. loc_04a1 has NO data-dependent branch: it unconditionally loads
 * A=0x10 and tail-jumps loc_04a3, regardless of any input. "Full branch coverage"
 * is therefore the one path -- proven EQUAL at its natural entry AND across a
 * spread of synthesised entry states (varying C, which selects the DOWNSTREAM
 * loc_04ac exit reached through loc_04a1's fall-through), which shows the rewrite
 * is a faithful, input-independent copy. NB loc_04a1's NATURAL entry always has
 * bit6(C)=0 (loc_0486 only jumps/falls here when the counter is 0 or bit6 clear),
 * so loc_04ac's EXIT-1 (`ret z`) is the natural exit; the bit6=1 pokes below just
 * further confirm the equivalence holds on states loc_0486 never actually sends.
 *
 * DISPATCH REQUIRES DRIVEN INPUT. loc_04a1 never runs in the boot attract loop
 * (its caller chain runs only once a game is in progress); a pure-attract run
 * never enters it. So these tests DRIVE a coin + start-1 input tape and reach
 * gameplay, where loc_04a1 first dispatches at frame 1033 and then most frames
 * after (274x in the 1830-frame window -- the same path count as loc_0413). The
 * standard harness.js makeMachine factory cannot inject an input tape, so the
 * tests build the CORE equivalence engine on a local tape-injecting factory
 * (`makeDriven`) -- the tape is applied IDENTICALLY to the baseline and optimized
 * sides (both come from the same factory), the property the gate requires.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- optimized loc_04a1 reads EQUAL against its oracle
 *      every frame across an 1830-frame driven run. The override must fire (or
 *      EQUAL is vacuous); it fires 274x in this window.
 *
 *   2. EQUAL (unit) -- oracle vs optimized leave identical RAM + all registers
 *      (incl. F) + pc at the first natural entry (frame 1033).
 *
 *   3. PATH COVERAGE (unit) -- the single path is proven EQUAL at the natural
 *      entry AND on a synthesised entry that forces the other RAM-observable
 *      downstream loc_04ac exit (C=0x00 EXIT-1 vs C=0x40 EXIT-3, the blink flip of
 *      0x6905), with a sanity check that the two forced states genuinely diverge
 *      (pokes not vacuous), plus the load-bearing constant check: after the
 *      routine, VRAM 0x75C4 == 0x10 EVEN when A is poked to garbage at entry --
 *      proving loc_04a1 overwrites A with 0x10. (Single-instruction, per-
 *      instruction routine -- no collapsed-branch cycle-total assertion is needed.)
 *
 *   4. TEETH (whole-machine) -- a broken twin whose first colour-column store
 *      lands a wrong value is CAUGHT (NOT-EQUAL, names the address).
 *
 *   5. TEETH (unit) -- the same broken store is CAUGHT and names 0x75C4.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { loc_04a1 as translated_04a1 } from "../../translated/state0.js";
import { loc_04a1 as optimized_04a1 } from "../loc_04a1.js";
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

const TARGET = 0x04a1;
const FRAMES = 1830; // loc_04a1 first fires at frame 1033; fires 274x in this window
const MAX_FRAMES = 1100; // reach the first entry (frame 1033) for the unit gate

// Coin then start-1 (IN2 @ port 0x7d00, coin1 = bit7, start1 = bit2). Drives the
// ROM's own credit/start logic into gameplay, where loc_197a -> entry_03fb ->
// loc_0413 -> loc_0486 -> loc_04a1 runs.
const TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 8, dur: 8 },
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 8 },
];

// The CORE engine's makeMachine factory, but building a DK Machine WITH the input
// tape. Every machine the engine constructs (baseline and optimized) comes from
// here, so the tape is identical on both sides. A fresh copy of the tape per call
// keeps the entries from being shared/mutated across machines.
function makeDriven(overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = TAPE.map((t) => ({ ...t }));
  return m;
}

// The first (and only, on loc_04a1's path) colour-column store is sub_0514 writing
// VRAM 0x75C4 (via the loc_04a3 tail loc_04a1 falls into; hl is loaded 0x75C4
// unconditionally there). The value written is loc_04a1's own A = 0x10, so this is
// loc_04a1's immediate observable output and a stable teeth target.
const BROKEN_ADDR = 0x75c4;

/**
 * Deliberately-broken twin: the optimized handler EXCEPT the first store to
 * 0x75C4 lands a wrong value (correct XOR 0xFF, guaranteed to differ). Intercepting
 * exactly that one write lets the rest of the routine and every subroutine it calls
 * run verbatim -- the representative "wrong value to one of the routine's own output
 * addresses" bug the gate must catch.
 */
function broken_04a1(m) {
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
    return optimized_04a1(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/** Capture the pristine machine state at loc_04a1's first entry, for the path tests. */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_04a1(mm);
  }]]);
  const host = makeDriven(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_04a1 never entered within ${MAX_FRAMES} frames`);
  return entry;
}

/** Run fnA and fnB on independent clones of `entry` (after an optional poke) and diff. */
function diffClones(entry, fnA, fnB, poke) {
  const a = entry.clone();
  const b = entry.clone();
  if (poke) { poke(a); poke(b); }
  fnA(a);
  fnB(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
    dumpA: a.dumpState(),
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized loc_04a1 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeDriven, FRAMES, new Map([[TARGET, optimized_04a1]]));

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
      `override fired ${r.invocations.get(TARGET)}x`,
  );
});

test("EQUAL (unit): idiomatic optimized loc_04a1 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeDriven, TARGET, translated_04a1, optimized_04a1, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- PATH COVERAGE ------------------------------------------------------------

test("PATH COVERAGE (unit): loc_04a1's single path is EQUAL, natural + synthesised entries", () => {
  const entry = captureEntry();

  // The single path, exercised at two synthesised entries that force distinct
  // DOWNSTREAM loc_04ac exits (reached through loc_04a1's fall-through). C selects
  // that exit -- the only RAM-observable downstream fork is the blink flip of
  // (0x6905):
  //   C=0x00: bit6==0            -> loc_04ac EXIT-1 (`ret z`); 0x6905 unchanged
  //           [this is loc_04a1's NATURAL exit -- loc_0486 only reaches here bit6=0]
  //   C=0x40: bit6==1, (C&7)==0  -> loc_04ac EXIT-3 (`xor 0x03`); 0x6905 flipped
  // The point is oracle==optimized on EACH, and the two forced states differ.
  const paths = {
    "bit6=0 -> EXIT-1 (natural; 0x6905 unchanged)": (m) => { m.regs.c = 0x00; },
    "bit6=1 -> EXIT-3 (blink flip; 0x6905 ^= 3)":   (m) => { m.regs.c = 0x40; },
  };

  const dumps = {};
  for (const [name, poke] of Object.entries(paths)) {
    const d = diffClones(entry, translated_04a1, optimized_04a1, poke);
    assert.equal(d.ram, null, d.ram ? `${name}: RAM diff at 0x${d.ram.addr.toString(16)}` : "");
    assert.equal(d.regs, null, d.regs ? `${name}: reg diff at ${d.regs?.reg}` : "");
    assert.equal(d.pc, null, `${name}: pc must match`);
    dumps[name] = d.dumpA;
  }

  // Sanity: the two forced states genuinely differ, so the pokes are not vacuous
  // (the EQUAL results above compare real, distinct downstream paths).
  const [k0, k1] = Object.keys(dumps);
  assert.ok(firstStateDiff(dumps[k0], dumps[k1]), "bit6=0 and bit6=1 should differ downstream");

  // Load-bearing constant: loc_04a1 sets A=0x10 unconditionally, which sub_0514
  // fills to VRAM 0x75C4. Poke A to garbage at entry and confirm 0x75C4 is still
  // 0x10 -- proving loc_04a1 overwrites A with its constant (input-independent).
  const c = entry.clone();
  c.regs.a = 0xaa;
  c.regs.c = 0x00; // natural bit6=0 so the column fill runs to completion
  optimized_04a1(c);
  assert.equal(c.mem.read8(0x75c4), 0x10, "loc_04a1 must set A=0x10 -> VRAM 0x75C4 == 0x10");

  console.log("  PATH/unit: single path EQUAL on EXIT-1 + EXIT-3 downstream entries; 0x75C4==0x10");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong colour-column store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeDriven, FRAMES, new Map([[TARGET, broken_04a1]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong colour-column store is CAUGHT and names 0x75C4", () => {
  const r = unitEquivalence(makeDriven, TARGET, translated_04a1, broken_04a1, { maxFrames: MAX_FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
