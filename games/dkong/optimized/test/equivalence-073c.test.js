// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for handler_073c (game state 1 = ATTRACT: step to a
 * credited game when a coin is present, else dispatch the attract sub-state).
 * ROM 0x073C-0x0762. Unlike the task-table routines (05c6/0611/06b8/051c), this is
 * an NMI GAME-STATE handler, dispatched by dispatchGameState from the rst 0x28
 * table at ROM 0x00CA -- so it runs with the NMI mask cleared and is fully atomic.
 *
 * TWO DATA-DEPENDENT BRANCHES on CREDITS (0x6001):
 *   - no-credit (CREDITS == 0): the natural attract path -- read GAME_SUBSTATE and
 *     tail-dispatch it through the inline jump table at 0x0748 (via sub_0028). This
 *     fires every attract frame from ~frame 5, so the input-less harness reaches it
 *     directly.
 *   - credit (CREDITS != 0): GAME_SUBSTATE = 0, GAME_STATE (0x6005) incremented so
 *     the next NMI enters the credited game. Attract never credits a game on its
 *     own, so this branch is SYNTHESISED (a captured entry with CREDITS poked) and,
 *     for the whole-machine gate, driven by an identical CREDITS poke on both sides.
 *
 * The five tests split the work by what each gate can reach:
 *
 *   1. EQUAL (whole-machine, natural = no-credit path) -- the standard
 *      wholeMachineEquivalence; proves the override DISPATCHES (26x over 30 attract
 *      frames) and the no-credit branch is byte-identical, which also verifies its
 *      cycle collapse under live NMI timing.
 *   2. EQUAL (unit, natural no-credit) -- the standard unitEquivalence (its
 *      construction-time snapshot override reaches 0x073C because dispatchGameState
 *      consults m.overrides). RAM + all registers (incl F) + pc identical.
 *   3. EQUAL (credit branch) -- the SYNTHESISED branch: (a) a unit diff on a
 *      captured entry with CREDITS poked (RAM+regs+pc), and (b) a poke-driven
 *      whole-machine EQUAL that runs the credit branch under live NMI timing,
 *      verifying its cycle collapse. Asserts the branch actually fired.
 *   4. TEETH (whole-machine, credit branch) -- pokes CREDITS on BOTH sides so the
 *      credit branch runs, and a broken twin that lands the wrong value in the
 *      routine's own GAME_SUBSTATE store is CAUGHT, naming 0x600A. (The broken
 *      value is chosen safe -- 0->1 -- so state 2 still dispatches a valid handler
 *      and the run does not crash before the divergence is compared.)
 *   5. TEETH (unit, credit branch) -- a wrong GAME_SUBSTATE store on the synthesised
 *      entry is CAUGHT and names 0x600A.
 *
 * CYCLE-COLLAPSE EVIDENCE. handler_073c is ATOMIC (it runs inside the NMI with the
 * mask cleared, so the vblank NMI never lands between its instructions), so each
 * branch's per-instruction m.step charges collapse to ONE per-branch total (credit
 * 78t via m.ret; no-credit 55t via one m.step before m.call(0x0028)). The total is
 * still load-bearing -- the NMI's total cost sets the main-loop spin count / PRNG --
 * so it is preserved exactly (sub_0028 and the sub-state handler keep their own
 * per-instruction charges). Test 1 (no-credit, every attract frame) and test 3b
 * (credit, poke-driven) are the whole-machine runs that verify the collapse under
 * live timing; the unit gates confirm RAM+regs+pc but are cycle-insensitive.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { handler_073c as translated_073c } from "../../translated/nmi.js";
