// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for armAlternateFireModeAtHighDifficulty (ROM 0x31DD) — the difficulty+entropy gated object arm.
 *
 * sub_31dd stamps 2 into field +0x19 of records 1 and 3 of the 0x6400 object array
 * (0x6439 / 0x6479) only when TWO gates open: (1) difficulty (0x6380) passes a SIGNED
 * test on (difficulty - 3) — it proceeds while that stays non-negative as a signed byte,
 * so for difficulty in [3, 130] — and (2) the timing-entropy helper (loc_31f6, reading
 * RANDOM 0x6018 / FRAME 0x601A) returns exactly 1. Either gate closed → no write.
 *
 * The oracle calls the entropy helper with the translated `push16 0x31e6 / call 0x31f6`
 * bracket; the idiomatic routine dissolves that to a direct loc_31f6(m). So on any pass
 * that reaches the call, the oracle leaves the pushed return address (0x31e6) as dead
 * bytes in STACK_SCRATCH that the candidate never writes — hence the memory-equivalence
 * contract here is RAM − the stack scratch below the entry SP + pc + SP, and runCandidate performs ONE m.ret()
 * after the routine so pc + SP line up with the oracle's net single caller-return pop
 * (every oracle path nets exactly that). Live-out is memory-only; sub_31dd returns
 * nothing a caller consumes.
 *
 * The write is a pure function of just THREE bytes (difficulty, random, frame), so the
 * gates factor cleanly and an effectively-exhaustive proof is available:
 *
 *   1. EQUAL (difficulty gate, exhaustive) — sweep all 256 difficulty values with the
 *      entropy draw pinned OPEN (random=1, frame=1 → draw 1) and pinned CLOSED
 *      (random=0, frame=0 → draw 0). With the draw open the write happens iff the signed
 *      gate passes, so this exhaustively pins the [3,130] boundary INCLUDING the signed
 *      wrap at 0x83 and the {0,1,2} low end; with the draw closed nothing writes at any
 *      difficulty.
 *
 *   2. EQUAL (entropy gate, exhaustive) — at a passing difficulty (3), sweep the WHOLE
 *      256×256 (random, frame) space, so the write happens iff the draw is 1. This pins
 *      the ==1 comparison, the frame-substitution arm, and that no high bits of random
 *      matter. Together with (1) all four (gate-pass × draw) quadrants are covered.
 *
 *   3. TEETH — three deliberately-broken twins the same sweeps MUST catch:
 *        (a) unsigned (carry) difficulty gate — `difficulty < 3` instead of the signed
 *            sign-bit test; diverges at difficulty >= 0x83 (signed skips, carry writes).
 *        (b) dropped second write — writes 0x6439 but not 0x6479.
 *        (c) inverted entropy gate — writes when the draw is NOT 1.
 *
 *   4. REALISM — the caller DOES dispatch 0x31DD every attract pass (457 natural dispatches over
 *      the 2000 frames this test runs, when last measured; the test prints the live count rather
 *      than asserting the number), but difficulty stays 1 in attract, so every real dispatch takes
 *      the gate-1 (difficulty) skip — asserted here as zero writes. Those no-write captures must
 *      still match the oracle, and they do. The write/entropy arms are never
 *      reached live, so the sweeps carry them. The sweeps also run atop a real boot+attract
 *      base, so realistic surrounding RAM would expose any hidden dependence.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-31dd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_31dd as oracle } from "../../translated/loc_31dd.js";
import { armAlternateFireModeAtHighDifficulty } from "../armAlternateFireModeAtHighDifficulty.js";
import { DIFFICULTY, RANDOM, FRAME, OBJ_ARRAY_64, STACK_SCRATCH } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x31dd;
const RET_ADDR = 0x31b4; // the caller site right after `call 0x31dd` in entry_31b1
const WRITE_A = OBJ_ARRAY_64 + 0x39; // 0x6439 — record 1, field +0x19
const WRITE_B = OBJ_ARRAY_64 + 0x79; // 0x6479 — record 3, field +0x19

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

/**
 * A crafted 0x31DD dispatch on a clone of `base`: the three input cells, a pre-zeroed pair
 * of write targets (so a write to 2 is always observable), and a stack carrying a plausible
 * caller return so the terminal `ret` has a sane target. Frame machinery is neutralised.
 */
