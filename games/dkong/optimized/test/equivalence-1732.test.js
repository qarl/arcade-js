// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_1732 (the board-advance sub-state guard:
 * @0x1623 rst-0x28 table index 3). It is dispatched from INSIDE the vblank NMI
 * during BOARD-ADVANCE: dispatchGameState(GAME_STATE(0x6005)==3) -> loc_06fe ->
 * loc_1615 (GAME_SUBSTATE(0x600A)==0x16) -> rst 0x28 on the 0x6388 selector, via
 * the @0x1623 table when BOARD(0x6227) bit0 is set and 0x6388==3. It always first
 * calls sub_306f, then reads a phase counter at 0x6913: A >= 0x2C HOLDS (ret nc,
 * no stores); A < 0x2C RESETs the object block (0x6900/04/0C = 0, 0x6924/0x692C =
 * 0x6B/0x6A), bumps 0x6A21, and advances the 0x6388 sub-state selector.
 *
 * Seven jobs -- the loc_17b6 force-poke pattern (reach a deep in-game sub-state
 * with an identical-both-sides poke) PLUS the two-branch coverage sub_1732 needs:
 *
 *   1. EQUAL (whole/unit) -- optimized sub_1732 reads EQUAL against its oracle.
 *      The override routes through dispatchGameState's override consult (nmi.js),
 *      inert when the map is empty.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. sub_1732
 *      runs only deep in board-advance, which a bounded boot never reaches, so the
 *      tests FORCE it with an IDENTICAL-BOTH-SIDES poke (Karl's sanctioned "poke
 *      the board state to reach a state for validation"): from frame 100 it HOLDS
 *      GAME_STATE=3, GAME_SUBSTATE=0x16, BOARD(0x6227)=1 (bit0 set -> @0x1623
 *      table), selector 0x6388=3 (index 3 -> sub_1732), and phase 0x6913=0 (< 0x2C
 *      -> the RESET branch, so its stores actually fire). Held across the window so
 *      sub_1732 dispatches every frame (~41x).
 *
 *   3. TEETH (whole/unit) -- a deliberately-broken twin (the 0x6924 seed store
 *      lands the wrong value) must be CAUGHT: NOT-EQUAL, naming 0x6924. 0x6924 is
 *      written exactly once, by sub_1732, and persists to the frame boundary.
 *
 *   4. FULL BRANCH COVERAGE -- BOTH data-dependent branches proven EQUAL (RAM +
 *      all registers incl. F + pc) on a captured entry: RESET (0x6913 < 0x2C, the
 *      branch the driven run takes) and HOLD (0x6913 forced >= 0x2C). Each also
 *      pins its collapsed CYCLE TOTAL against the oracle and shows a 1-cycle error
 *      is caught -- HOLD is not reached by the whole-machine run, so its committed
 *      cycle teeth live here.
 *
 *   5. CYCLE (whole-machine) -- a WRONG collapsed total (RESET ret 156 not 157) is
 *      CAUGHT and NOT-EQUAL, proving the collapsed total is load-bearing.
 *
 * THE CYCLE FINDING this routine adds: sub_1732 is ATOMIC because it is dispatched
 * ONLY from inside the NMI (nothing m.call's 0x1732), where the mask is held -- the
 * vblank NMI can never land inside it OR inside its one callee sub_306f. So its 16
 * post-call per-instruction m.step charges collapse to one m.ret per branch (HOLD
 * 31 t, RESET 157 t); the 17 t call charge stays before m.call(0x306f) so the
 * callee still starts at the oracle's exact cumulative cycle. The TOTAL stays
 * load-bearing -- as part of the NMI's cost it sets the main-loop vblank-spin count
 * (README §2) -- so a wrong 156 diverges at STACK 0x6BFB (an NMI-pushed PC in
 * diffed stack RAM), the same downstream-landing mechanism as loc_17b6/entry_0611.
 * sub_1732 makes NO hardware writes (all stores are work RAM), so the collapse has
 * no --writes-trace consequence and there is no write-trace test.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_1732 as translated_1732 } from "../../translated/state0.js";
import { sub_1732 as optimized_1732 } from "../sub_1732.js";
import { Machine } from "../../machine.js";
import {
  wholeMachineEquivalence as coreWholeMachineEquivalence,
  unitEquivalence as coreUnitEquivalence,
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

const TARGET = 0x1732;
const POKE_FRAME = 100;
const HOLD_DUR = 40; // held so sub_1732 dispatches every frame of the window
const FRAMES = 140;
const CALLEE = 0x306f;
const OWN_RESET = 174; // sub_1732's own charge on the RESET branch (callee excluded): 17 + 157
const OWN_HOLD = 48; //  sub_1732's own charge on the HOLD branch:               17 + 31
const RESET_RET = 157; // the collapsed RESET-branch m.ret total
const HOLD_RET = 31; //   the collapsed HOLD-branch  m.ret total
const BROKEN_ADDR = 0x6924; // the seed store (0x6B); written once by sub_1732, persists

// Identical-both-sides poke that forces board-advance / the @0x1623 table / selector
// 3 / phase 0 (RESET). Held so sub_1732 dispatches every frame. 0x6913=0 makes the
// RESET branch (the one with stores) run, so the whole-machine TEETH store fires.
function forcePoke(v6913) {
  return [
    { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_STATE = 3 (in-game)
    { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_SUBSTATE = 0x16 (board-advance)
    { addr: 0x6227, val: 0x01, frame: POKE_FRAME, dur: HOLD_DUR }, // BOARD bit0 set -> @0x1623 table
    { addr: 0x6388, val: 0x03, frame: POKE_FRAME, dur: HOLD_DUR }, // selector 3 -> sub_1732
    { addr: 0x6913, val: v6913, frame: POKE_FRAME, dur: HOLD_DUR }, // phase counter -> branch
  ];
}

// The engine's factory: a DK Machine on this ROM with the force poke loaded. Both
// baseline and optimized get the SAME poke, so state forcing is applied identically.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = forcePoke(0x00).map((p) => ({ ...p })); // RESET branch drives the whole-machine run
  return m;
};

// Broken twin: byte-for-byte optimized_1732 EXCEPT the first store to 0x6924 lands
// the correct value XOR 0xFF (guaranteed to differ). Intercepting exactly that one
// write lets the rest of the routine and sub_306f run verbatim -- the representative
// "wrong value to one of the routine's own output addresses" bug the gate must catch.
function broken_1732(m) {
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
    return optimized_1732(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// A WRONG-total twin: byte-for-byte optimized_1732 but charges (targetCyc - 1) for
// the collapsed branch ret instead of targetCyc. sub_1732's collapsed ret uses a
// unique total (157 RESET / 31 HOLD), so keying on it hits exactly that ret and
// leaves sub_306f's own 10/11-cycle rets alone. Proves the collapsed total has
// teeth -- a cheaper NMI shifts where a later frame's NMI lands in diffed stack RAM.
function wrongTotal_1732(targetCyc) {
  return (m) => {
    const realRet = m.ret.bind(m);
    m.ret = (cyc = 10) => realRet(cyc === targetCyc ? cyc - 1 : cyc);
    try {
      return optimized_1732(m);
    } finally {
      m.ret = realRet;
    }
  };
}

// -- pristine-entry capture (for the isolated branch / cycle checks) --------------

/** Capture the machine the instant sub_1732 is FIRST entered (RESET-branch poke). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_1732(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("sub_1732 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Run `fn` on a fresh clone of the entry (optionally forcing 0x6913 first). */
function runClone(fn, set6913) {
  const c = ENTRY.clone();
  if (set6913 !== undefined) c.mem.write8(0x6913, set6913);
  fn(c);
  return c;
}

/** sub_1732's OWN cycle charge: run on a clone with the callee stubbed to charge
 *  nothing, so the m.cycles delta is exactly sub_1732's own contribution. */
function ownCycles(fn, set6913) {
  const c = ENTRY.clone();
  if (set6913 !== undefined) c.mem.write8(0x6913, set6913);
  c.routines.set(CALLEE, () => {}); // no-op, charges nothing
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

/** RAM + register + pc diff of two machines that each ran a routine to completion. */
function diff(a, b) {
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.regs, b.regs);
  return { ram, regs, pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc } };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_1732 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_1732]]));

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
      `override fired ${r.invocations.get(TARGET)}x (board-advance RESET, forced)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_1732 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1732, optimized_1732, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong seed store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_1732]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong seed store is CAUGHT and names 0x6924", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1732, broken_1732, { maxFrames: FRAMES });

  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} ` +
      `(translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});

// -- FULL BRANCH COVERAGE (both arms EQUAL + cycle total, in isolation) --------

test("BRANCH reset (0x6913 < 0x2C): EQUAL + collapsed cycle total 157 preserved", () => {
  // The branch the driven whole-machine run takes; pinned in isolation here too.
  const a = runClone(translated_1732, 0x00);
  const b = runClone(optimized_1732, 0x00);
  const d = diff(a, b);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)} (t ${d.ram.a} vs o ${d.ram.b})` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg} (t ${d.regs.a} vs o ${d.regs.b})` : "");
  assert.equal(d.pc, null, "pc must match");

  const oracleOwn = ownCycles(translated_1732, 0x00);
  const optOwn = ownCycles(optimized_1732, 0x00);
  assert.equal(oracleOwn, OWN_RESET, "oracle RESET own-cycles != 174");
  assert.equal(optOwn, oracleOwn, `RESET cycle total drifted: optimized ${optOwn} vs oracle ${oracleOwn}`);

  // ...and the cycle assertion is not vacuous: a 1-cycle error in the collapsed ret
  // makes the totals disagree.
  const wrongOwn = ownCycles(wrongTotal_1732(RESET_RET), 0x00);
  assert.notEqual(wrongOwn, oracleOwn, "RESET cycle-total assertion has no teeth");
  console.log(`  BRANCH reset: EQUAL; own total ${optOwn}t == oracle ${oracleOwn}t; wrong (${wrongOwn}t) caught`);
});

test("BRANCH hold (0x6913 >= 0x2C): EQUAL + collapsed cycle total 31 preserved", () => {
  // Not reached by the whole-machine run, so its committed cycle teeth live here.
  const a = runClone(translated_1732, 0xff);
  const b = runClone(optimized_1732, 0xff);
  const d = diff(a, b);
  assert.equal(d.ram, null, d.ram ? `RAM diff at 0x${d.ram.addr.toString(16)} (t ${d.ram.a} vs o ${d.ram.b})` : "");
  assert.equal(d.regs, null, d.regs ? `reg diff at ${d.regs.reg} (t ${d.regs.a} vs o ${d.regs.b})` : "");
  assert.equal(d.pc, null, "pc must match");

  const oracleOwn = ownCycles(translated_1732, 0xff);
  const optOwn = ownCycles(optimized_1732, 0xff);
  assert.equal(oracleOwn, OWN_HOLD, "oracle HOLD own-cycles != 48");
  assert.equal(optOwn, oracleOwn, `HOLD cycle total drifted: optimized ${optOwn} vs oracle ${oracleOwn}`);

  const wrongOwn = ownCycles(wrongTotal_1732(HOLD_RET), 0xff);
  assert.notEqual(wrongOwn, oracleOwn, "HOLD cycle-total assertion has no teeth");
  console.log(`  BRANCH hold: EQUAL; own total ${optOwn}t == oracle ${oracleOwn}t; wrong (${wrongOwn}t) caught`);
});

// -- CYCLE (whole-machine): the collapsed total is load-bearing downstream ------

test("CYCLE (whole-machine): a WRONG collapsed total (RESET 156) is CAUGHT and NOT-EQUAL", () => {
  // sub_1732 runs inside the NMI, whose total cost sets the main-loop vblank-spin
  // count (PRNG entropy) and where a LATER frame's NMI lands in diffed stack RAM.
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongTotal_1732(RESET_RET)]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong collapsed total slipped through — the total has no teeth");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  CYCLE/whole: wrong total 156 caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});
