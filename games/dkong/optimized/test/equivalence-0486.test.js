// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0486 (the "redraw the colour columns" tail of
 * the per-frame intro / attract colour-cycle animation: read the phase counter
 * 0x6390 into C, pick this frame's colour byte from BOARD and the phase, then
 * tail-call loc_04a1 / loc_04a3 / loc_04be). loc_0486 is a LEAF reached only via
 * `m.call` -- SEVEN ways, all inside the loc_197a per-frame colour cascade
 * (loc_0413's FRAME!=0 idle branch is how it runs in practice, plus loc_0426 /
 * loc_0450 ×2 / loc_0464 / loc_0478). Every caller is interruptible with the NMI
 * mask ENABLED, so loc_0486 is NOT atomic: its per-instruction cycle charges are
 * kept (handler_01c3 rung), not collapsed -- the same decision, for the same
 * reason, as its parent loc_0413.
 *
 * DISPATCH REQUIRES DRIVEN INPUT. loc_0486 never runs in the boot attract loop
 * (its caller chain -- loc_197a -> entry_03fb -> loc_0413 -- only runs once a game
 * is in progress); a pure-attract run never enters it. So these tests DRIVE a
 * coin + start-1 input tape and reach gameplay, where loc_0486 first dispatches at
 * frame 1033 and then every frame loc_0413 does. The standard harness.js
 * makeMachine factory cannot inject an input tape, so the tests build the CORE
 * equivalence engine on a local tape-injecting factory (`makeDriven`) -- the tape
 * is applied IDENTICALLY to the baseline and optimized sides (both come from the
 * same factory), which is the property the gate requires.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- optimized loc_0486 reads EQUAL against its oracle
 *      every frame across a 1830-frame driven run. The override must fire (or EQUAL
 *      is vacuous); it fires 274x in this window.
 *
 *   2. EQUAL (unit) -- oracle vs optimized leave identical RAM + all registers
 *      (incl. F) + pc at the first natural entry (frame 1033).
 *
 *   3. FULL BRANCH COVERAGE (unit) -- loc_0486 has four data-dependent exits
 *      (BOARD==4 -> loc_04be; phase==0 -> loc_04a1; phase!=0 & bit6 set -> loc_04a3
 *      keeping colour 0xEF; phase!=0 & bit6 clear -> fall into loc_04a1, colour
 *      0x10). The 1830-frame whole-machine run only reaches the phase==0 and
 *      bit6-clear arms naturally (BOARD is 1 throughout and the phase never enters
 *      its high half on the reached frames), so BOARD==4 and the bit6-set arm are
 *      SYNTHESISED by forcing the deciding bytes (0x6227 / 0x6390) on cloned
 *      entries. Each of the four is proven EQUAL, with a sanity check that the
 *      forced paths genuinely diverge (the pokes are not vacuous): the bit6-set arm
 *      reaches loc_04ac's EXIT-3 and FLIPS the low 2 bits of 0x6905, while the
 *      phase==0 arm reaches EXIT-1 and leaves 0x6905 untouched. (Per-instruction
 *      routine, so no collapsed-branch cycle-total assertion is needed.)
 *
 *   4. TEETH (whole-machine) -- a broken twin whose first colour-column store lands
 *      a wrong value is CAUGHT (NOT-EQUAL, names the address).
 *
 *   5. TEETH (unit) -- the same broken store is CAUGHT and names 0x75C4.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { loc_0486 as translated_0486 } from "../../translated/state0.js";
import { loc_0486 as optimized_0486 } from "../loc_0486.js";
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

const TARGET = 0x0486;
const FRAMES = 1830; // loc_0486 first fires at frame 1033; fires 274x in this window
const MAX_FRAMES = 1100; // reach the first entry (frame 1033) for the unit gate

// Coin then start-1 (IN2 @ port 0x7d00, coin1 = bit7, start1 = bit2). Drives the
// ROM's own credit/start logic into gameplay, where loc_197a -> ... -> loc_0486 runs.
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

// The first colour-column store on loc_0486's natural path is sub_0514 writing VRAM
// 0x75C4 (via the loc_04a1/loc_04a3 tail; hl is loaded 0x75C4 unconditionally in
// loc_04a3). It is written on every fire while BOARD != 4, so it is a stable teeth
// target -- the same one the parent loc_0413 uses.
const BROKEN_ADDR = 0x75c4;

