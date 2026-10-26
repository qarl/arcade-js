// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchRivetBoardInterludeStep (ROM 0x1644) — the board-advance render-sequence step
 * dispatcher: `ld a,(0x6388)` then vector through the 6-entry inline jump table at ROM 0x1648
 * (step 0 -> 0x17B6, 1 -> 0x3069, 2 -> 0x1839, 3 -> 0x186F, 4 -> 0x1880, 5 -> 0x18C6).
 *
 * dispatchRivetBoardInterludeStep is NOT reached in plain attract — it is the fall-through dispatch of runRivetBoardInterludeFrame, an arm
 * of dispatchBoardClearedInterlude's board-advance dispatcher (GAME_SUBSTATE 0x600A == 0x16), which the attract demo
 * never drives (a board is never completed). And it is not a leaf: it dispatches board-render
 * handlers that paint/animate the interlude and step the sequence. So it is validated by
 * MEMORY-equivalence against the frozen oracle (RAM − the stack scratch below the entry SP, pc, SP), never the full
 * register file and never cycles, with a FRESH clone per case, using CRAFTED entries (doc-06: a
 * real state + a surgical poke):
 *
 *   1. FULL-HANDLER (crafted reachable arms) — take a real attract-run machine, poke the step
 *      0x6388 to each of the 6 reachable indices (0..5), and run the ORACLE on one clone and
 *      dispatchRivetBoardInterludeStep on another. The FULL oracle arm handler runs on BOTH sides, so a wrong target OR
 *      a live register/flag handoff the folded-away trampoline would have supplied surfaces as
 *      divergent RAM. Proven non-vacuous: each of the 6 arms mutates RAM vs the untouched base.
 *
 *   2. CRAFTED (exhaustive selector sweep) — the off-table indices the game never reaches (the
 *      table has 6 real slots and the selector is NOT range-checked). On a real captured base,
 *      poke 0x6388 to every byte 0..255 identically on both sides and route ANY computed target
 *      to an IDENTICAL catch-all stub (so the handler never runs), then compare the target the
 *      dispatcher handed the stub + SP. This exhaustively pins the `0x1648 + (2*sel & 0xff)`
 *      8-bit-wrap table math, including the wrap region sel >= 0x80.
 *
 *   3. TEETH — a twin that forms the offset as a full 16-bit `2*sel` (skipping the 8-bit
 *      `add a,a` wrap) MUST be caught by the selector sweep at sel >= 0x80.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1644.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1644 as oracle } from "../../translated/loc_1644.js";
import { dispatchRivetBoardInterludeStep } from "../dispatchRivetBoardInterludeStep.js";
import { loc_00ca } from "../../translated/loc_00ca.js";
import { Machine } from "../../machine.js";
import { ORACLE_ROUTINES } from "../../routines.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const STEP = 0x6388;          // the board-render sequence-step selector
const STEP_TABLE = 0x1648;    // ROM inline jump table base (6 entries)
const DISPATCH_TABLE_1648 = "the rivet-board interlude sequence table";
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First differing RAM byte between two dumps, EXCLUDING the dead stack-scratch region
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns { addr, a, b } or null.
function firstRamDiffExStack(a, b, offToAddr, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = offToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM (the sprite-object
// block, the render counters 0x6388/0x6390, the object scratch the arms touch) holds realistic
// values. dispatchRivetBoardInterludeStep is never dispatched here — we craft its entry by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted dispatch entry onto a clone: a deep stack with a plausible caller return (so
// the dispatched arm's terminal `ret` has a sane target) and the step selector.
function craftEntry(base, step) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(0x4d5e);            // caller return, exactly as boot.test.js frames it
  m.mem.write8(STEP, step);
  return m;
}

// -- 1. FULL-HANDLER (crafted reachable arms) ---------------------------------

// A catch-all override (duck-typed like the Machine's overrides Map) that runs the FROZEN ORACLE
// handler for whatever step target the dispatcher computed, and records that target. Installed
// IDENTICALLY on the oracle and the candidate so BOTH loc_00ca take the override path (translated
// line 11, idiomatic line 49) and reach the SAME handler by the SAME direct call. The old FULL-HANDLER
// ran that handler behind idiomatic loc_00ca's `m.call`; the idiomatic layer no longer has that path,
// so the handler is reached through the production override seam instead. Both sides use the identical
// path and handler, so downstream RAM/SP/pc stay a true dispatcher-vs-dispatcher comparison — a wrong
// step target or a wrong LIVE-IN handoff still diverges through the full arm handler, exactly as before.
function oracleCatchAll(rec) {
  return {
    has: () => true,
    get: (target) => (mm) => {
      rec.push(target);
      return ORACLE_ROUTINES.get(target)(mm);
    },
  };
}

test("FULL-HANDLER: dispatchRivetBoardInterludeStep == oracle on real bases poked to each reachable step (0..5)", () => {
  const base = attractBase();
  const REACHABLE = [0, 1, 2, 3, 4, 5];

  let mutatedAll = true;
  for (const step of REACHABLE) {
    const a = craftEntry(base, step); // oracle
    const aFloor = a.regs.sp;
    const b = craftEntry(base, step); // candidate
    const recA = [], recB = [];
    a.overrides = oracleCatchAll(recA);
    b.overrides = oracleCatchAll(recB);
    const before = a.dumpState();

    oracle(a);
    dispatchRivetBoardInterludeStep(b);

    // The dispatcher's OWN step dispatch is rec[0]; later records are nested dispatches the frozen
    // arm handler makes. Both sides run the identical handler by the identical path, so the WHOLE
    // dispatch sequence must match address-for-address — the computed step target asserted directly.
    assert.ok(recA.length >= 1, `the dispatcher dispatched nothing on the oracle side (step ${hx(step)})`);
    assert.deepEqual(recB.map(hx), recA.map(hx), `dispatch sequence diverged (step ${hx(step)})`);

    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), aFloor);
    assert.equal(
      ramDiff,
      null,
      ramDiff && `RAM diverged at ${hx(ramDiff.addr)}: oracle=${ramDiff.a} cand=${ramDiff.b} ` +
        `(step ${hx(step)})`,
    );
    assert.equal(b.regs.sp, a.regs.sp, `SP diverged (step ${hx(step)}): oracle=${hx(a.regs.sp)} cand=${hx(b.regs.sp)}`);
    assert.equal(b.pc, a.pc, `pc diverged (step ${hx(step)}): oracle=${hx(a.pc)} cand=${hx(b.pc)}`);

    // Non-vacuous: the arm body actually ran and wrote RAM (else the replay proves nothing).
    if (!firstRamDiffExStack(before, a.dumpState(), (o) => a.stateOffsetToAddr(o), aFloor)) mutatedAll = false;
  }
  assert.ok(mutatedAll, "some reachable arm mutated no RAM — replay is vacuous for it");
  console.log(`  FULL-HANDLER: steps {0..5} — full oracle arm run both sides through the production override seam, target+RAM(−stack)+pc+SP identical, all non-vacuous`);
});

