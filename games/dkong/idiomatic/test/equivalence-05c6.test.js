// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_05c6 (ROM 0x05C6) — the score-counter draw task. It selects
 * one of the three on-screen score readouts from the task payload and repaints it:
 *   • payload 0 -> player 1's score (source P1_SCORE + 2) up column 0x7781,
 *   • payload 1 (or any other nonzero) -> player 2's score (source P2_SCORE + 2) up
 *     column 0x7521,
 *   • payload 2 -> the high score up its fixed column 0x7641 (via drawHighScore),
 *   • payload 3 -> the un-lifted ROM 0x05E0 arm, which BOTH sides surface as a fault.
 *
 * Each render arm tail-jumps through the shared BCD renderer, whose final `ret` pops the
 * task's caller-return — the ONE net stack change on every rendering path; the per-digit
 * push16/pop pairs cancel and touch only bytes inside STACK_SCRATCH, excluded by the
 * contract. The idiomatic routine models no stack (a plain JS return + direct callee
 * calls), so the harness performs one m.ret() on the candidate clone AFTER the call to
 * line pc + SP up with the oracle. So it is gated on MEMORY-EQUIVALENCE — RAM −
 * STACK_SCRATCH + pc + SP + the registers it reproduces — not a returned scalar, and every
 * case runs on a FRESH clone.
 *
 * GROUNDING — attract dispatches 0x05C6 (the demo racks up score, enqueuing the score-draw
 * task), with payloads 0 and 2 seen, so real captured dispatches ground the player-1 and
 * high-score arms. Crafted entries then pin what attract does not vary:
 *   1. EQUAL (real) — every real captured 0x05C6 dispatch reproduced exactly.
 *   2. EQUAL (crafted) — the player-2 arm (payload 1), a higher payload (0x05, still the
 *      player-2 counter up the nonzero column), and payloads 0/2 over differing-nibble
 *      score bytes, each seeded from real attract RAM, identical on both sides. Each arm's
 *      base cell is checked to hold the selected counter's top digit (non-vacuity + proof
 *      the right counter reached the right column).
 *   3. FAULT (payload 3) — both the oracle and loc_05c6 throw, and neither writes non-stack
 *      RAM before doing so.
 *   4. TEETH — two twins the gate MUST catch: (a) SWAPS the player-1/player-2 source, so
 *      payload 0/1 render the wrong counter; (b) drops the payload-2 special case, so the
 *      high score renders through the column selector (P2 counter up 0x7521) instead of its
 *      fixed column 0x7641.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-05c6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_05c6 as oracle } from "../../translated/loc_05c6.js";
