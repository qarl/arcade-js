// SPDX-License-Identifier: GPL-3.0-only
/**
 * drawInterpolatedPenRun — memory-equivalent to the frozen oracle at ROM 0x0201.
 *
 * GATE: unit-capture at every real dispatch of two sessions, compared outside ONE dead stack
 *   window, with the Z-flag live-out checked against the oracle and a control that proves the flag
 *   arm can see it, plus teeth. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch, outside a narrow dead stack window. The oracle brackets its
 *      three sub-calls and its own return with pushes and pops; the rewrite calls the decompiled
 *      callees directly, so bytes below the entry stack pointer can hold different values. The
 *      exclusion is the SCRATCH_BYTES window below the entry stack pointer, and every arm pins it.
 *   2. EXCLUDED, measured: the registers that ever diverge are exactly the dead ones the rewrite
 *      never reloads — the leftover column step in BC, the leftover table pointer in HL, and A and
 *      the flag byte, which the rewrite leaves alone because it RETURNS the condition instead.
 *      Everything a caller reads agrees, the stack pointer and the Z condition included.
 *   3. LIVE-OUT is the oracle's Z flag (new row integer == 0), which the rewrite returns as a
 *      boolean. Both caller families return conditionally on Z, so it is checked on every dispatch,
 *      and a control twin that inverts only its return is caught while its memory stays identical —
 *      the proof the live-out arm is not blind.
 *   3a. A AND THE REST OF F ARE DEAD WHERE THIS HANDS BACK, asked of the ORACLE by assertDeadAtExit:
 *      complemented on every exit of the all-frozen game over both tapes (F with its Z bit spared),
 *      they change no cell of any frame. The frozen callers (0x08B4, 0x1734, 0x5BD7) test Z at once
 *      and either return or reload before reading A; 0x5BD7's `sub a` reads A only to zero it.
 *      Controls on the same instrument: Z alone flipped at the exit is heard, and SP moved at the
 *      exit is heard, on both tapes.
 *   4. THE RETURN IS THE SEAM'S: the rewrite performs no return of its own and leaves the stack
 *      pointer where it found it -- every caller reaches it by a direct call, and the vertical-blank
 *      service that runs it is itself a direct call with no guest return slot, so a rewrite that
 *      popped one would walk SP out of the stack. Placed through the game's dispatch seam
 *      (withOmittedRet, the authority on stack placement) the seam supplies the ROM `ret`, so every
 *      comparison against the oracle below runs the rewrite PLACED. A control twin that performs its
 *      own return (the pre-dissolution form) is caught moving SP by two, asserted rather than assumed.
 *   5. CORPUS — every dispatch of the undriven demo and of the driven tape; the widest scratch
 *      divergence is pinned as an exact ceiling.
 *   6. TEETH — seven twins, each with its catch count on the real corpus recorded exactly.
 *
 * HOLE: this is boot self-test drawing; both tapes reach it before either input matters, so the two
 * sessions coincide and the second buys robustness, not extra states.
 * HOLE: what shape the runs draw, and what the run table's endpoints mean, is not established here.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0201.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { assertDeadAtExit, heard, heardAs } from "./_deadAtExit.js";
import { drawInterpolatedPenRun } from "../drawInterpolatedPenRun.js";
import { loc_0201 as oracle } from "../../translated/loc_0201.js";
import { plotPenCell } from "../plotPenCell.js";
import { fetchTableWord } from "../fetchTableWord.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { withOmittedRet } from "../../machine.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x0201;
const ROW_POS = 0xa9e3;
const COL_POS = 0xa9e5;
const ROW_STEP = 0xa9e7;
const COL_STEP = 0xa9e9;
const RUN_INDEX = 0xa9e2;
const ROW_TARGET = 0x32f5;
const COL_TARGET = 0x0b45;
const END_CELL = 0x14b2;
const RUN_TABLE = 0x0290;
const Z_FLAG = 0x40;

/** Widest divergence any dispatch produces below the entry stack pointer. Measured, pinned exact. */
const SCRATCH_BYTES = 4;
/** BC keeps the last column step, HL the table pointer past the entry; no caller reads either. A
 *  and F are left alone because the flags are RETURNED; the DEAD AT EXIT arm measures them dead. */
const REG_EXCLUDED = ["a", "f", "b", "c", "h", "l"];
const COMPARED = REG_FIELDS.filter((k) => !REG_EXCLUDED.includes(k));
/** The real run stamps at most seventeen cells; a twin that never converges is stopped past that. */
const GUARD = 1000;

