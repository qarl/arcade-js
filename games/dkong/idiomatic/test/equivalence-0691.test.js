// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for awardRemainingBonusToScore (ROM 0x0691) — award two table-selected BCD score amounts from
 * the packed digit byte in BONUS_DISPLAY, one per nibble.
 *
 * awardRemainingBonusToScore's only input is the byte in BONUS_DISPLAY (0x638C): it runs the add-to-score task (addToScoreTask) with the
 * low nibble as payload, then with (high nibble + 0x0a) as payload. Everything downstream — the
 * BCD add, the repaint, the high-score promotion — is addToScoreTask's job and is covered by its own
 * gate (equivalence-051c). What THIS gate must prove is that awardRemainingBonusToScore feeds the correct two
 * payloads, in order, for EVERY possible byte. Since the memory effect is a pure function of that
 * one byte (on a fixed base), an EXHAUSTIVE sweep of all 256 values is a proof, not a sample —
 * exactly renderBonusDisplay's shape (its twin).
 *
 * The oracle pushes the packed byte and a call-return onto the stack and addToScoreTask nests further
 * pushes; on this crafted base all of that lands inside STACK_SCRATCH, which the memory-equivalence
 * contract excludes. The idiomatic candidate models no stack (plain JS returns + a direct addToScoreTask
 * call), so it never writes the stack — the compared region (RAM − the stack scratch below the entry SP) is clean on both
 * sides. Live-out is memory-only, so pc/SP are not compared (loc_062a tail-jumps in and no caller
 * reads a register back).
 *
 *   1. REACHABILITY — probe how often 0x0691 is dispatched in boot/attract (loc_062a's task-10
 *      A==0 arm). It may be rare or zero; the exhaustive sweep is the proof either way.
 *   2. EQUAL (exhaustive, P1) — awardRemainingBonusToScore == oracle over RAM − the stack scratch below the entry SP for all 256 values of
 *      BONUS_DISPLAY on a crafted P1 base (ATTRACT cleared; a score under a lower high score so adds and a
 *      promotion are observable), plus a non-vacuity check that byte 0x11 really added +100 then
 *      +1000 on both sides.
 *   3. EQUAL (exhaustive, P2) — the same sweep on a player-2 base, exercising addToScoreTask's P2 counter.
 *   4. TEETH (exhaustive) — two deliberately-broken twins, each of which the same sweep MUST catch:
 *        (a) no-offset — the second payload drops the +0x0a, selecting a "small" addend instead of a
 *            "large" one (pins the offset).
 *        (b) swapped-nibbles — the low nibble drives the second (offset) call and the high nibble the
 *            first, routing each digit to the wrong table half (pins the nibble routing).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0691.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0691 as oracle } from "../../translated/loc_0691.js";
import { awardRemainingBonusToScore } from "../awardRemainingBonusToScore.js";
import { addToScoreTask } from "../addToScoreTask.js"; // direct callee, reused to build faithful broken twins
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  ATTRACT,
  BONUS_DISPLAY,
  CURRENT_PLAYER,
  P1_SCORE,
  P2_SCORE,
  HIGH_SCORE,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0691;
const RET_ADDR = 0x02bf; // a plausible caller return (lands in STACK_SCRATCH, excluded)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns { addr, a, b } | null.
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

// A real, self-consistent machine (boot + a stretch of attract) so work RAM holds realistic values.
function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted awardRemainingBonusToScore base onto a clone: a stack with a plausible caller return, the guard /
// player flags, and the three-byte score (little-endian [lo,mid,hi]) and high score. The BONUS_DISPLAY
// input byte is written per sweep iteration, not here.
function craftBase(base, { attract = 0x00, player = 0, score, high }) {
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
  return m;
}

// One sweep entry: a clone of the crafted base with the BONUS_DISPLAY input byte set and frame machinery
// neutralised (clone() already sets nextNmi/nextBoundary = Infinity; re-asserted for clarity).
function makeEntry(craftedBase, byte) {
  const e = craftedBase.clone();
  e.mem.write8(BONUS_DISPLAY, byte & 0xff);
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

// Run the oracle and a candidate on two FRESH, byte-identical entries and diff RAM − the stack scratch below the entry SP.
function runPair(craftedBase, byte, candidate) {
  const a = makeEntry(craftedBase, byte); // oracle
  const aFloor = a.regs.sp;
  const b = makeEntry(craftedBase, byte); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiff(a, b, aFloor);
}

// Sweep all 256 input bytes; return the first mismatch (or null) and the count compared.
function fullSweep(craftedBase, candidate) {
  for (let v = 0; v < 256; v++) {
    const ram = runPair(craftedBase, v, candidate);
    if (ram) return { mismatch: { v, ram }, count: v + 1 };
  }
  return { mismatch: null, count: 256 };
}

const describe = (mm) =>
  mm && `at BONUS_DISPLAY=${hb(mm.v)}: RAM diverges at ${hx(mm.ram.addr ?? 0)} (${mm.ram.a}->${mm.ram.b})`;

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: probe natural 0x0691 dispatches in boot/attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  // 0x0691 is loc_062a's task-10 A==0 arm — it may be rare or never in attract; the exhaustive
  // sweep is the proof regardless. Just report the count.
  console.log(`  REACHABILITY: ${count} natural 0x0691 dispatches in 1500 frames (sweep is the proof either way)`);
});

