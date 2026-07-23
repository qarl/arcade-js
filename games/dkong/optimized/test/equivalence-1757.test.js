// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for sub_1757 (a board-advance sequence arm: "once the
 * sprite block is clear, arm the sub-state timer and advance the 0x6388 selector").
 * It is dispatched from INSIDE the vblank NMI during BOARD-ADVANCE:
 * dispatchGameState (GAME_STATE 0x6005 == 3) -> loc_06fe (GAME_SUBSTATE 0x600A ==
 * 0x16) -> loc_1615 -> rst 0x28 on the 0x6388 selector through the BOARD(0x6227)-
 * bit-selected table (0x1623 idx4 when bit0 set, or 0x1637 idx3 when bit1 set) ->
 * this routine. It runs two cull/clamp helpers (0x306F, 0x176C), advances the HL/DE
 * pointer pair, then asks sub_1783 whether the sprite block is clear.
 *
 * Seven jobs (mirrors loc_17b6's board-advance force-poke + adds the SKIP branch):
 *
 *   1. EQUAL (whole-machine) -- optimized sub_1757 reads EQUAL against its oracle,
 *      every frame. The override routes through dispatchGameState's override consult
 *      (nmi.js), inert when the map is empty.
 *
 *   2. EQUAL (unit) -- same, in RAM + all registers (incl. F) + pc, on the pristine
 *      captured entry (the naturally-reached CLEAR/continue branch).
 *
 *   3+4. TEETH (whole + unit) -- a deliberately-broken twin (the CLEAR-branch store
 *      SUBSTATE_TIMER(0x6009) <- 0x40 lands the wrong value) must be CAUGHT: NOT-EQUAL,
 *      naming 0x6009. 0x6009 is written once here and by nothing else on this path
 *      (sub_306f writes 0x62AF, sub_176c the 0x692F block, sub_1783 nothing), so a
 *      wrong timer value persists AND cascades through the sub-state machinery.
 *
 *   5. BRANCH: SKIP (synthesised) -- the natural forced run always takes the CLEAR
 *      branch (the sprite block is zero, so sub_1783 returns true, ~40x). The other
 *      branch -- sub_1783 finds a non-zero cell, takes its `jp 0x0026` CALLER-SKIP,
 *      and returns to the GRANDPARENT so sub_1757 must abort -- is forced here by
 *      filling the scanned block (0x6900-0x6960) with 0xFF on BOTH clones (identical,
 *      real callees run). Proven EQUAL (RAM + regs + pc) AND the SKIP branch's CYCLE
 *      TOTAL is asserted equal to the oracle's, with a wrong total (62 not 63) caught
 *      -- committed teeth for a collapsed branch the whole-machine run never reaches.
 *
 *   6. CYCLE (whole-machine) -- a WRONG collapsed CLEAR total (113 not 114) is CAUGHT
 *      and NOT-EQUAL, proving the collapsed total is load-bearing (it diverges at a
 *      stack cell 0x6BFE -- an NMI-pushed PC in diffed stack RAM, the loc_17b6/0611
 *      downstream-landing mechanism).
 *
 *   7. CYCLE (unit, isolated) -- with the three callees stubbed to charge nothing,
 *      sub_1757's OWN charge is 114t (CLEAR) / 63t (SKIP) on BOTH oracle and optimized
 *      -- the collapse is a redistribution of the SAME total, not a cheaper one.
 *
 * THE CYCLE FINDING: sub_1757 is ATOMIC -- dispatched inside the NMI, where the mask
 * is held, so the vblank NMI can never land inside it OR any of its three callees.
 * Its internal cycle DISTRIBUTION is free, so ~9 per-instruction m.step charges
 * collapse to 3 per-call-segment charges + one epilogue-in-ret; each branch's TOTAL
 * is preserved exactly (SKIP 63, CLEAR 114) because it sets the main-loop vblank-spin
 * count and where a LATER frame's NMI lands in diffed stack RAM (README §2). sub_1757
 * makes NO 0x7Dxx hardware-latch write (only work RAM 0x6009/0x6388), so the collapse
 * has no --writes-trace consequence and no write-trace test.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { sub_1757 as translated_1757 } from "../../translated/state0.js";
import { sub_1757 as optimized_1757 } from "../sub_1757.js";
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

const TARGET = 0x1757;
const POKE_FRAME = 100;
const HOLD_DUR = 40; // held across the window so sub_1757 dispatches ~40x
const FRAMES = 140;
const CALLEES = [0x306f, 0x176c, 0x1783];
const FOLD_STEP = 0x1783; // addr of the folded pre-call charge (inc hl+inc de+CALL = 29t)
const BROKEN_ADDR = 0x6009; // SUBSTATE_TIMER -- the CLEAR branch's own store; written once, persists
const OWN_CLEAR = 114; // sub_1757's own charge on the CLEAR branch
const OWN_SKIP = 63; //  sub_1757's own charge on the SKIP branch

// Identical-both-sides poke that forces board-advance -> the 0x1623 table (BOARD bit0
// set) -> selector 4 (idx4 = sub_1757). Held so sub_1757 dispatches every frame.
// (Karl's sanctioned "poke the board state to reach a state for validation" -- applied
// to baseline and optimized alike, so equivalence is preserved.)
const FORCE_1757_POKE = [
  { addr: 0x6005, val: 0x03, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_STATE = 3 (in-game)
  { addr: 0x600a, val: 0x16, frame: POKE_FRAME, dur: HOLD_DUR }, // GAME_SUBSTATE = 0x16 (board-advance)
  { addr: 0x6227, val: 0x01, frame: POKE_FRAME, dur: HOLD_DUR }, // BOARD bit0 set -> table 0x1623
  { addr: 0x6388, val: 0x04, frame: POKE_FRAME, dur: HOLD_DUR }, // selector 4 -> idx4 = sub_1757
];

// The engine's factory: a DK Machine on this ROM with the force poke loaded. Both the
// baseline (no arg) and optimized (wrapped override map) sides get the SAME poke, so
// any state forcing is applied identically.
const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.pokes = FORCE_1757_POKE.map((p) => ({ ...p }));
  return m;
};

// Broken twin: behaviourally optimized_1757 EXCEPT the first store to SUBSTATE_TIMER
// (0x6009 <- 0x40, the CLEAR branch's own store) lands the correct value XOR 0xFF
// (guaranteed to differ). Every callee and the rest of the routine run verbatim -- the
// representative "wrong value to one of the routine's own output addresses" bug.
function broken_1757(m) {
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
    return optimized_1757(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// Wrong-total twin: byte-for-byte optimized_1757 but charges the folded pre-0x1783
// segment 1t light (28 not 29), so each branch's total is 1 short (CLEAR 113, SKIP 62).
// Only sub_1757 ever calls m.step with addr 0x1783, so no callee charge is touched.
function wrongTotal_1757(m) {
  const realStep = m.step.bind(m);
  m.step = (addr, cyc) => realStep(addr, addr === FOLD_STEP ? cyc - 1 : cyc);
  try {
    return optimized_1757(m);
  } finally {
    m.step = realStep;
  }
}

// -- pristine-entry capture (for the isolated branch / cycle checks) --------------

/** Capture the machine the instant sub_1757 is FIRST entered (frame 101). */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return translated_1757(mm);
  }]]);
  const host = makeMachine(snap);
  host.runFrames(FRAMES);
  if (entry === null) throw new Error("sub_1757 never entered within the run window");
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Force the SKIP branch on a clone: fill the scanned block with 0xFF so sub_176c
 *  keeps it (>= 0x19) and sub_1783's first scanned cell is non-zero -> caller-skip. */
