// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for addToScoreTask (ROM 0x051C) — the "add to a score" task: add a
 * table-selected packed-BCD amount to the player-up's three-byte score, repaint it,
 * and (if it now leads) copy it over the high score and repaint that too.
 *
 * The routine opens with a `rst 0x08` caller-skip guard, so every real dispatch during
 * attract (no credited game) takes the SKIP arm — captured and pinned here. The add /
 * compare / copy body is reached only with CRAFTED entries (a real attract-base machine
 * with ATTRACT cleared plus a surgical poke of the player / score / high-score / payload,
 * identically on both sides).
 *
 * The oracle nets exactly ONE caller-return pop on every path (the skip splices two
 * levels up; the two mid-compare `ret`s return; the tail `jp 0x05da` hands its own
 * caller-return to the renderer). So the idiomatic routine — which models no stack (plain
 * JS returns + direct callee calls) — is followed by one m.ret() in runCandidate to line
 * pc + SP up with the oracle. The oracle's internal push/return churn lands only inside
 * STACK_SCRATCH, excluded by the memory-equivalence contract.
 *
 *   1. EQUAL (captured) — hook 0x051C in a real boot/attract run and confirm addToScoreTask ==
 *      oracle over every real dispatch (RAM − the stack scratch below the entry SP, pc, SP).
 *   2. EQUAL (crafted) — drive every arm: attract skip; add-then-lower and add-then-equal
 *      no-promote exits; all three copy widths (top / middle / low byte first greater); a
 *      full BCD carry ripple; both players; and the byte-wrapped payload index.
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) ignores the attract caller-skip guard — runs the body when the oracle skips.
 *      (b) starts the add with a stray carry — perturbs the low score byte.
 *
 * (NOTE: the oracle's other famous subtlety — carrying the copy width instead of reloading
 * it to three — is NOT memory-observable and so is deliberately not a twin: the compare only
 * promotes after proving the upper bytes EQUAL, so re-copying those equal bytes writes the
 * identical values. Correct here means "does not needlessly touch them", a readability point
 * the reviewer owns, not a memory diff.)
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-051c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_051c as oracle } from "../../translated/loc_051c.js";
import { addToScoreTask } from "../addToScoreTask.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  ATTRACT,
  CURRENT_PLAYER,
  P1_SCORE,
  P2_SCORE,
  HIGH_SCORE,
} from "../names.js";

// direct callees, reused to build the broken twins faithfully (except the injected bug)
import { gameActiveGuard } from "../gameActiveGuard.js";
import { selectCurrentPlayerScoreCounter } from "../selectCurrentPlayerScoreCounter.js";
import { loc_056b } from "../loc_056b.js";
import { drawHighScore } from "../drawHighScore.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x051c;
const RET_ADDR = 0x02bf;        // a plausible task-dispatcher return (lands in STACK_SCRATCH, excluded)
const SCORE_ADDEND_TABLE = 0x3529;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone. It performs its own terminal return. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal return with one m.ret() so
 * pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it does not touch pc/SP itself).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  let c;
  try {
    c = runCandidate(entry, fn);
  } catch (e) {
    return [`candidate threw: ${e.message}`];
  }
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine (boot + a stretch of attract) so work RAM holds
// realistic values. The add/compare/copy body is never reached here; it is crafted.
function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted 0x051C dispatch onto a clone of the base: a stack with a plausible
// caller return, the guard/player flags, the three score bytes (little-endian: [lo,mid,hi]),
// the three high-score bytes, and the task payload left in the accumulator (written last).
function craft(base, { attract = 0x00, player = 0, score, high, payload }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(ATTRACT, attract);
  m.mem.write8(CURRENT_PLAYER, player);
  const b = player === 0 ? P1_SCORE : P2_SCORE;
  m.mem.write8(b + 0, score[0]);
  m.mem.write8(b + 1, score[1]);
  m.mem.write8(b + 2, score[2]);
  m.mem.write8(HIGH_SCORE + 0, high[0]);
  m.mem.write8(HIGH_SCORE + 1, high[1]);
  m.mem.write8(HIGH_SCORE + 2, high[2]);
  m.regs.a = payload;
  return m;
}