function makeEntry(base, difficulty, rand, frame) {
  const e = base.clone();
  e.mem.write8(DIFFICULTY, difficulty);
  e.mem.write8(RANDOM, rand);
  e.mem.write8(FRAME, frame);
  e.mem.write8(WRITE_A, 0x00);
  e.mem.write8(WRITE_B, 0x00);
  e.regs.sp = 0x6c00;
  e.push16(RET_ADDR);
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret` (and the entropy
 *  helper's call/return bracket) internally, resolving 0x31f6 to the translated oracle. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single terminal `ret` with one m.ret()
 * so pc + SP match the oracle's net one-pop (the idiomatic routine replaces the Z80 stack
 * with the JS call stack, so it touches no pc/SP itself).
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
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// Did the oracle take the write path on this entry? (WRITE_A/B become 2.)
function oracleWrote(entry) {
  const o = runOracle(entry);
  return o.mem.read8(WRITE_A) === 0x02 && o.mem.read8(WRITE_B) === 0x02;
}

// The signed gate the oracle applies: it proceeds (does NOT skip) iff (difficulty - 3) is
// non-negative as a signed byte — i.e. difficulty in [3, 130].
const difficultyGatePasses = (d) => (u8(d - 3) & 0x80) === 0;

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic
// values. The routine's own inputs are then poked on top per combo.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REALISM (captured): every real 0x31DD dispatch (if any) matches the oracle", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 200) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);

  let wrote = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, armAlternateFireModeAtHighDifficulty);
    assert.equal(diffs.length, 0, `real dispatch: ${diffs.join("; ")}`);
    if (oracleWrote(cap)) wrote++;
  }
  // Attract keeps difficulty at 1, so every real dispatch takes the gate-1 skip (no write);
  // the write/entropy arms are covered by the sweeps below, not by attract.
  assert.equal(wrote, 0, "attract dispatches should all take the difficulty-skip path (no write)");
  console.log(`  REALISM/captured: ${caps.length} natural 0x31DD dispatches in 2000 frames — all match the oracle, all on the difficulty-skip path (write arm covered by the sweep)`);
});

// -- 1. EQUAL (difficulty gate, exhaustive over all 256 difficulties) ---------

test("EQUAL (difficulty gate): armAlternateFireModeAtHighDifficulty == oracle over all 256 difficulties, draw open and closed", () => {
  const base = attractBase();
  let writes = 0;
  for (let d = 0; d < 256; d++) {
    // draw OPEN (random=1, frame=1 → entropy draw 1): write happens iff the signed gate passes.
    const open = makeEntry(base, d, 0x01, 0x01);
    const openDiffs = contractDiffs(open, armAlternateFireModeAtHighDifficulty);
    assert.equal(openDiffs.length, 0, `difficulty=${hx(d)} (draw open): ${openDiffs.join("; ")}`);
    // Independent oracle sanity: the write path is taken exactly on the passing difficulties.
    assert.equal(
      oracleWrote(open),
      difficultyGatePasses(d),
      `difficulty=${hx(d)}: oracle write-path disagrees with the signed gate`,
    );
    if (oracleWrote(open)) writes++;

    // draw CLOSED (random=0, frame=0 → entropy draw 0): nothing writes at any difficulty.
    const closed = makeEntry(base, d, 0x00, 0x00);
    const closedDiffs = contractDiffs(closed, armAlternateFireModeAtHighDifficulty);
    assert.equal(closedDiffs.length, 0, `difficulty=${hx(d)} (draw closed): ${closedDiffs.join("; ")}`);
    assert.equal(oracleWrote(closed), false, `difficulty=${hx(d)}: draw closed must not write`);
  }
  // Non-vacuity: the write path was genuinely exercised (exactly the [3,130] window = 128).
  assert.equal(writes, 128, `expected 128 write-path difficulties (the signed [3,130] window), saw ${writes}`);
  console.log(`  EQUAL/difficulty: 256 difficulties × {draw open, draw closed} — identical; ${writes} write-path combos`);
});

// -- 2. EQUAL (entropy gate, exhaustive over the whole random×frame space) -----

test("EQUAL (entropy gate): armAlternateFireModeAtHighDifficulty == oracle over all 256×256 (random, frame) at a passing difficulty", () => {
  const base = attractBase();
  const d = 3; // a passing difficulty, so the write happens iff the entropy draw is 1
  let combos = 0, writes = 0;
  for (let r = 0; r < 256; r++) {
    for (let f = 0; f < 256; f++) {
      const entry = makeEntry(base, d, r, f);
      const diffs = contractDiffs(entry, armAlternateFireModeAtHighDifficulty);
      assert.equal(diffs.length, 0, `random=${hx(r)} frame=${hx(f)}: ${diffs.join("; ")}`);
      // The draw is 1 exactly when (random&3)==1 and frame==1.
      const drawIsOne = (r & 0x03) === 1 && f === 1;
      assert.equal(oracleWrote(entry), drawIsOne, `random=${hx(r)} frame=${hx(f)}: write-path disagrees with the draw`);
      if (drawIsOne) writes++;
      combos++;
    }
  }
  assert.equal(combos, 256 * 256, "must have compared the whole (random, frame) space");
  assert.ok(writes > 0, "expected some write-path combos in the entropy sweep");
  console.log(`  EQUAL/entropy: ${combos} (random, frame) combos at difficulty 3 — identical; ${writes} write-path combos`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): unsigned (carry) difficulty gate — skips on `difficulty < 3` instead of the
 *  signed sign-bit test, so it wrongly PROCEEDS for difficulty >= 0x83. */
function brokenCarryGate(m) {
  const { mem } = m;
  if (mem.read8(DIFFICULTY) < 3) return; // BUG: unsigned compare, not the signed sign bit
  if (loc_31f6Draw(m) !== 1) return;
  mem.write8(WRITE_A, 2);
  mem.write8(WRITE_B, 2);
}

/** BUG (b): drops the second write (arms record 1 but not record 3). */
function brokenDropSecondWrite(m) {
  const { mem } = m;
  if ((u8(mem.read8(DIFFICULTY) - 3) & 0x80) !== 0) return;
  if (loc_31f6Draw(m) !== 1) return;
  mem.write8(WRITE_A, 2); // BUG: never writes WRITE_B
}

/** BUG (c): inverted entropy gate — writes when the draw is NOT 1. */
function brokenInvertEntropy(m) {
  const { mem } = m;
  if ((u8(mem.read8(DIFFICULTY) - 3) & 0x80) !== 0) return;
  if (loc_31f6Draw(m) === 1) return; // BUG: sense inverted
  mem.write8(WRITE_A, 2);
  mem.write8(WRITE_B, 2);
}

// The twins need the same entropy draw the real routine uses; recompute it inline (the
// oracle's translated 0x31f6 is memory-equivalent to this, proven in equivalence-31f6).
function loc_31f6Draw(m) {
  const { mem } = m;
  const lowBits = mem.read8(RANDOM) & 0x03;
  if (lowBits !== 1) return lowBits;
  return mem.read8(FRAME);
}

// Sweep a twin over the union of both EQUAL spaces; return the first contract mismatch.
function sweepForMismatch(base, twin) {
  for (let d = 0; d < 256; d++) {
    for (const [r, f] of [[0x01, 0x01], [0x00, 0x00]]) {
      const diffs = contractDiffs(makeEntry(base, d, r, f), twin);
      if (diffs.length) return { where: `difficulty=${hx(d)} random=${hx(r)} frame=${hx(f)}`, diffs };
    }
  }
  const d = 3;
  for (let r = 0; r < 256; r++) {
    for (let f = 0; f < 256; f++) {
      const diffs = contractDiffs(makeEntry(base, d, r, f), twin);
      if (diffs.length) return { where: `difficulty=${hx(d)} random=${hx(r)} frame=${hx(f)}`, diffs };
    }
  }
  return null;
}

test("TEETH: the unsigned-gate twin is CAUGHT (diverges past difficulty 0x83)", () => {
  const base = attractBase();
  const mm = sweepForMismatch(base, brokenCarryGate);
  assert.notEqual(mm, null, "the sweep FAILED to catch an unsigned difficulty gate — the signed test is unproven");
  console.log(`  TEETH/carry-gate: caught at ${mm.where} — ${mm.diffs.join("; ")}`);
});

test("TEETH: the dropped-second-write twin is CAUGHT", () => {
  const base = attractBase();
  const mm = sweepForMismatch(base, brokenDropSecondWrite);
  assert.notEqual(mm, null, "the sweep FAILED to catch a dropped second write — worthless");
  assert.ok(mm.diffs[0].startsWith(`RAM@${hx(WRITE_B)}`), `expected the diff at ${hx(WRITE_B)}, got ${mm.diffs[0]}`);
  console.log(`  TEETH/drop-write: caught at ${mm.where} — ${mm.diffs.join("; ")}`);
});

test("TEETH: the inverted-entropy-gate twin is CAUGHT", () => {
  const base = attractBase();
  const mm = sweepForMismatch(base, brokenInvertEntropy);
  assert.notEqual(mm, null, "the sweep FAILED to catch an inverted entropy gate — worthless");
  console.log(`  TEETH/invert-entropy: caught at ${mm.where} — ${mm.diffs.join("; ")}`);
});
