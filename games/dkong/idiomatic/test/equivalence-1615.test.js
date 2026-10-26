// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchBoardClearedInterlude (ROM 0x1615) — the board-advance state's top dispatcher:
 * park the moving sprites (clearSpriteColumns / 0x30BD), then vector the board-render sequence
 * step BOARD_ADVANCE_STEP (0x6388) to its handler by board type —
 *   BOARD bit0 (25m/75m) -> the 6-entry ROM table at 0x1623 [0x1654,0x1670,0x168a,0x1732,0x1757,0x178e]
 *   BOARD bit1 (50m)      -> the 5-entry ROM table at 0x1637 [0x16a3,0x16bb,0x1732,0x1757,0x178e]
 *   neither    (100m)     -> fall through to runRivetBoardInterludeFrame.
 *
 * dispatchBoardClearedInterlude is NOT reached in plain attract — it is the GAME_SUBSTATE 0x600A == 0x16 handler, which
 * the attract demo never drives (a board is never completed). And it is not a leaf: it clears sprite
 * columns and dispatches board-render handlers that paint/animate the interlude and step the
 * sequence. So it is validated by MEMORY-equivalence against the frozen oracle (RAM − the stack scratch below the entry SP,
 * pc, SP), never the full register file and never cycles, with a FRESH clone per case, using CRAFTED
 * entries (a real attract state + a surgical poke).
 *
 * Registers and flags are NOT compared because the oracle's board-read/rotate plumbing is used
 * only to pick the arm here and is dead afterwards. pc and SP ARE compared and net out
 * identically: the oracle's push16 return-brackets around the 0x30BD call and around each
 * rst-0x28 dispatch cancel, leaving the arm's own terminal `ret` to pop the caller return on
 * both sides.
 *
 *   1. FULL-HANDLER (crafted reachable arms) — a real attract-run machine poked over the three board
 *      arms (BOARD 1/3 -> table 0x1623 steps 0..5; BOARD 2 -> table 0x1637 steps 0..4; BOARD 4 ->
 *      runRivetBoardInterludeFrame), running the ORACLE on one clone and dispatchBoardClearedInterlude on another. The FULL oracle handler
 *      (clearSpriteColumns + the arm) runs on BOTH sides, so a wrong target, a dropped prefix call,
 *      or a live register/flag handoff the folded-away rst-0x28 trampoline would supply surfaces as
 *      divergent RAM. Non-vacuous: every case mutates RAM vs the untouched base.
 *
 *   2. CRAFTED (exhaustive selector sweep) — on a real base poked to BOARD 1/3/2, sweep the step
 *      selector 0x6388 over every byte 0..255 identically on both sides and route ANY computed
 *      target to an IDENTICAL catch-all stub (so no arm runs), then compare the target the
 *      dispatcher handed the stub + SP. This exhaustively pins the per-board table base (0x1623 for
 *      odd boards, 0x1637 for 50m) AND the `base + (2*step & 0xff)` 8-bit-wrap table math, including
 *      the wrap region sel >= 0x80. It also confirms BOARD 1 and BOARD 3 select the SAME table.
 *
 *   3. TEETH — three broken twins, each MUST be caught:
 *      (a) drops clearSpriteColumns — caught by a poked sprite-X byte the prefix should have zeroed
 *          (arm stubbed so only the prefix's effect remains).
 *      (b) always uses the odd-board table 0x1623 (ignores the bit1 50m arm) — caught by the BOARD 2
 *          sweep, where the correct target comes from 0x1637.
 *      (c) forms the offset as a full 16-bit 2*step (skips the 8-bit `add a,a` wrap) — caught by the
 *          sweep at sel >= 0x80.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1615.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1615 as oracle } from "../../translated/loc_1615.js";
import { dispatchBoardClearedInterlude } from "../dispatchBoardClearedInterlude.js";
import { runRivetBoardInterludeFrame } from "../runRivetBoardInterludeFrame.js";
import { clearSpriteColumns } from "../clearSpriteColumns.js";
import { loc_00ca } from "../../translated/loc_00ca.js";
import { Machine } from "../../machine.js";
import { ORACLE_ROUTINES } from "../../routines.js";
import { STACK_SCRATCH, BOARD, BOARD_ADVANCE_STEP } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TABLE_ODD = 0x1623;   // 25m / 75m board-render step table (6 entries)
const TABLE_50M = 0x1637;   // 50m board-render step table (5 entries)
const CALLER_RET = 0x4d5e;  // a plausible dispatchBoardClearedInterlude caller return (arm's terminal ret target)