import { handler_073c as optimized_073c } from "../handler_073c.js";
import { unitEquivalence, wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x073c;
const FRAMES = 30; // handler_073c dispatches every attract frame from ~frame 5

// -- RAM addresses this routine touches ---------------------------------------
const CREDITS = 0x6001; // != 0 selects the credit branch (advance the game state)
const GAME_STATE = 0x6005; // top-level state; the credit branch increments it
const GAME_SUBSTATE = 0x600a; // the credit branch's first store (set to 0)

const POKE_FRAME = 20; // attract frame at which we poke a credit
const POKE_RUN = 26; // frames to run the poke-driven whole-machine checks

// -- shared helpers -----------------------------------------------------------

/**
 * Capture the pristine machine at handler_073c's first natural dispatch (the
 * no-credit attract entry). A CONSTRUCTOR override snapshots the entry; the host
 * run continues via the translated oracle so it reaches a clean stop.
 */
function captureEntry(maxFrames = 60) {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_073c(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  if (entry === null) throw new Error(`0x${TARGET.toString(16)} never dispatched in ${maxFrames} frames`);
  return entry;
}

/** Clone a captured no-credit entry and poke a credit in, forcing the credit branch. */
function makeCredit(base, val = 1) {
  const s = base.clone();
  s.mem.write8(CREDITS, val);
  return s;
}

/** Run translated vs `optFn` on independent clones of `entry`; return the diffs. */
function unitDiff(entry, optFn = optimized_073c) {
  const a = entry.clone();
  const b = entry.clone();
  translated_073c(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
  };
}

/**
 * Broken twin, CREDIT BRANCH: behaviourally optimized_073c EXCEPT the first store
 * to GAME_SUBSTATE on the credit branch (`ld (hl),0x00`) lands the wrong value.
 * Gating on CREDITS != 0 targets the routine's OWN credit-branch store, not a
 * sub-state handler's write reached via the no-credit path. `xorMask` picks the
 * corruption: 0x01 (0->1) for the whole-machine gate so state 2 still dispatches a
 * valid handler and the run does not crash; 0xFF for the isolated unit gate.
 */
function makeBrokenCredit(xorMask) {
  return (m) => {
    const realWrite = m.mem.write8.bind(m.mem);
    const credited = m.mem.read8(CREDITS) !== 0;
    let broke = false;
    m.mem.write8 = (addr, value, busOffset) => {
      if (credited && !broke && addr === GAME_SUBSTATE) {
        broke = true;
        return realWrite(addr, (value ^ xorMask) & 0xff, busOffset);
      }
      return realWrite(addr, value, busOffset);
    };
    try {
      return optimized_073c(m);
    } finally {
      m.mem.write8 = realWrite;
    }
  };
}

/**
 * Hand-rolled whole-machine run with a credit poked on both sides at POKE_FRAME
 * (the provided wholeMachineEquivalence can't poke). Returns the per-frame trace,
 * the total dispatch count, and how many of those took the credit branch.
 */
function pokedRun(handler) {
  let fired = 0;
  let takenFired = 0;
  const m = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      fired += 1;
      if (mm.mem.read8(CREDITS) !== 0) takenFired += 1;
      return handler(mm);
    }]]),
  });
  m.pokes = [{ addr: CREDITS, val: 1, frame: POKE_FRAME, dur: 3 }];
  const frames = m.runFrames(POKE_RUN);
  return { frames, fired, takenFired, m };
}

// -- 1. EQUAL (whole-machine, natural = no-credit dispatch path) ---------------

test("EQUAL (whole-machine): optimized handler_073c matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_073c]]));

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
      `${r.invocations.get(TARGET)}x (no-credit dispatch path; attract never self-credits)`,
  );
});

// -- 2. EQUAL (unit, natural no-credit) ---------------------------------------

test("EQUAL (unit): optimized handler_073c matches translated in RAM + registers", () => {
  const r = unitEquivalence(ROM, {}, TARGET, translated_073c, optimized_073c, { maxFrames: 60 });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: no-credit path — RAM + all registers (incl. F, A, HL) + pc identical");
});

// -- 3. EQUAL (credit branch: synthesised unit + poke-driven whole-machine) ----