const TAPES = [["demo", { tape: [] }], ["driven", {}]];
const DISPATCHES = { demo: 106, driven: 106 };
const CAUGHT = {
  "no-op": 106,
  "step-unsigned": 78,
  "swap-row-col": 104,
  "no-run-index-inc": 106,
  // 1, not 105: the twin's memory is right and A is dead, so it is seen only where the leftover
  // accumulator and the new row integer disagree about being zero. The leftover is the advanced run
  // index: the word fetch no longer echoes its entry's low address byte into A (that echo is dead at
  // the fetch's exit), so the dispatch where the echo alone was zero no longer counts. The TEETH arm
  // below derives this count from the oracle's own run index and row integer.
  "forgot-report": 1,
  "flip-z-control": 106,
};

/** The oracle's live-out: Z, set when the new row integer is zero. */
const oracleZ = (m) => (m.regs.f & Z_FLAG) !== 0;

const hex = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

/** A routine as the game dispatches it: through the seam, which completes an omitted ROM `ret`. */
const placed = (fn) => withOmittedRet(fn, TARGET);

// ── captures ────────────────────────────────────────────────────────────────────────────

const cache = new Map();
function capture(label, opts) {
  if (cache.has(label)) return cache.get(label);
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    entries.push(mm.clone());
    return oracle(mm);
  }]]), opts);
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the ${label} session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, `the ${label} session ran short`);
  cache.set(label, entries);
  return entries;
}
const driven = () => capture("driven", {});
const anEntry = () => driven()[0];

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/** Oracle vs a candidate on two clones of one entry, ignoring the dead stack window. The Z condition
 *  is judged on what the candidate RETURNS, against the oracle's Z flag. */
function diverge(candidate, entry) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  let reported;
  try {
    reported = placed(candidate)(b);
  } catch {
    return { reason: "threw" };
  }
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp) continue;
    return { reason: "ram", addr, a: da[i], b: db[i] };
  }
  const reg = COMPARED.find((k) => a.regs[k] !== b.regs[k]);
  if (reg) return { reason: "reg:" + reg, a: a.regs[reg], b: b.regs[reg] };
  if (reported !== oracleZ(a)) return { reason: "z", a: oracleZ(a), b: reported };
  return null;
}

/** Every register that moves between oracle and candidate, dead scratch included. */
function movedRegisters(candidate, entry) {
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  placed(candidate)(b);
  return REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
}