// -- 1. EQUAL (exhaustive, player 1) ------------------------------------------

test("EQUAL (exhaustive, P1): awardRemainingBonusToScore == oracle over all 256 values of BONUS_DISPLAY", () => {
  const base = craftBase(attractBase(), {
    attract: 0x00, player: 0,
    score: [0x00, 0x00, 0x10], // 100000 in packed BCD, [lo,mid,hi]
    high: [0x00, 0x00, 0x00],  // lower than the score -> promotions are observable
  });

  const { mismatch, count } = fullSweep(base, awardRemainingBonusToScore);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 256, "must have compared the full 256-byte input space");

  // Non-vacuity: byte 0x11 -> low nibble 1 (+100) then high nibble 1 -> payload 11 (+1000). Both
  // sides must have actually moved the score by +1100 from the base's 100000.
  const before = base.mem.read8(P1_SCORE + 1); // mid byte before
  const o = makeEntry(base, 0x11); oracle(o);
  const c = makeEntry(base, 0x11); awardRemainingBonusToScore(c);
  assert.equal(o.mem.read8(P1_SCORE + 1), (before + 0x11) & 0xff, "oracle must have added +1100 (mid byte +0x11)");
  assert.equal(c.mem.read8(P1_SCORE + 1), o.mem.read8(P1_SCORE + 1), "candidate must match the oracle's added score");
  assert.notEqual(o.mem.read8(P1_SCORE + 1), before, "non-vacuity: the add must actually change the score");

  console.log(`  EQUAL/exhaustive P1: ${count} input bytes — RAM identical to the oracle`);
});

// -- 2. EQUAL (exhaustive, player 2) ------------------------------------------

test("EQUAL (exhaustive, P2): awardRemainingBonusToScore == oracle over all 256 values of BONUS_DISPLAY", () => {
  const base = craftBase(attractBase(), {
    attract: 0x00, player: 1,
    score: [0x50, 0x25, 0x00],
    high: [0x00, 0x00, 0x00],
  });
  const { mismatch, count } = fullSweep(base, awardRemainingBonusToScore);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 256, "must have compared the full 256-byte input space");
  console.log(`  EQUAL/exhaustive P2: ${count} input bytes — RAM identical to the oracle`);
});

// -- 3. TEETH (exhaustive) ----------------------------------------------------

// A faithful re-implementation of awardRemainingBonusToScore with a single switchable bug, so each twin is the real
// routine minus one correct behaviour (it reuses the real, gated addToScoreTask).
function brokenLoc0691(m, bug) {
  const { regs, mem } = m;
  const packed = mem.read8(BONUS_DISPLAY);

  // first digit
  regs.a = bug === "swap" ? ((packed >> 4) & 0x0f) : (packed & 0x0f); // BUG(swap): high nibble first
  addToScoreTask(m);

  // second digit
  let second;
  if (bug === "noOffset") second = (packed >> 4) & 0xff;                 // BUG: drops the +0x0a
  else if (bug === "swap") second = ((packed & 0x0f) + 0x0a) & 0xff;      // BUG: low nibble takes the offset call
  else second = ((packed >> 4) + 0x0a) & 0xff;                            // correct
  regs.a = second;
  addToScoreTask(m);
}

test("TEETH (exhaustive): no-offset and swapped-nibbles twins are CAUGHT", () => {
  const base = craftBase(attractBase(), {
    attract: 0x00, player: 0,
    score: [0x00, 0x00, 0x10],
    high: [0x00, 0x00, 0x00],
  });

  // Sanity: the correct routine passes the same sweep, so a caught twin is a real defect signal.
  assert.equal(fullSweep(base, awardRemainingBonusToScore).mismatch, null, "the correct routine must pass the sweep");

  const noOffset = fullSweep(base, (mm) => brokenLoc0691(mm, "noOffset")).mismatch;
  assert.notEqual(noOffset, null, "the sweep FAILED to catch a dropped +0x0a offset — the offset is unproven");

  const swap = fullSweep(base, (mm) => brokenLoc0691(mm, "swap")).mismatch;
  assert.notEqual(swap, null, "the sweep FAILED to catch swapped nibble routing — the nibble roles are unproven");

  console.log(`  TEETH: no-offset caught (${describe(noOffset)}); swapped-nibbles caught (${describe(swap)})`);
});