test("EQUAL (credit branch): optimized handler_073c matches translated (synthesised + live)", () => {
  const base = captureEntry();
  assert.equal(base.mem.read8(CREDITS), 0, "captured entry should be the no-credit attract state");

  // (a) unit diff on the synthesised credit entry. Confirm the scenario really
  //     drives the credit branch: the oracle must advance GAME_STATE, or this is
  //     checking the wrong branch.
  const entry = makeCredit(base);
  const check = entry.clone();
  const before = check.mem.read8(GAME_STATE);
  translated_073c(check);
  assert.equal(check.mem.read8(GAME_STATE), (before + 1) & 0xff, "scenario did not drive the credit branch (GAME_STATE unchanged)");
  assert.equal(check.mem.read8(GAME_SUBSTATE), 0, "credit branch should clear GAME_SUBSTATE");

  const d = unitDiff(entry);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)} (${d.ram.a} vs ${d.ram.b})` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg} (${d.regs.a} vs ${d.regs.b})` : "");
  assert.equal(d.pc, null, "pc must match");

  // (b) poke-driven whole-machine EQUAL: the credit branch under live NMI timing.
  const oracleRun = pokedRun(translated_073c);
  const optRun = pokedRun(optimized_073c);
  assert.ok(oracleRun.takenFired >= 1, "credit branch never fired under the poke");
  assert.equal(oracleRun.fired, optRun.fired, "both sides must dispatch the same number of times");
  let diff = null;
  const n = Math.min(oracleRun.frames.length, optRun.frames.length);
  for (let f = 0; f < n && !diff; f++) {
    const dd = firstStateDiff(oracleRun.frames[f], optRun.frames[f], (o) => oracleRun.m.stateOffsetToAddr(o));
    if (dd) diff = { frame: f, ...dd };
  }
  assert.equal(diff, null, diff ? `credit-branch whole-machine diverged at frame ${diff.frame}, 0x${(diff.addr ?? 0).toString(16)}` : "");

  console.log(
    `  EQUAL/credit: unit RAM+regs+pc identical; poke-driven whole-machine EQUAL over ${n} frames ` +
      `(credit branch fired ${oracleRun.takenFired}x under live NMI timing)`,
  );
});

// -- 4. TEETH (whole-machine, credit branch via identical CREDITS poke) --------

test("TEETH (whole-machine): a wrong GAME_SUBSTATE store on the credit branch is CAUGHT", () => {
  const base = pokedRun(translated_073c); // oracle, poked
  const broken = { fired: 0, takenFired: 0 };
  const brokenFn = makeBrokenCredit(0x01);
  const m = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      broken.fired += 1;
      if (mm.mem.read8(CREDITS) !== 0) broken.takenFired += 1;
      return brokenFn(mm);
    }]]),
  });
  m.pokes = [{ addr: CREDITS, val: 1, frame: POKE_FRAME, dur: 3 }];
  const brokenFrames = m.runFrames(POKE_RUN);

  assert.ok(base.takenFired >= 1, "poke did not drive a credit-branch dispatch");
  assert.equal(base.fired, broken.fired, "both sides must dispatch the same number of times");
  assert.equal(m.stoppedBy, null, `broken run stopped early: ${m.stoppedBy}`);

  let caught = null;
  const n = Math.min(base.frames.length, brokenFrames.length);
  for (let f = 0; f < n && !caught; f++) {
    const d = firstStateDiff(base.frames[f], brokenFrames[f], (o) => base.m.stateOffsetToAddr(o));
    if (d) caught = { frame: f, ...d };
  }
  assert.ok(caught, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(caught.addr, GAME_SUBSTATE, `expected first diff at 0x${GAME_SUBSTATE.toString(16)}, got 0x${(caught.addr ?? 0).toString(16)}`);
  console.log(
    `  TEETH/whole: broken credit-branch store caught at frame ${caught.frame}, ` +
      `0x${caught.addr.toString(16)} (${caught.a} vs ${caught.b})`,
  );
});

// -- 5. TEETH (unit, credit branch) -------------------------------------------

test("TEETH (unit): a wrong GAME_SUBSTATE store is CAUGHT and names 0x600A", () => {
  const entry = makeCredit(captureEntry());
  const d = unitDiff(entry, makeBrokenCredit(0xff));

  assert.ok(d.ram != null, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(
    d.ram.addr,
    GAME_SUBSTATE,
    `expected first diff at the broken address 0x${GAME_SUBSTATE.toString(16)}, got 0x${d.ram.addr.toString(16)}`,
  );
  console.log(`  TEETH/unit: caught at 0x${d.ram.addr.toString(16)} (translated ${d.ram.a} vs broken ${d.ram.b})`);
});