// Sprite-buffer X bytes clearSpriteColumns zeroes (record +0 of its four groups) — used to make
// the prefix's effect observable when the dispatched arm is stubbed out.
const SPRITE_X_CLEARED = [0x6950, 0x6954, 0x6980, 0x69b8, 0x6a0c, 0x6a1c];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First differing RAM byte between two dumps, EXCLUDING the dead stack-scratch region (the
// memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns { addr, a, b } or null.
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
// block, the render counters, the object scratch the arms touch) holds realistic values. dispatchBoardClearedInterlude
// is never dispatched here — its entry is crafted by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted dispatch entry onto a clone: a deep stack with a plausible caller return (so the
// dispatched arm's terminal `ret` has a sane target), the board type, and the sequence step.
function craftEntry(base, board, step) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(CALLER_RET);
  m.mem.write8(BOARD, board);
  m.mem.write8(BOARD_ADVANCE_STEP, step);
  return m;
}

// -- 1. FULL-HANDLER (crafted reachable arms) ---------------------------------

// A catch-all override (duck-typed like the Machine's overrides Map) that runs the FROZEN ORACLE
// handler for whatever target the dispatcher computed, and records that target. Installed IDENTICALLY
// on the oracle and the candidate so BOTH loc_00ca take the override path (translated line 11,
// idiomatic line 49) and reach the SAME handler by the SAME direct call. The old FULL-HANDLER ran that
// handler behind idiomatic loc_00ca's `m.call`; the idiomatic layer no longer has that path, so the
// handler is reached through the production override seam instead. Both sides use the identical path
// and handler, so downstream RAM/SP/pc stay a true dispatcher-vs-dispatcher comparison — a wrong arm
// target or a wrong LIVE-IN handoff still diverges through the full handler, exactly as before.
function oracleCatchAll(rec) {
  return {
    has: () => true,
    get: (target) => (mm) => {
      rec.push(target);
      return ORACLE_ROUTINES.get(target)(mm);
    },
  };
}

test("FULL-HANDLER: dispatchBoardClearedInterlude == oracle on real bases poked to each board arm + reachable step", () => {
  const base = attractBase();
  const cases = [
    ...[0, 1, 2, 3, 4, 5].map((s) => ({ board: 1, step: s })), // 25m -> table 0x1623
    ...[0, 1, 2, 3, 4, 5].map((s) => ({ board: 3, step: s })), // 75m -> table 0x1623 (odd)
    ...[0, 1, 2, 3, 4].map((s) => ({ board: 2, step: s })),    // 50m -> table 0x1637
    { board: 4, step: 0 }, { board: 4, step: 1 }, { board: 4, step: 2 }, // 100m -> runRivetBoardInterludeFrame
  ];

  let mutatedAll = true;
  for (const { board, step } of cases) {
    const a = craftEntry(base, board, step); // oracle
    const aFloor = a.regs.sp;
    const b = craftEntry(base, board, step); // candidate
    const recA = [], recB = [];
    a.overrides = oracleCatchAll(recA);
    b.overrides = oracleCatchAll(recB);
    const before = a.dumpState();

    oracle(a);
    dispatchBoardClearedInterlude(b);

    const tag = `BOARD=${hx(board)} step=${hx(step)}`;

    // The dispatcher's OWN arm dispatch is rec[0]; later records are nested dispatches the frozen
    // handler makes. Both sides run the identical handler by the identical path, so the WHOLE dispatch
    // sequence must match address-for-address — the computed arm target asserted directly.
    assert.ok(recA.length >= 1, `the dispatcher dispatched nothing on the oracle side (${tag})`);
    assert.deepEqual(recB.map(hx), recA.map(hx), `dispatch sequence diverged (${tag})`);

    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), aFloor);
    assert.equal(
      ramDiff,
      null,
      ramDiff && `RAM diverged at ${hx(ramDiff.addr)}: oracle=${ramDiff.a} cand=${ramDiff.b} (${tag})`,
    );
    assert.equal(b.regs.sp, a.regs.sp, `SP diverged (${tag}): oracle=${hx(a.regs.sp)} cand=${hx(b.regs.sp)}`);
    assert.equal(b.pc, a.pc, `pc diverged (${tag}): oracle=${hx(a.pc)} cand=${hx(b.pc)}`);

    // Non-vacuous: the routine actually ran and wrote RAM (else the replay proves nothing).
    if (!firstRamDiffExStack(before, a.dumpState(), (o) => a.stateOffsetToAddr(o), aFloor)) mutatedAll = false;
  }
  assert.ok(mutatedAll, "some case mutated no RAM — the replay is vacuous for it");
  console.log(`  FULL-HANDLER: ${cases.length} arms (BOARD 1/3 table 0x1623, BOARD 2 table 0x1637, BOARD 4 -> runRivetBoardInterludeFrame) — full oracle handler both sides through the production override seam, target+RAM(−stack)+pc+SP identical, all non-vacuous`);
});