// -- 2. CRAFTED (exhaustive selector sweep) -----------------------------------

// A catch-all override object (duck-typed like the Machine's overrides Map) that routes ANY
// computed target to `stub`, so the dispatched arm never runs and we can read the target the
// dispatcher formed. loc_00ca consults m.overrides first, and BOTH the oracle (via the
// rst-0x28 trampoline) and the candidate reach the same target through it.
function stubOverrides(rec) {
  const SENTINEL = 0x5a;
  return {
    has: () => true,
    get: (target) => (mm) => { rec.push({ target, sp: mm.regs.sp }); return SENTINEL; },
  };
}

// Run oracle and candidate on identically-poked clones for one selector; return the
// { target, sp } each handed the stub.
function runCraftedSelector(base, candidate, sel) {
  const mA = craftEntry(base, sel);
  const mB = craftEntry(base, sel);
  const recA = [], recB = [];
  mA.overrides = stubOverrides(recA);
  mB.overrides = stubOverrides(recB);
  oracle(mA);
  candidate(mB);
  return { recA, recB };
}

test("CRAFTED: dispatchRivetBoardInterludeStep == oracle over all 256 selectors (0x1648 table)", () => {
  const base = attractBase();
  let count = 0;
  let mismatch = null;
  for (let sel = 0; sel < 256 && !mismatch; sel++) {
    const { recA, recB } = runCraftedSelector(base, dispatchRivetBoardInterludeStep, sel);
    count++;
    if (recA.length !== 1 || recB.length !== 1) {
      mismatch = { sel, why: `dispatch fired ${recA.length}/${recB.length} times (want 1/1)` };
    } else if (recA[0].target !== recB[0].target) {
      mismatch = { sel, why: `target ${hx(recA[0].target)}/${hx(recB[0].target)}` };
    } else if (recA[0].sp !== recB[0].sp) {
      mismatch = { sel, why: `SP ${hx(recA[0].sp)}/${hx(recB[0].sp)}` };
    }
  }
  assert.equal(mismatch, null, mismatch && `mismatch at sel=${hx(mismatch.sel)}: ${mismatch.why}`);
  assert.equal(count, 256, "must have swept all 256 selectors");
  console.log(`  CRAFTED: ${count} selectors — dispatched target + SP identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: forms the table offset as a FULL 16-bit `2*sel` instead of the hardware's 8-bit
 * `add a,a` (`2*sel & 0xff`). It agrees with the oracle for every selector < 0x80 and diverges
 * from 0x80 up, so only a sweep across the wrap catches it.
 */
function brokenDispatch(m) {
  const { mem } = m;
  const sel = mem.read8(STEP);
  const entry = (STEP_TABLE + 2 * sel) & 0xffff; // BUG: no 8-bit wrap on the *2
  const target = mem.read8(entry) | (mem.read8((entry + 1) & 0xffff) << 8);
  loc_00ca(m, target, DISPATCH_TABLE_1648);
}

test("TEETH: the 16-bit-offset twin (no 8-bit wrap) is CAUGHT by the selector sweep", () => {
  const base = attractBase();
  let caughtAt = null;
  for (let sel = 0; sel < 256 && caughtAt === null; sel++) {
    const { recA, recB } = runCraftedSelector(base, brokenDispatch, sel);
    if (recA.length !== 1 || recB.length !== 1 || recA[0].target !== recB[0].target) {
      caughtAt = sel;
    }
  }
  assert.notEqual(caughtAt, null, "the sweep FAILED to catch the missing 8-bit offset wrap — it is worthless");
  console.log(`  TEETH: caught the 16-bit-offset twin at sel=${hx(caughtAt)}`);
});