import { drawScoreTask as loc_05c6 } from "../drawScoreTask.js";
import { loc_056b } from "../loc_056b.js";
import { drawHighScore } from "../drawHighScore.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, P1_SCORE, P2_SCORE, HIGH_SCORE } from "../names.js";
import { NotImplemented } from "../../../../boards/dkong/io.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x05c6; // the score-counter draw task
const COLUMN_P1 = 0x7781; // player-1 score column base (selector zero)
const COLUMN_P2 = 0x7521; // player-2 score column base (nonzero selector)
const COLUMN_HS = 0x7641; // high-score fixed column base
const SAFE_SP = 0x6bfe; // inside STACK_SCRATCH: the renderer's pushes/pops + the final ret land here
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the dead
 * stack region the standard gate excludes (the renderer's per-digit push16/pop live there).
 */
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

// Every non-stack RAM address that changed between two machines (for the no-write check
// on the fault path).
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP, and
 * every register the routine reproduces (A/B/HL/IX/DE). LIVE-OUT is memory-only — the task
 * returns to the main loop, which reloads its registers — but the registers are reproduced
 * identically to the oracle and pinned here for extra teeth. Returns human-readable
 * mismatches (empty = equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  let c;
  try {
    c = runCandidate(entry, fn);
  } catch (e) {
    // A candidate that FAULTS where the oracle succeeds is definitively not equivalent.
    return [`candidate threw: ${e.message}`];
  }
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=${hx(o.regs.a)} cand=${hx(c.regs.a)}`);
  if (o.regs.b !== c.regs.b) diffs.push(`B oracle=${hx(o.regs.b)} cand=${hx(c.regs.b)}`);
  if (o.regs.hl !== c.regs.hl) diffs.push(`HL oracle=0x${o.regs.hl.toString(16)} cand=0x${c.regs.hl.toString(16)}`);
  if (o.regs.ix !== c.regs.ix) diffs.push(`IX oracle=0x${o.regs.ix.toString(16)} cand=0x${c.regs.ix.toString(16)}`);
  if (o.regs.de !== c.regs.de) diffs.push(`DE oracle=0x${o.regs.de.toString(16)} cand=0x${c.regs.de.toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture / base -----------------------------------------------------------

/**
 * Hook 0x05C6 in a real attract run and clone the machine at up to K real dispatches. The
 * wrapper snapshots the entry state, then runs the oracle so the host game proceeds.
 */
function captureTargetStates(K, maxFrames) {
  const caps = [];
  const ov = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(maxFrames);
  return caps;
}

// A real, self-consistent machine (boot + a stretch of attract) to seed crafted entries
// with realistic RAM. clone() neutralises the frame machinery (nextNmi/nextBoundary = Inf).
function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// Lay down distinct, differing-nibble packed-BCD bytes at all three score counters so a
// mis-selected source or column renders an observably-wrong top digit. The most-significant
// pair (base + 2) is what the base cell of the column shows:
//   P1 top pair 0x91 -> base digit 9,  P2 top pair 0x52 -> base digit 5,
//   HIGH top pair 0x73 -> base digit 7.
function seedScores(m) {
  m.mem.write8(P1_SCORE + 0, 0xf0); m.mem.write8(P1_SCORE + 1, 0x2a); m.mem.write8(P1_SCORE + 2, 0x91);
  m.mem.write8(P2_SCORE + 0, 0xf0); m.mem.write8(P2_SCORE + 1, 0x2a); m.mem.write8(P2_SCORE + 2, 0x52);
  m.mem.write8(HIGH_SCORE + 0, 0xf0); m.mem.write8(HIGH_SCORE + 1, 0x2a); m.mem.write8(HIGH_SCORE + 2, 0x73);
}

// The column base and the top digit that base cell must show, per payload.
function expected(payload) {
  if (payload === 0) return { column: COLUMN_P1, baseDigit: 0x9 };
  if (payload === 2) return { column: COLUMN_HS, baseDigit: 0x7 };
  return { column: COLUMN_P2, baseDigit: 0x5 }; // payload 1 and any other nonzero
}

// A crafted 0x05C6 entry: real attract RAM, a safe stack in STACK_SCRATCH, seeded score
// digits, and the chosen payload in the selector register.
function craft(base, payload) {
  const e = base.clone();
  e.regs.sp = SAFE_SP;
  e.regs.a = payload;
  seedScores(e);
  return e;
}

// -- broken twins -------------------------------------------------------------

/**
 * Broken twin (a): SWAPS the player-1/player-2 source — payload 0 renders player 2's
 * counter and payload 1 renders player 1's. Caught via RAM (wrong digit tiles) on either
 * score arm.
 */
function brokenSwapSource(m) {
  const { regs } = m;
  const payload = regs.a;
  if (payload === 3) throw new NotImplemented("twin: 0x05E0 arm");
  if (payload === 2) { drawHighScore(m); return; }
  regs.de = (payload === 0 ? P2_SCORE : P1_SCORE) + 2; // BUG: sources swapped
  loc_056b(m);
}

/**
 * Broken twin (b): drops the payload-2 special case, so the high score renders through the
 * column selector — player 2's counter up column 0x7521 — instead of the record up its
 * fixed column 0x7641. Caught via RAM (the fixed column is never painted; the wrong column
 * is) and IX.
 */
function brokenHighScoreDispatch(m) {
  const { regs } = m;
  const payload = regs.a;
  if (payload === 3) throw new NotImplemented("twin: 0x05E0 arm");
  // BUG: no payload-2 branch — falls through to the column renderer.
  regs.de = (payload === 0 ? P1_SCORE : P2_SCORE) + 2;
  loc_056b(m);
}

// -- 1. reachability ----------------------------------------------------------

test("REACHABILITY: 0x05C6 is dispatched during attract", () => {
  let count = 0;
  const seen = new Set();
  const ov = new Map([[TARGET, (mm) => { count++; seen.add(mm.regs.a & 0xff); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.runFrames(6000);
  assert.ok(count > 0, "0x05C6 should be dispatched — the attract demo scores, enqueuing the score-draw task");
  console.log(`  REACHABILITY: ${count} natural 0x05C6 dispatches in 6000 frames (payloads ${[...seen].map(hx).join(", ")})`);
});

// -- 2. EQUAL (real) ----------------------------------------------------------

test("EQUAL (real): loc_05c6 == oracle on every real captured 0x05C6 dispatch", () => {
  const caps = captureTargetStates(32, 6000);
  assert.ok(caps.length >= 1, "expected >=1 real 0x05C6 dispatch in attract — grounding assumption broke");

  const seen = new Set();
  for (const entry of caps) {
    const payload = entry.regs.a & 0xff;
    seen.add(payload);
    const diffs = contractDiffs(entry, loc_05c6);
    assert.equal(diffs.length, 0, `payload=${hx(payload)}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/real: ${caps.length} real dispatch(es) identical to the oracle (payloads ${[...seen].map(hx).join(", ")})`);
});

// -- 3. EQUAL (crafted, all render arms) --------------------------------------

test("EQUAL (crafted): every render arm matches the oracle and paints the selected counter", () => {
  const base = attractBase();

  const payloads = [
    0x00, // player 1 -> column 0x7781
    0x01, // player 2 -> column 0x7521
    0x02, // high score -> column 0x7641
    0x05, // higher payload -> still player 2 up the nonzero column
  ];

  for (const payload of payloads) {
    const entry = craft(base, payload);
    const diffs = contractDiffs(entry, loc_05c6);
    assert.equal(diffs.length, 0, `payload ${hx(payload)}: ${diffs.join("; ")}`);

    // Non-vacuity + selection proof: the oracle painted the SELECTED counter's top digit
    // into the SELECTED column's base cell.
    const { column, baseDigit } = expected(payload);
    assert.equal(
      runOracle(entry).mem.read8(column),
      baseDigit,
      `payload ${hx(payload)}: base cell of column 0x${column.toString(16)} did not show the selected counter's top digit`,
    );
  }
  console.log(`  EQUAL/crafted: ${payloads.length} arms (P1, P2, high score, higher payload) identical to the oracle`);
});

// -- 4. FAULT (payload 3) -----------------------------------------------------

test("FAULT (payload 3): both the oracle and loc_05c6 throw, writing no non-stack RAM", () => {
  const entry = craft(attractBase(), 0x03);

  // The oracle faults on the un-lifted 0x05E0 arm...
  const oc = entry.clone();
  assert.throws(() => oracle(oc), NotImplemented, "the oracle should fault on the payload-3 (0x05E0) arm");
  // ...having written no non-stack RAM before it.
  assert.deepEqual(changedAddrs(entry, oc, entry.regs.sp), [], "the oracle wrote non-stack RAM before faulting on payload 3");

  // loc_05c6 faults the same way, and likewise writes nothing.
  const cc = entry.clone();
  assert.throws(() => loc_05c6(cc), NotImplemented, "loc_05c6 should fault on the payload-3 (0x05E0) arm");
  assert.deepEqual(changedAddrs(entry, cc, entry.regs.sp), [], "loc_05c6 wrote non-stack RAM before faulting on payload 3");

  console.log("  FAULT: payload 3 throws NotImplemented on both sides with no non-stack RAM written");
});

// -- 5. TEETH -----------------------------------------------------------------

test("TEETH: the swapped-source twin and the high-score-dispatch twin are CAUGHT", () => {
  const base = attractBase();

  // (a) swapped source: on the player-1 entry the oracle renders P1 (top digit 9) while
  //     the twin renders P2 (top digit 5) into the same column, and vice versa on the
  //     player-2 entry — caught on both.
  const p1 = craft(base, 0x00);
  const p2 = craft(base, 0x01);
  assert.equal(contractDiffs(p1, loc_05c6).length, 0, "correct routine diverged on the payload-0 setup");
  assert.equal(contractDiffs(p2, loc_05c6).length, 0, "correct routine diverged on the payload-1 setup");
  const swapP1 = contractDiffs(p1, brokenSwapSource);
  const swapP2 = contractDiffs(p2, brokenSwapSource);
  assert.ok(swapP1.length > 0, "the swapped-source twin escaped on the player-1 entry — the source select is unguarded");
  assert.ok(swapP2.length > 0, "the swapped-source twin escaped on the player-2 entry — the source select is unguarded");

  // (b) high-score dispatch: on the payload-2 entry the oracle repaints the record up the
  //     fixed column 0x7641; the twin renders P2's counter up 0x7521 instead — caught.
  const hs = craft(base, 0x02);
  assert.equal(contractDiffs(hs, loc_05c6).length, 0, "correct routine diverged on the payload-2 setup");
  const hsDiffs = contractDiffs(hs, brokenHighScoreDispatch);
  assert.ok(hsDiffs.length > 0, "the high-score-dispatch twin escaped — the payload-2 special case is unguarded");
  // The correct routine paints the fixed column; the twin leaves it untouched.
  assert.equal(runOracle(hs).mem.read8(COLUMN_HS), 0x7, "correct routine did not paint the high-score fixed column");

  console.log(
    `  TEETH: swapped-source caught (P1: ${swapP1[0]} | P2: ${swapP2[0]}); ` +
      `high-score-dispatch caught (${hsDiffs[0]})`,
  );
});
