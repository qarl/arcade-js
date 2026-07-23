// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for loc_0413 (the head of the per-frame colour-cycle /
 * intro-animation update: gate on the 0x6391 "active" latch and FRAME, then route
 * to loc_0426 / loc_0486). loc_0413 is a LEAF reached only via `m.call` -- from
 * entry_03fb (which the loc_197a main-loop cascade drives every frame) and from the
 * scheduled task entry_0400. Both callers are interruptible with the NMI mask
 * ENABLED, so loc_0413 is NOT atomic: its per-instruction cycle charges are kept
 * (handler_01c3 rung), not collapsed.
 *
 * DISPATCH REQUIRES DRIVEN INPUT. loc_0413 never runs in the boot attract loop
 * (its caller chain -- loc_197a -> entry_03fb -- only runs once a game is in
 * progress); a 900-frame pure-attract run never enters it. So these tests DRIVE a
 * coin + start-1 input tape and reach gameplay, where loc_0413 first dispatches at
 * frame 1033 and then every frame after. The standard harness.js makeMachine
 * factory cannot inject an input tape, so the tests build the CORE equivalence
 * engine on a local tape-injecting factory (`makeDriven`) -- the tape is applied
 * IDENTICALLY to the baseline and optimized sides (both come from the same
 * factory), which is the property the gate requires.
 *
 * Five jobs:
 *
 *   1. EQUAL (whole-machine) -- optimized loc_0413 reads EQUAL against its oracle
 *      every frame across a 1830-frame driven run. The override must fire (or EQUAL
 *      is vacuous); it fires 274x in this window.
 *
 *   2. EQUAL (unit) -- oracle vs optimized leave identical RAM + all registers
 *      (incl. F) + pc at the first natural entry (frame 1033, the FRAME!=0 branch).
 *
 *   3. FULL BRANCH COVERAGE (unit) -- loc_0413 has three data-dependent branches
 *      (latch set -> loc_0426; latch clear & FRAME!=0 -> loc_0486; latch clear &
 *      FRAME==0 -> arm 0x6391 then loc_0426). The 1830-frame whole-machine run
 *      exercises all three naturally, but each is ALSO proven EQUAL in isolation by
 *      forcing the deciding bytes (0x6391 / 0x601a) on cloned entries -- with a
 *      sanity check that the three forced paths genuinely diverge from each other,
 *      so the pokes are not vacuous. (Per-instruction routine, so no collapsed-
 *      branch cycle-total assertion is needed.)
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
import { loc_0413 as translated_0413 } from "../../translated/state0.js";
import { loc_0413 as optimized_0413 } from "../loc_0413.js";
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

const TARGET = 0x0413;
const FRAMES = 1830; // loc_0413 first fires at frame 1033; all 3 branches occur by 1803
const MAX_FRAMES = 1100; // reach the first entry (frame 1033) for the unit gate

// Coin then start-1 (IN2 @ port 0x7d00, coin1 = bit7, start1 = bit2). Drives the
// ROM's own credit/start logic into gameplay, where loc_197a -> entry_03fb runs.
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

// The first colour-column store on loc_0413's path is sub_0514 writing VRAM 0x75C4
// (via the loc_0486 -> loc_04a3 tail; hl is loaded 0x75C4 unconditionally there).
// It is written on every fire while BOARD != 4, so it is a stable teeth target.
const BROKEN_ADDR = 0x75c4;

/**
 * Deliberately-broken twin: the optimized handler EXCEPT the first store to
 * 0x75C4 lands a wrong value (correct XOR 0xFF, guaranteed to differ). Intercepting
 * exactly that one write lets the rest of the routine and every subroutine it calls
 * run verbatim -- the representative "wrong value to one of the routine's own output
 * addresses" bug the gate must catch.
 */
function broken_0413(m) {
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
    return optimized_0413(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

/** Capture the pristine machine state at loc_0413's first entry, for the branch tests. */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_0413(mm);
  }]]);
  const host = makeDriven(snap);
  host.runFrames(MAX_FRAMES);
  if (entry === null) throw new Error(`loc_0413 never entered within ${MAX_FRAMES} frames`);
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

test("EQUAL (whole-machine): idiomatic optimized loc_0413 matches translated every frame", () => {
  const r = wholeMachineEquivalence(makeDriven, FRAMES, new Map([[TARGET, optimized_0413]]));

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

test("EQUAL (unit): idiomatic optimized loc_0413 matches translated in RAM + registers", () => {
  const r = unitEquivalence(makeDriven, TARGET, translated_0413, optimized_0413, { maxFrames: MAX_FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- FULL BRANCH COVERAGE -----------------------------------------------------

test("BRANCH COVERAGE (unit): each of loc_0413's three branches is EQUAL", () => {
  const entry = captureEntry();

  // Force each branch by the deciding bytes: 0x6391 (the "active" latch) and
  // FRAME (0x601a). Same poke applied to both oracle and optimized clones.
  const branches = {
    "latch-set -> loc_0426": (m) => { m.mem.write8(0x6391, 1); },
    "latch-clear FRAME!=0 -> loc_0486": (m) => { m.mem.write8(0x6391, 0); m.mem.write8(0x601a, 0x7e); },
    "latch-clear FRAME==0 -> arm+loc_0426": (m) => { m.mem.write8(0x6391, 0); m.mem.write8(0x601a, 0x00); },
  };

  const dumps = {};
  for (const [name, poke] of Object.entries(branches)) {
    const d = diffClones(entry, translated_0413, optimized_0413, poke);
    assert.equal(d.ram, null, d.ram ? `${name}: RAM diff at 0x${d.ram.addr.toString(16)}` : "");
    assert.equal(d.regs, null, d.regs ? `${name}: reg diff at ${d.regs?.reg}` : "");
    assert.equal(d.pc, null, `${name}: pc must match`);
    dumps[name] = d.dumpA;
  }

  // Sanity: the three forced paths genuinely differ from one another, so the pokes
  // actually selected different branches (the EQUAL results above are not vacuous).
  const [k0, k1, k2] = Object.keys(dumps);
  assert.ok(firstStateDiff(dumps[k0], dumps[k1]), "branches 0 and 1 should take different paths");
  assert.ok(firstStateDiff(dumps[k1], dumps[k2]), "branches 1 and 2 should take different paths");
  assert.ok(firstStateDiff(dumps[k0], dumps[k2]), "branches 0 and 2 should take different paths");

  // The FRAME==0 branch is the only one that writes the latch; confirm it armed it.
  const c = entry.clone();
  branches["latch-clear FRAME==0 -> arm+loc_0426"](c);
  optimized_0413(c);
  assert.equal(c.mem.read8(0x6391), 1, "FRAME==0 branch must arm the 0x6391 latch");

  console.log("  BRANCH/unit: all 3 branches EQUAL; forced paths pairwise distinct; latch armed");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong colour-column store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(makeDriven, FRAMES, new Map([[TARGET, broken_0413]]));

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
  const r = unitEquivalence(makeDriven, TARGET, translated_0413, broken_0413, { maxFrames: MAX_FRAMES });

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