/** Bytes the oracle moves from this entry — the guard against a vacuous comparison. */
function footprint(entry) {
  const before = entry.dumpState().slice();
  const after = entry.clone();
  oracle(after);
  const now = after.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

// ── twins, each one change away from the real routine ─────────────────────────────────────

function stepToward(target, current) {
  const delta = (target - current) & 0xffff;
  return (((delta >> 12) & 1 ? 0xff00 : 0) | ((delta >> 4) & 0xff)) & 0xffff;
}

/** The pre-stamp, the two steps, and the run loop — identical to the real routine. */
function drawRun(m) {
  const { regs, mem16 } = m;
  plotPenCell(m);
  mem16[ROW_STEP] = stepToward(mem16[ROW_TARGET], mem16[ROW_POS]);
  mem16[COL_STEP] = stepToward(mem16[COL_TARGET], mem16[COL_POS]);
  do {
    mem16[ROW_POS] = mem16[ROW_POS] + mem16[ROW_STEP];
    mem16[COL_POS] = mem16[COL_POS] + mem16[COL_STEP];
    plotPenCell(m);
  } while (regs.hl !== mem16[END_CELL]);
}

/** Advance the run index and read the next run's endpoint word into DE. */
function loadNextRun(m) {
  const { regs, mem8 } = m;
  mem8[RUN_INDEX] = mem8[RUN_INDEX] + 1;
  regs.a = mem8[RUN_INDEX];
  regs.hl = RUN_TABLE;
  fetchTableWord(m);
}

/** BUG: does nothing — the tell of a gate that measures an unreached routine. */
function brokenNoOp() {}

/** BUG: keeps the step unsigned, so a run toward a lower coordinate walks off the wrong way. */
function brokenStepUnsigned(m) {
  const { regs, mem8, mem16 } = m;
  const unsigned = (t, c) => ((t - c) & 0xffff) >> 4 & 0xff;
  plotPenCell(m);
  mem16[ROW_STEP] = unsigned(mem16[ROW_TARGET], mem16[ROW_POS]);
  mem16[COL_STEP] = unsigned(mem16[COL_TARGET], mem16[COL_POS]);
  let g = 0;
  do {
    mem16[ROW_POS] = mem16[ROW_POS] + mem16[ROW_STEP];
    mem16[COL_POS] = mem16[COL_POS] + mem16[COL_STEP];
    plotPenCell(m);
    if (++g > GUARD) throw new Error("never converged");
  } while (regs.hl !== mem16[END_CELL]);
  loadNextRun(m);
  mem8[ROW_POS] = 0;
  mem8[ROW_POS + 1] = regs.e;
  mem8[COL_POS] = 0;
  mem8[COL_POS + 1] = regs.d;
  regs.a = regs.e;
  regs.and(regs.a);
  m.ret(10);
  return oracleZ(m);
}

/** BUG: stores the loaded endpoint into the wrong axis integers. */
function brokenSwapRowCol(m) {
  const { regs, mem8 } = m;
  drawRun(m);
  loadNextRun(m);
  mem8[ROW_POS] = 0;
  mem8[ROW_POS + 1] = regs.d;
  mem8[COL_POS] = 0;
  mem8[COL_POS + 1] = regs.e;
  regs.a = regs.e;
  regs.and(regs.a);
  m.ret(10);
  return oracleZ(m);
}

/** BUG: does not advance the run index, so it reloads the run it just finished. */
function brokenNoRunIndexInc(m) {
  const { regs, mem8 } = m;
  drawRun(m);
  regs.a = mem8[RUN_INDEX];
  regs.hl = RUN_TABLE;
  fetchTableWord(m);
  mem8[ROW_POS] = 0;
  mem8[ROW_POS + 1] = regs.e;
  mem8[COL_POS] = 0;
  mem8[COL_POS + 1] = regs.d;
  regs.a = regs.e;
  regs.and(regs.a);
  m.ret(10);
  return oracleZ(m);
}

/** BUG: performs its own return -- the pre-dissolution form. Memory-identical, and the seam accepts
 *  it (it lands pc on the caller's slot), so only the SP-neutrality check below can see it: called
 *  directly, as the interrupt path calls it, it pops a return slot nobody laid down. */
function brokenOwnReturn(m) {
  drawInterpolatedPenRun(m);
  m.ret(10);
}

/** BUG: reports the flag off the leftover accumulator instead of the new row integer. */
function brokenForgotReport(m) {
  const { regs, mem8 } = m;
  drawRun(m);
  loadNextRun(m);
  mem8[ROW_POS] = 0;
  mem8[ROW_POS + 1] = regs.e;
  mem8[COL_POS] = 0;
  mem8[COL_POS + 1] = regs.d;
  regs.and(regs.a);
  m.ret(10);
  return oracleZ(m);
}

/** BUG: correct in memory, wrong only in the returned condition — the control for the live-out arm. */
function brokenFlipZControl(m) {
  return !drawInterpolatedPenRun(m);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["step-unsigned", brokenStepUnsigned],
  ["swap-row-col", brokenSwapRowCol],
  ["no-run-index-inc", brokenNoRunIndexInc],
  ["forgot-report", brokenForgotReport],
  ["flip-z-control", brokenFlipZControl],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the dead stack window", { skip }, () => {
  const entry = anEntry();
  assert.ok(footprint(entry) > 0, "vacuous: the oracle writes nothing from this entry");
  assert.equal(diverge(drawInterpolatedPenRun, entry), null, "the rewrite diverged at the real entry");
  console.log(`  EQUAL: entry sp=${hex(entry.regs.sp)}; identical outside [sp-${SCRATCH_BYTES}, sp)`);
});

test("EXCLUDED, measured: nothing outside the dead registers ever diverges", { skip }, () => {
  const union = new Set();
  for (const e of driven()) {
    for (const k of movedRegisters(drawInterpolatedPenRun, e)) union.add(k);
  }
  assert.deepEqual(REG_FIELDS.filter((k) => union.has(k)), REG_EXCLUDED,
    "the set of registers that diverge across the corpus moved");
  console.log(`  EXCLUDED: over the corpus the only diverging registers are ${REG_EXCLUDED.join(", ")}`);
});

test("NOT VACUOUS: the masked comparison catches a do-nothing candidate", { skip }, () => {
  assert.notEqual(diverge(brokenNoOp, anEntry()), null, "the masked diff passed a no-op");
  console.log("  NOT VACUOUS: the empty candidate is caught");
});

test("LIVE-OUT: the returned condition is the oracle's Z, and the arm catches a twin that inverts only it", { skip }, () => {
  let n = 0;
  for (const e of driven()) {
    const a = e.clone();
    const b = e.clone();
    oracle(a);
    const reported = placed(drawInterpolatedPenRun)(b);
    assert.equal(reported, oracleZ(a), "the condition the rewrite returns differs from the oracle's Z flag");
    n++;
  }
  const a = anEntry().clone();
  oracle(a);
  const control = diverge(brokenFlipZControl, anEntry());
  assert.equal(control?.reason, "z", "inverting only the returned condition was not caught by the live-out arm");
  console.log(`  LIVE-OUT: the returned condition equals the oracle's Z on all ${n} dispatches; the inverting control is caught`);
});