/**
 * Deliberately-broken twin: the optimized handler EXCEPT the first store to
 * 0x75C4 lands a wrong value (correct XOR 0xFF, guaranteed to differ). Intercepting
 * exactly that one write lets the rest of the routine and every subroutine it calls
 * run verbatim -- the representative "wrong value to one of the routine's own output
 * addresses" bug the gate must catch.
 */
function broken_0486(m) {
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
    return optimized_0486(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/** Capture the pristine machine state at loc_0486's first entry, for the branch tests. */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0486(mm);
  }]]);
  const host = makeDriven(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_0486 never entered within ${MAX_FRAMES} frames`);
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

test("EQUAL (whole-machine): idiomatic optimized loc_0486 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeDriven, FRAMES, new Map([[TARGET, optimized_0486]]));

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

test("EQUAL (unit): idiomatic optimized loc_0486 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeDriven, TARGET, translated_0486, optimized_0486, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- FULL BRANCH COVERAGE -----------------------------------------------------

test("BRANCH COVERAGE (unit): each of loc_0486's four exits is EQUAL", () => {
  const entry = captureEntry();

  // Force each exit by the deciding bytes: BOARD (0x6227) and the phase counter
  // (0x6390). Same poke applied to both the oracle and the optimized clone.
  const branches = {
    "BOARD==4 -> loc_04be": (m) => { m.mem.write8(0x6227, 4); },
    "phase==0 -> loc_04a1 (0x10)": (m) => { m.mem.write8(0x6227, 1); m.mem.write8(0x6390, 0x00); },
    "phase!=0 bit6 set -> loc_04a3 (0xEF)": (m) => { m.mem.write8(0x6227, 1); m.mem.write8(0x6390, 0x40); },
    "phase!=0 bit6 clear -> loc_04a1 (0x10)": (m) => { m.mem.write8(0x6227, 1); m.mem.write8(0x6390, 0x20); },
  };

  const dumps = {};
  for (const [name, poke] of Object.entries(branches)) {
    const d = diffClones(entry, translated_0486, optimized_0486, poke);
    assert.equal(d.ram, null, d.ram ? `${name}: RAM diff at 0x${d.ram.addr.toString(16)}` : "");
    assert.equal(d.regs, null, d.regs ? `${name}: reg diff at ${d.regs?.reg}` : "");
    assert.equal(d.pc, null, `${name}: pc must match`);
    dumps[name] = d.dumpA;
  }

  // Sanity: the genuinely-different arms produce different RAM, so the pokes really
  // selected different code paths (the EQUAL results above are not vacuous).
  const kBoard = "BOARD==4 -> loc_04be";
  const kZero = "phase==0 -> loc_04a1 (0x10)";
  const kSet = "phase!=0 bit6 set -> loc_04a3 (0xEF)";
  const kClr = "phase!=0 bit6 clear -> loc_04a1 (0x10)";
  assert.ok(firstStateDiff(dumps[kBoard], dumps[kZero]), "BOARD==4 and phase==0 should take different paths");
  assert.ok(firstStateDiff(dumps[kZero], dumps[kSet]), "phase==0 and bit6-set should take different paths");
  assert.ok(firstStateDiff(dumps[kSet], dumps[kClr]), "bit6-set and bit6-clear should take different paths");

  // Behavioural distinctness with teeth: the bit6-set arm reaches loc_04ac EXIT-3
  // and FLIPS the low 2 bits of 0x6905; the phase==0 arm reaches EXIT-1 and leaves
  // 0x6905 untouched. So the pokes drove observably different exits, not just a
  // different value into the poked byte.
  const V = entry.clone().mem.read8(0x6905);

  const cSet = entry.clone();
  branches[kSet](cSet);
  optimized_0486(cSet);
  assert.equal(cSet.mem.read8(0x6905), V ^ 0x03, "bit6-set arm must flip low 2 bits of 0x6905 (EXIT-3)");

  const cZero = entry.clone();
  branches[kZero](cZero);
  optimized_0486(cZero);
  assert.equal(cZero.mem.read8(0x6905), V, "phase==0 arm must leave 0x6905 unchanged (EXIT-1)");

  console.log("  BRANCH/unit: all 4 exits EQUAL; forced paths distinct; bit6-set flips 0x6905, phase==0 does not");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong colour-column store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeDriven, FRAMES, new Map([[TARGET, broken_0486]]));

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
  const r = unitEquivalence(makeDriven, TARGET, translated_0486, broken_0486, { maxFrames: MAX_FRAMES });

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