// Classify what the oracle did, for coverage/non-vacuity: how many high-score bytes it
// rewrote (the copy width, 0 = no promote) and whether the score bytes changed (add ran).
function classify(entry) {
  const before = entry.clone();
  const after = runOracle(entry);
  const b = entry.mem.read8(CURRENT_PLAYER) === 0 ? P1_SCORE : P2_SCORE;
  const scoreChanged =
    before.mem.read8(b) !== after.mem.read8(b) ||
    before.mem.read8(b + 1) !== after.mem.read8(b + 1) ||
    before.mem.read8(b + 2) !== after.mem.read8(b + 2);
  let copyWidth = 0;
  for (let i = 0; i < 3; i++) {
    if (before.mem.read8(HIGH_SCORE + i) !== after.mem.read8(HIGH_SCORE + i)) copyWidth++;
  }
  return { scoreChanged, copyWidth, promoted: copyWidth > 0 };
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x051C is dispatched during boot/attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.ok(count > 0, "0x051C should be dispatched — the score-add task runs in the demo");
  console.log(`  REACHABILITY: ${count} natural 0x051C dispatches in 1200 frames`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): addToScoreTask == oracle on every real dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.ok(caps.length >= 1, "expected at least one real 0x051C dispatch during boot/attract");

  let skips = 0, bodies = 0;
  for (const entry of caps) {
    const diffs = contractDiffs(entry, addToScoreTask);
    assert.equal(diffs.length, 0, `captured dispatch (ATTRACT=${entry.mem.read8(ATTRACT)}): ${diffs.join("; ")}`);
    if (entry.mem.read8(ATTRACT) & 0x01) skips++; else bodies++;
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (${skips} guard-skip, ${bodies} body)`);
});

// -- 2. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): skip / no-promote / all copy widths / carry / both players match", () => {
  const base = attractBase();

  const cases = [
    // attract skip: guard closed, nothing happens
    { name: "attract skip", opts: { attract: 0x01, player: 0, payload: 5, score: [0x00, 0x00, 0x10], high: [0x00, 0x00, 0x00] }, expect: { promoted: false } },
    // add, then new score LOWER than high -> no promote (non-vacuous add via +500)
    { name: "add then lower", opts: { attract: 0x00, player: 0, payload: 5, score: [0x00, 0x00, 0x10], high: [0x00, 0x00, 0x99] }, expect: { promoted: false, scoreChanged: true } },
    // add nothing, new score EQUAL to high -> no promote
    { name: "add then equal", opts: { attract: 0x00, player: 0, payload: 0, score: [0x12, 0x34, 0x56], high: [0x12, 0x34, 0x56] }, expect: { promoted: false } },
    // top byte greater -> copy all three (all copied bytes differ, so the copy is observable)
    { name: "copy width 3 (top byte)", opts: { attract: 0x00, player: 0, payload: 0, score: [0x11, 0x22, 0x50], high: [0x00, 0x00, 0x00] }, expect: { copyWidth: 3 } },
    // middle byte first greater -> copy the low two (top byte equal, not recopied)
    { name: "copy width 2 (middle byte)", opts: { attract: 0x00, player: 0, payload: 0, score: [0x11, 0x34, 0x00], high: [0x00, 0x00, 0x00] }, expect: { copyWidth: 2 } },
    // low byte first greater -> copy one (top + middle equal, not recopied)
    { name: "copy width 1 (low byte)", opts: { attract: 0x00, player: 0, payload: 0, score: [0x50, 0x00, 0x00], high: [0x00, 0x00, 0x00] }, expect: { copyWidth: 1 } },
    // full carry ripple across all three bytes (999900 + 100 -> 000000)
    { name: "carry ripple", opts: { attract: 0x00, player: 0, payload: 1, score: [0x00, 0x99, 0x99], high: [0xff, 0xff, 0xff] }, expect: { promoted: false, scoreChanged: true } },
    // byte-wrapped payload index: payload 11 -> +1000
    { name: "payload 11 (+1000) promote", opts: { attract: 0x00, player: 0, payload: 11, score: [0x11, 0x00, 0x50], high: [0x00, 0x00, 0x00] }, expect: { copyWidth: 3, scoreChanged: true } },
    // player 2 score base + add + promote
    { name: "P2 add then copy width 2", opts: { attract: 0x00, player: 1, payload: 9, score: [0x11, 0x10, 0x00], high: [0x00, 0x00, 0x00] }, expect: { copyWidth: 2, scoreChanged: true } },
    { name: "P2 copy width 3", opts: { attract: 0x00, player: 1, payload: 0, score: [0x11, 0x22, 0x50], high: [0x00, 0x00, 0x00] }, expect: { copyWidth: 3 } },
  ];

  const seen = { skip: 0, lower: 0, equal: 0, w1: 0, w2: 0, w3: 0 };
  for (const { name, opts, expect } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, addToScoreTask);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const cl = classify(entry);
    if (expect.promoted === false) assert.equal(cl.promoted, false, `${name}: unexpectedly promoted`);
    if (expect.copyWidth != null) assert.equal(cl.copyWidth, expect.copyWidth, `${name}: copy width ${cl.copyWidth} != ${expect.copyWidth}`);
    if (expect.scoreChanged) assert.equal(cl.scoreChanged, true, `${name}: expected the add to change the score`);

    if (opts.attract & 0x01) seen.skip++;
    else if (cl.copyWidth === 3) seen.w3++;
    else if (cl.copyWidth === 2) seen.w2++;
    else if (cl.copyWidth === 1) seen.w1++;
    else if (cl.scoreChanged && !cl.promoted) seen.lower++;
    else seen.equal++;
  }
  // Non-vacuity: the suite genuinely exercised every arm.
  assert.ok(seen.skip >= 1 && seen.w1 >= 1 && seen.w2 >= 1 && seen.w3 >= 1, `missing an arm: ${JSON.stringify(seen)}`);
  console.log(`  EQUAL/crafted: ${cases.length} arms identical to the oracle ${JSON.stringify(seen)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

// A faithful re-implementation of addToScoreTask with a single switchable bug, so each twin is
// the real routine minus one correct behaviour.
function brokenLoc051c(m, bug) {
  const { regs, mem } = m;
  const payload = regs.a & 0xff;
  const active = gameActiveGuard(m);
  if (bug !== "noguard" && !active) return; // BUG(a): "noguard" runs the body during attract
  regs.de = selectCurrentPlayerScoreCounter(m);
  let addendPtr = (SCORE_ADDEND_TABLE + ((payload * 3) & 0xff)) & 0xffff;

  let carry = bug === "carry1" ? 1 : 0; // BUG(b): stray carry into the low byte
  for (let i = 0; i < 3; i++) {
    regs.a = mem.read8(regs.de);
    regs.add(mem.read8(addendPtr), carry);
    regs.daa();
    carry = regs.fC ? 1 : 0;
    mem.write8(regs.de, regs.a);
    regs.de = (regs.de + 1) & 0xffff;
    addendPtr = (addendPtr + 1) & 0xffff;
  }
  const scoreEnd = regs.de;
  regs.de = (scoreEnd - 1) & 0xffff;
  regs.a = mem.read8(CURRENT_PLAYER);
  loc_056b(m);

  regs.de = (scoreEnd - 1) & 0xffff;
  let hsPtr = (HIGH_SCORE + 2) & 0xffff;
  let width = 3;
  for (;;) {
    const scoreByte = mem.read8(regs.de);
    const hsByte = mem.read8(hsPtr);
    if (scoreByte < hsByte) return;
    if (scoreByte !== hsByte) break;
    regs.de = (regs.de - 1) & 0xffff;
    hsPtr = (hsPtr - 1) & 0xffff;
    width -= 1;
    if (width === 0) return;
  }

  regs.de = selectCurrentPlayerScoreCounter(m);
  let hsDst = HIGH_SCORE;
  for (let i = 0; i < width; i++) {
    mem.write8(hsDst, mem.read8(regs.de));
    regs.de = (regs.de + 1) & 0xffff;
    hsDst = (hsDst + 1) & 0xffff;
  }
  drawHighScore(m);
}

test("TEETH: the no-guard twin and the stray-carry twin are CAUGHT", () => {
  const base = attractBase();

  // (a) ignores the attract guard: on an attract entry the oracle skips (writes nothing) but
  //     the twin runs the body and adds +500 to the score. Caught at the changed score byte.
  const gEntry = craft(base, { attract: 0x01, player: 0, payload: 5, score: [0x00, 0x00, 0x10], high: [0x00, 0x00, 0x99] });
  assert.equal(classify(gEntry).scoreChanged, false, "guard-twin setup should be an attract SKIP for the oracle");
  assert.equal(contractDiffs(gEntry, addToScoreTask).length, 0, "correct routine diverged on the guard-twin setup");
  const gDiffs = contractDiffs(gEntry, (mm) => brokenLoc051c(mm, "noguard"));
  assert.ok(gDiffs.length > 0, "the no-guard twin escaped — the attract skip is unguarded");

  // (b) stray carry into the low byte: an add whose low byte would be 0x00 becomes 0x01.
  const cEntry = craft(base, { attract: 0x00, player: 0, payload: 5, score: [0x00, 0x00, 0x10], high: [0x00, 0x00, 0x99] });
  assert.equal(contractDiffs(cEntry, addToScoreTask).length, 0, "correct routine diverged on the carry-twin setup");
  const cDiffs = contractDiffs(cEntry, (mm) => brokenLoc051c(mm, "carry1"));
  assert.ok(cDiffs.length > 0, "the stray-carry twin escaped — the clear-carry start is unguarded");

  console.log(`  TEETH: no-guard caught (${gDiffs[0]}); stray-carry caught (${cDiffs[0]})`);
});