// -- 2. CRAFTED (exhaustive selector sweep) -----------------------------------

// A catch-all override object (duck-typed like the Machine's overrides Map) that routes ANY computed
// target to `rec`, so the dispatched arm never runs and we read the target + SP the dispatcher formed.
// loc_00ca consults m.overrides first, so BOTH the oracle (via the rst-0x28 trampoline) and
// the candidate reach the same target through it.
function stubOverrides(rec) {
  const SENTINEL = 0x5a;
  return {
    has: () => true,
    get: (target) => (mm) => { rec.push({ target, sp: mm.regs.sp }); return SENTINEL; },
  };
}

// Run oracle and candidate on identically-poked clones for one (board, selector); return the
// { target, sp } each handed the stub.
function runCraftedSelector(base, candidate, board, sel) {
  const mA = craftEntry(base, board, sel);
  const mB = craftEntry(base, board, sel);
  const recA = [], recB = [];
  mA.overrides = stubOverrides(recA);
  mB.overrides = stubOverrides(recB);
  oracle(mA);
  candidate(mB);
  return { recA, recB };
}

function sweepBoard(base, candidate, board) {
  let count = 0, mismatch = null;
  for (let sel = 0; sel < 256 && !mismatch; sel++) {
    const { recA, recB } = runCraftedSelector(base, candidate, board, sel);
    count++;
    if (recA.length !== 1 || recB.length !== 1) {
      mismatch = { sel, why: `dispatch fired ${recA.length}/${recB.length} times (want 1/1)` };
    } else if (recA[0].target !== recB[0].target) {
      mismatch = { sel, why: `target ${hx(recA[0].target)}/${hx(recB[0].target)}` };
    } else if (recA[0].sp !== recB[0].sp) {
      mismatch = { sel, why: `SP ${hx(recA[0].sp)}/${hx(recB[0].sp)}` };
    }
  }
  return { count, mismatch };
}