test("A AND F ARE DEAD AT EXIT: complemented on every exit of the ORACLE (Z spared), no cell moves", { skip }, () => {
  const exits = assertDeadAtExit({
    at: TARGET, poison: ["a", "f"], flip: { f: 0xff ^ Z_FLAG }, frames: ENTRY_FRAMES,
    sessions: TAPES.map(([label, opts]) => ({ label, tape: opts.tape, dispatches: DISPATCHES[label] })),
    // CONTROL, same instrument and exit: Z alone flipped — the live-out — must be heard.
    controls: [{ label: "live Z", poison: ["f"], flip: { f: Z_FLAG }, every: true, reachEvery: true }],
  });
  for (const r of exits) {
    assert.equal(r.dead.stopped, null, `${r.label}: the poisoned run stopped early: ${r.dead.stopped}`);
    // EXIT CONTROL: SP moved where this hands back; the ROM returns through it, so every tape hears it.
    assert.ok(heard(r.exitControl),
      `${r.label}: the exit control was not heard, so the exit poison never lands`);
  }
  console.log(`  DEAD AT EXIT: A and F-but-Z complemented, nothing moves; Z and exit controls heard ` +
    `on every tape (${exits.map((r) => `${r.label} ${heardAs(r.exitControl)}`).join("; ")})`);
});

test("THE RETURN IS THE SEAM'S: the rewrite leaves SP where it found it; placed, it lands where the oracle does", { skip }, () => {
  let n = 0;
  for (const e of driven()) {
    const seat = e.regs.sp;
    const ref = e.clone();
    const raw = e.clone();
    const put = e.clone();
    const own = e.clone();
    oracle(ref);
    drawInterpolatedPenRun(raw);
    placed(drawInterpolatedPenRun)(put);
    brokenOwnReturn(own);
    assert.equal(raw.regs.sp, seat, "called directly the rewrite must not move SP -- it has no return slot to pop");
    assert.equal(put.regs.sp, ref.regs.sp, "placed through the seam the rewrite must leave SP where the oracle does");
    assert.equal(put.pc, ref.pc, "placed through the seam control must resume where the oracle's ret sends it");
    // The control: the neutrality check SEES a rewrite that pops a slot of its own.
    assert.equal((own.regs.sp - seat) & 0xffff, 2, "the own-return control did not move SP, so the check above is blind");
    n++;
  }
  console.log(`  RETURN: ${n} dispatches -- raw SP unmoved, placed SP = oracle SP; the own-return control moves SP by 2`);
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  let widest = 0;
  let total = 0;
  for (const [label, opts] of TAPES) {
    const entries = capture(label, opts);
    assert.equal(entries.length, DISPATCHES[label], `the ${label} dispatch count moved`);
    for (const e of entries) {
      const sp = e.regs.sp;
      const a = e.clone();
      const b = e.clone();
      oracle(a);
      const reported = placed(drawInterpolatedPenRun)(b);
      const da = a.dumpState();
      const db = b.dumpState();
      for (let i = 0; i < da.length; i++) {
        if (da[i] === db[i]) continue;
        const addr = a.stateOffsetToAddr(i);
        if (addr !== null && addr < sp) widest = Math.max(widest, sp - addr);
        const inWindow = addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
        assert.ok(inWindow, `a ${label} dispatch diverged at ${hex(addr ?? 0)}`);
      }
      const stray = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k] && !REG_EXCLUDED.includes(k));
      assert.deepEqual(stray, [], `a ${label} dispatch moved a register outside the dead scratch set`);
      assert.equal(reported, oracleZ(a), `a ${label} dispatch returned a condition other than the oracle's Z`);
    }
    total += entries.length;
  }
  assert.equal(widest, SCRATCH_BYTES, "the widest scratch divergence moved: the window is wrong");
  console.log(`  CORPUS: ${total} dispatches over two sessions; widest scratch sp-${widest}`);
});

test("TEETH: the forgot-report count is exactly where the run index and the new row disagree on zero", { skip }, () => {
  let predicted = 0;
  for (const e of driven()) {
    const a = e.clone();
    oracle(a);
    if ((a.mem8[RUN_INDEX] === 0) !== (a.mem8[ROW_POS + 1] === 0)) predicted++;
  }
  assert.equal(predicted, CAUGHT["forgot-report"], "the forgot-report twin's predicted count moved");
  console.log(`  TEETH/forgot-report: predicted ${predicted} from the oracle's run index and row integer`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin's catch count on the real corpus is exactly what is recorded`, { skip }, () => {
    let caught = 0;
    for (const e of driven()) if (diverge(twin, e)) caught++;
    assert.equal(caught, CAUGHT[label], `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${driven().length} real dispatches`);
  });
}