function forceSkip(c) {
  for (let a = 0x6900; a <= 0x6960; a++) c.mem.write8(a, 0xff);
}

/** Run `fn` on a fresh clone of the entry (optional prep first); return {m, cycles}. */
function runClone(fn, prep) {
  const c = ENTRY.clone();
  if (prep) prep(c);
  const c0 = c.cycles;
  fn(c);
  return { m: c, cycles: c.cycles - c0 };
}

/** sub_1757's OWN cycles on a branch, with all three callees stubbed to charge
 *  nothing. `clear` picks which way the stubbed sub_1783 sends control. */
function ownCycles(fn, clear) {
  const c = ENTRY.clone();
  c.routines.set(0x306f, () => {});
  c.routines.set(0x176c, () => {});
  c.routines.set(0x1783, clear
    ? () => true // all-clear -> CLEAR branch
    : (mm) => { mm.pop16(); mm.ret(0); return false; }); // caller-skip -> SKIP branch
  const before = c.cycles;
  fn(c);
  return c.cycles - before;
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized sub_1757 matches translated every frame", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, optimized_1757]]));

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
      `override fired ${r.invocations.get(TARGET)}x (board-advance, forced)`,
  );
});

test("EQUAL (unit): idiomatic optimized sub_1757 matches translated in RAM + registers", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1757, optimized_1757, { maxFrames: FRAMES });

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg}` : "");
  assert.equal(r.pc, null, "pc must match");
  assert.equal(r.equal, true);
  console.log("  EQUAL/unit: RAM + all registers (incl. F) + pc identical (CLEAR branch)");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong SUBSTATE_TIMER store is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, broken_1757]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong SUBSTATE_TIMER store is CAUGHT and names 0x6009", () => {
  const r = coreUnitEquivalence(makeMachine, TARGET, translated_1757, broken_1757, { maxFrames: FRAMES });

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

// -- BRANCH: SKIP (synthesised) -----------------------------------------------

test("BRANCH SKIP (synthesised): the caller-skip path is EQUAL and preserves the 63t total", () => {
  // Force sub_1783 to find a non-zero cell (block filled 0xFF on both clones), so it
  // takes its caller-skip and sub_1757 aborts without its own ret. Real callees run.
  const a = runClone(translated_1757, forceSkip);
  const b = runClone(optimized_1757, forceSkip);

  const ram = firstStateDiff(a.m.dumpState(), b.m.dumpState(), (off) => a.m.stateOffsetToAddr(off));
  const regs = firstRegDiff(a.m.regs, b.m.regs);
  assert.equal(ram, null, ram ? `RAM diff at 0x${ram.addr.toString(16)} (t ${ram.a} vs o ${ram.b})` : "");
  assert.equal(regs, null, regs ? `reg diff at ${regs.reg} (t ${regs.a} vs o ${regs.b})` : "");
  assert.equal(a.m.pc, b.m.pc, "pc must match on the SKIP branch");

  // Committed cycle teeth for this collapsed branch the whole-machine run never reaches:
  // optimized total == oracle total (same callees, so the delta pins sub_1757's own 63t)...
  assert.equal(b.cycles, a.cycles, `SKIP cycle total drifted: optimized ${b.cycles} vs oracle ${a.cycles}`);
  // ...and it is not vacuous: a 1-cycle-light collapse (62) makes the totals disagree.
  const wrong = runClone(wrongTotal_1757, forceSkip);
  assert.notEqual(wrong.cycles, a.cycles, "SKIP cycle-total assertion has no teeth");
  console.log(`  BRANCH/SKIP: EQUAL (RAM+regs+pc); optimized total ${b.cycles}t == oracle ${a.cycles}t; wrong-total caught`);
});

// -- CYCLE --------------------------------------------------------------------

test("CYCLE (whole-machine): a WRONG collapsed CLEAR total (113) is CAUGHT and NOT-EQUAL", () => {
  const r = coreWholeMachineEquivalence(makeMachine, FRAMES, new Map([[TARGET, wrongTotal_1757]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "wrong-total override must have dispatched");
  assert.equal(r.equal, false, "a wrong collapsed total slipped through — the total has no teeth");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  CYCLE/whole: wrong CLEAR total 113 caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("CYCLE (unit, isolated): sub_1757's OWN charge is 114t CLEAR / 63t SKIP on both oracle and optimized", () => {
  assert.equal(ownCycles(translated_1757, true), OWN_CLEAR, "oracle CLEAR own-cycles != 114");
  assert.equal(ownCycles(optimized_1757, true), OWN_CLEAR, "optimized CLEAR own-cycles != 114");
  assert.equal(ownCycles(translated_1757, false), OWN_SKIP, "oracle SKIP own-cycles != 63");
  assert.equal(ownCycles(optimized_1757, false), OWN_SKIP, "optimized SKIP own-cycles != 63");
  console.log(`  CYCLE/unit: own totals CLEAR ${OWN_CLEAR}t / SKIP ${OWN_SKIP}t on oracle and optimized (distribution collapsed, total preserved)`);
});