test("CRAFTED: dispatchBoardClearedInterlude == oracle over all 256 selectors on each dispatch arm (BOARD 1/3 -> 0x1623, 2 -> 0x1637)", () => {
  const base = attractBase();
  for (const board of [1, 3, 2]) {
    const { count, mismatch } = sweepBoard(base, dispatchBoardClearedInterlude, board);
    assert.equal(mismatch, null, mismatch && `BOARD ${hx(board)} mismatch at sel=${hx(mismatch.sel)}: ${mismatch.why}`);
    assert.equal(count, 256, `BOARD ${hx(board)}: must have swept all 256 selectors`);
  }

  // Table selection: the odd boards (1, 3) share table 0x1623; 50m (2) uses 0x1637. Read the target
  // each hands the stub for step 0 and confirm it matches the ROM table head.
  const targetFor = (board) => {
    const rec = [];
    const m = craftEntry(base, board, 0);
    m.overrides = stubOverrides(rec);
    dispatchBoardClearedInterlude(m);
    return rec[0].target;
  };
  assert.equal(targetFor(1), 0x1654, "BOARD 1 step 0 should dispatch table 0x1623 head (0x1654)");
  assert.equal(targetFor(3), 0x1654, "BOARD 3 should select the SAME table as BOARD 1 (odd -> 0x1623)");
  assert.equal(targetFor(2), 0x16a3, "BOARD 2 step 0 should dispatch table 0x1637 head (0x16a3)");
  console.log("  CRAFTED: 3 arms × 256 selectors — dispatched target + SP identical to the oracle; table selection 1/3->0x1623, 2->0x1637 confirmed");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): drops clearSpriteColumns; only the dispatch runs. */
function brokenNoClear(m) {
  const { mem } = m;
  const board = mem.read8(BOARD);
  const dispatch = (tableBase) => {
    const step = mem.read8(BOARD_ADVANCE_STEP);
    const entry = (tableBase + ((step * 2) & 0xff)) & 0xffff;
    const target = mem.read8(entry) | (mem.read8((entry + 1) & 0xffff) << 8);
    loc_00ca(m, target, "teeth");
  };
  if ((board & 0x01) !== 0) dispatch(TABLE_ODD);
  else if ((board & 0x02) !== 0) dispatch(TABLE_50M);
  else runRivetBoardInterludeFrame(m);
}

/** Broken twin (b): always uses the odd-board table, ignoring the bit1 (50m) arm. */
function brokenWrongBase(m) {
  clearSpriteColumns(m);
  const { mem } = m;
  const step = mem.read8(BOARD_ADVANCE_STEP);
  const entry = (TABLE_ODD + ((step * 2) & 0xff)) & 0xffff; // BUG: ignores the BOARD bit1 arm
  const target = mem.read8(entry) | (mem.read8((entry + 1) & 0xffff) << 8);
  loc_00ca(m, target, "teeth");
}

/** Broken twin (c): forms the offset as a full 16-bit 2*step (drops the 8-bit `add a,a` wrap). */
function brokenNoWrap(m) {
  clearSpriteColumns(m);
  const { mem } = m;
  const board = mem.read8(BOARD);
  const tableBase = (board & 0x01) !== 0 ? TABLE_ODD : TABLE_50M;
  const step = mem.read8(BOARD_ADVANCE_STEP);
  const entry = (tableBase + 2 * step) & 0xffff; // BUG: no 8-bit wrap on the *2
  const target = mem.read8(entry) | (mem.read8((entry + 1) & 0xffff) << 8);
  loc_00ca(m, target, "teeth");
}

test("TEETH: the dropped-prefix, wrong-table-base, and 16-bit-offset twins are all CAUGHT", () => {
  const base = attractBase();

  // (a) dropped clearSpriteColumns — poke the four groups' X byte non-zero, stub the arm so only
  // the prefix's effect remains, and confirm the twin leaves a poked byte the oracle zeroed.
  const oa = craftEntry(base, 1, 0);
  const oaFloor = oa.regs.sp;
  const ob = craftEntry(base, 1, 0);
  for (const addr of SPRITE_X_CLEARED) { oa.mem.write8(addr, 0xaa); ob.mem.write8(addr, 0xaa); }
  oa.overrides = stubOverrides([]);
  ob.overrides = stubOverrides([]);
  oracle(oa);
  brokenNoClear(ob);
  const clearDiff = firstRamDiffExStack(oa.dumpState(), ob.dumpState(), (o) => oa.stateOffsetToAddr(o), oaFloor);
  assert.notEqual(clearDiff, null, "the dropped-clearSpriteColumns twin escaped — the gate is worthless");
  assert.ok(
    SPRITE_X_CLEARED.includes(clearDiff.addr),
    `expected the dropped-clear diff in a cleared sprite-X byte, got ${hx(clearDiff.addr)}`,
  );

  // (b) wrong table base — the BOARD 2 (50m) sweep must catch it (correct target is from 0x1637).
  const wrongBase = sweepBoard(base, brokenWrongBase, 2);
  assert.notEqual(wrongBase.mismatch, null, "the wrong-table-base twin escaped the BOARD 2 sweep — the gate is worthless");

  // (c) 16-bit offset (no 8-bit wrap) — the sweep must catch it at sel >= 0x80 (odd + 50m arms).
  const noWrap1 = sweepBoard(base, brokenNoWrap, 1);
  const noWrap2 = sweepBoard(base, brokenNoWrap, 2);
  assert.notEqual(noWrap1.mismatch, null, "the 16-bit-offset twin escaped the BOARD 1 sweep — the gate is worthless");
  assert.notEqual(noWrap2.mismatch, null, "the 16-bit-offset twin escaped the BOARD 2 sweep — the gate is worthless");

  console.log(
    `  TEETH: dropped-clear caught at ${hx(clearDiff.addr)}; wrong-base caught at sel=${hx(wrongBase.mismatch.sel)}; ` +
      `16-bit-offset caught at sel=${hx(noWrap1.mismatch.sel)} (BOARD 1) / ${hx(noWrap2.mismatch.sel)} (BOARD 2)`,
  );
});
