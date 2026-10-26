// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_13ca (ROM 0x13CA) — unpack a packed-BCD score into
 * display digits, pad a fixed-width field, then bubble a 3-byte-keyed record up a
 * descending table in the 0x61A5..0x61CA staging area.
 *
 * loc_13ca is reached ONLY at a player's game-over (last life lost), from loc_12f2 /
 * loc_1344 on their LIVES-hit-zero branch. It is NOT dispatched in attract, nor by a
 * brief coin+start run (verified: 0 dispatches over 9000 attract frames and a
 * coin+start tape), and it WRITES MEMORY + has a caller-skip guard, so it is validated
 * by MEMORY-equivalence against the frozen oracle over RAM (minus the stack scratch below the entry SP) + pc +
 * SP — never the full register file, never cycles — on a FRESH clone per case, using
 * CRAFTED entries (doc-06: a real attract-base machine + a surgical poke):
 *
 *   1. EQUAL (guard skip) — ATTRACT (0x6007) bit 0 set: the `rst 0x08` aborts after
 *      writing only 0x61C6 = A. Both players (A=0x01/HL=0x60B2, A=0x03/HL=0x60B5). Proven
 *      non-vacuous AND that the body did NOT run: the only non-stack RAM change is 0x61C6.
 *
 *   2. EQUAL (full body) — ATTRACT clear, across score/table seedings that drive every
 *      arm of the sort: immediate `ret c` (0 swaps), a single swap then stop, and the
 *      full 5-pass bubble (score 0xFFFFFF / 0x999999 over a zeroed region), for BOTH
 *      players, plus one real-attract-region score. The FULL oracle runs on both sides,
 *      so a wrong digit, pad, compare, swap span, or pointer step surfaces as divergent
 *      RAM. Coverage is asserted: the multi-pass case swaps through pass 5 (touches
 *      0x6107), and the arms span 0..5 swaps.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) nibble-order: unpacks LOW nibble first (high/low swapped) — caught on a
 *          distinct-digit score that stops before the sort can move the digits.
 *      (b) compare-direction: swaps the key comparison (keyHl < keyDe) so it stops
 *          instead of bubbling — caught on the 5-pass score (5 swaps vs 0).
 *
 * The idiomatic routine models the Z80 `ret` as a plain JS return (no stack modelling),
 * so runCandidate performs ONE m.ret() after the call to line pc + SP up with the oracle.
 * The oracle nets exactly one caller-return pop on EVERY exit — the normal terminal
 * `ret`, the `ret c` slot-found exit, and the `rst 0x08` guard skip — and only READS the
 * stack (popped bytes live in STACK_SCRATCH, excluded by the contract), so pc/SP line up
 * on all paths.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-13ca.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_13ca as oracle } from "../../translated/loc_13ca.js";
import { loc_13ca } from "../loc_13ca.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x13ca;
const ATTRACT = 0x6007;   // ATTRACT flag — bit 0 makes the rst-0x08 guard skip the body
const PARAM_SLOT = 0x61c6; // the A parameter is stored here before the guard
const P1_SCORE = 0x60b2;
const P2_SCORE = 0x60b5;
const RET_ADDR = 0x1312;   // a plausible caller return (loc_12f2's site after the call)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns { addr, a, b } or null.
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

// All non-stack RAM addresses that changed between two machines (for the guard-skip
// non-vacuity check: prove ONLY 0x61C6 moved).
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

/** Run the ORACLE on a fresh clone. It performs its own `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so
 * pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it does not touch pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only, so the
 *  register file is deliberately NOT compared. Returns human-readable mismatches. */
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

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values. loc_13ca is never dispatched here — its entry is crafted by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted game-over dispatch onto a clone of the base: a stack with a plausible
// caller return (so the terminal `ret` has a sane target), the ATTRACT flag, and the A /
// HL register parameters. `seed` optionally lays down score + table bytes.
function craft(base, { attract, a, hl, seed }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(ATTRACT, attract);
  m.regs.a = a;
  m.regs.hl = hl;
  if (seed) seed(m);
  return m;
}

// Seed helpers ---------------------------------------------------------------
const putScore = (hl, b0, b1, b2) => (m) => {
  m.mem.write8(hl, b0); m.mem.write8((hl + 1) & 0xffff, b1); m.mem.write8((hl + 2) & 0xffff, b2);
};
const zeroSortRegion = () => (m) => { for (let a = 0x6100; a < 0x6200; a++) m.mem.write8(a, 0); };
const setKey = (addr, b0, b1, b2) => (m) => {
  m.mem.write8(addr, b0); m.mem.write8((addr + 1) & 0xffff, b1); m.mem.write8((addr + 2) & 0xffff, b2);
};
const seedAll = (...fns) => (m) => fns.forEach((f) => f(m));

// -- 0. justification: not reached in attract ---------------------------------

test("REACHABILITY: 0x13ca is not dispatched in a plain attract window (justifies crafted entries)", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.equal(count, 0, "0x13ca unexpectedly dispatched in attract — capture it instead of crafting");
  console.log("  REACHABILITY: 0 natural 0x13ca dispatches in a 1200-frame attract window");
});

// -- 1. EQUAL (guard skip) ----------------------------------------------------

test("EQUAL (guard skip): ATTRACT set — loc_13ca == oracle, and only 0x61C6 is written", () => {
  const base = attractBase();
  const cases = [
    { name: "P1 skip", a: 0x01, hl: P1_SCORE },
    { name: "P2 skip", a: 0x03, hl: P2_SCORE },
  ];
  for (const { name, a, hl } of cases) {
    const entry = craft(base, { attract: 0x01, a, hl });
    const diffs = contractDiffs(entry, loc_13ca);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // The guard skipped the body: the ONLY non-stack RAM change is 0x61C6 = A.
    const changed = changedAddrs(entry, runOracle(entry), entry.regs.sp);
    assert.deepEqual(changed, [PARAM_SLOT], `${name}: guard did not skip cleanly — changed ${changed.map(hx)}`);
    assert.equal(runOracle(entry).mem.read8(PARAM_SLOT), a, `${name}: 0x61C6 should hold A`);
  }
  console.log("  EQUAL/skip: both players — guard aborts after writing only 0x61C6 = A, pc/SP aligned");
});

// -- 2. EQUAL (full body) -----------------------------------------------------

test("EQUAL (full body): ATTRACT clear — loc_13ca == oracle across every sort arm", () => {
  const base = attractBase();

  const cases = [
    // immediate ret c: tiny score, huge key at 0x61A5 -> stop on pass 1, 0 swaps.
    {
      name: "P1 immediate-retc", a: 0x01, hl: P1_SCORE,
      seed: seedAll(zeroSortRegion(), putScore(P1_SCORE, 0x00, 0x00, 0x01), setKey(0x61a5, 0xff, 0xff, 0xff)),
    },
    // one swap then stop: pass 1 swaps (key at 0x61A5 is zero), pass 2's key (0x6183) is huge -> stop.
    {
      name: "P1 one-swap", a: 0x01, hl: P1_SCORE,
      seed: seedAll(zeroSortRegion(), putScore(P1_SCORE, 0x50, 0x50, 0x50), setKey(0x6183, 0xff, 0xff, 0xff)),
    },
    // full 5-pass bubble: max score over a zeroed region never borrows -> swaps all 5 passes.
    {
      name: "P1 multi-pass 0xFFFFFF", a: 0x01, hl: P1_SCORE,
      seed: seedAll(zeroSortRegion(), putScore(P1_SCORE, 0xff, 0xff, 0xff)),
    },
    {
      name: "P2 multi-pass 0x999999", a: 0x03, hl: P2_SCORE,
      seed: seedAll(zeroSortRegion(), putScore(P2_SCORE, 0x99, 0x99, 0x99)),
    },
    // a distinct-nibble score, immediate stop — pins each digit independently (teeth target).
    {
      name: "P1 distinct-digits", a: 0x01, hl: P1_SCORE,
      seed: seedAll(zeroSortRegion(), putScore(P1_SCORE, 0x12, 0x34, 0x56), setKey(0x61a5, 0xff, 0xff, 0xff)),
    },
    // real attract-region score: sort runs over whatever attract left in 0x61xx.
    {
      name: "P1 real-region", a: 0x01, hl: P1_SCORE,
      seed: putScore(P1_SCORE, 0x00, 0x76, 0x50),
    },
  ];

  for (const { name, a, hl, seed } of cases) {
    const entry = craft(base, { attract: 0x00, a, hl, seed });
    const diffs = contractDiffs(entry, loc_13ca);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    // non-vacuous: the body actually wrote RAM.
    assert.ok(changedAddrs(entry, runOracle(entry), entry.regs.sp).length > 0, `${name}: body wrote nothing — vacuous`);
  }

  // Coverage assertion: the 5-pass case must actually reach pass 5 (swap span low = 0x6107).
  const multi = craft(base, { attract: 0x00, a: 0x01, hl: P1_SCORE, seed: seedAll(zeroSortRegion(), putScore(P1_SCORE, 0xff, 0xff, 0xff)) });
  const before = multi.clone(), after = runOracle(multi);
  assert.notEqual(after.mem.read8(0x6107), before.mem.read8(0x6107), "5-pass case never reached pass 5 — sort loop under-exercised");

  // Distinct-digits case pins the MSB-first unpack: 0x61B1.. = 5 6 3 4 1 2 for score 0x12,0x34,0x56.
  const dd = craft(base, { attract: 0x00, a: 0x01, hl: P1_SCORE, seed: seedAll(zeroSortRegion(), putScore(P1_SCORE, 0x12, 0x34, 0x56), setKey(0x61a5, 0xff, 0xff, 0xff)) });
  const ddOut = runOracle(dd);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((i) => ddOut.mem.read8(0x61b1 + i)),
    [5, 6, 3, 4, 1, 2],
    "digit unpack is not most-significant-nibble-first as asserted",
  );

  console.log("  EQUAL/body: 6 crafted arms (skip 0..5 swaps, both players, real region) identical; pass-5 + MSB-first pins verified");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): unpack LOW nibble first (high/low swapped). */
function brokenNibbleOrder(m) {
  const { mem, regs } = m;
  mem.write8(PARAM_SLOT, regs.a);
  if ((mem.read8(ATTRACT) & 0x01) !== 0) return;
  const src = regs.hl;
  for (let i = 0; i < 3; i++) mem.write8(0x61c7 + i, mem.read8((src + i) & 0xffff));
  for (let i = 0; i < 3; i++) {
    const byte = mem.read8(0x61c7 + 2 - i);
    mem.write8(0x61b1 + 2 * i, byte & 0x0f);        // BUG: low nibble first
    mem.write8(0x61b1 + 2 * i + 1, (byte >> 4) & 0x0f);
  }
  for (let i = 0; i < 14; i++) mem.write8(0x61b1 + 6 + i, 0x10);
  mem.write8(0x61b1 + 20, 0x3f);
  let hl = 0x61a5, de = 0x61c7;
  for (let pass = 0; pass < 5; pass++) {
    const kd = mem.read8(de) | (mem.read8(de + 1) << 8) | (mem.read8(de + 2) << 16);
    const kh = mem.read8(hl) | (mem.read8(hl + 1) << 8) | (mem.read8(hl + 2) << 16);
    if (kd < kh) return;
    for (let k = 0; k < 25; k++) { const ah = (hl + 2 - k) & 0xffff, ad = (de + 2 - k) & 0xffff; const t = mem.read8(ah); mem.write8(ah, mem.read8(ad)); mem.write8(ad, t); }
    hl = (hl - 34) & 0xffff; de = (de - 34) & 0xffff;
  }
}

/** Broken twin (b): compare direction swapped (keyHl < keyDe) — stops instead of bubbling. */
function brokenCompareDir(m) {
  const { mem, regs } = m;
  mem.write8(PARAM_SLOT, regs.a);
  if ((mem.read8(ATTRACT) & 0x01) !== 0) return;
  const src = regs.hl;
  for (let i = 0; i < 3; i++) mem.write8(0x61c7 + i, mem.read8((src + i) & 0xffff));
  for (let i = 0; i < 3; i++) {
    const byte = mem.read8(0x61c7 + 2 - i);
    mem.write8(0x61b1 + 2 * i, (byte >> 4) & 0x0f);
    mem.write8(0x61b1 + 2 * i + 1, byte & 0x0f);
  }
  for (let i = 0; i < 14; i++) mem.write8(0x61b1 + 6 + i, 0x10);
  mem.write8(0x61b1 + 20, 0x3f);
  let hl = 0x61a5, de = 0x61c7;
  for (let pass = 0; pass < 5; pass++) {
    const kd = mem.read8(de) | (mem.read8(de + 1) << 8) | (mem.read8(de + 2) << 16);
    const kh = mem.read8(hl) | (mem.read8(hl + 1) << 8) | (mem.read8(hl + 2) << 16);
    if (kh < kd) return; // BUG: direction swapped
    for (let k = 0; k < 25; k++) { const ah = (hl + 2 - k) & 0xffff, ad = (de + 2 - k) & 0xffff; const t = mem.read8(ah); mem.write8(ah, mem.read8(ad)); mem.write8(ad, t); }
    hl = (hl - 34) & 0xffff; de = (de - 34) & 0xffff;
  }
}

test("TEETH: the nibble-order twin and the compare-direction twin are CAUGHT", () => {
  const base = attractBase();

  // (a) nibble-order: distinct-digit score that stops before the sort moves the digits.
  const dd = craft(base, { attract: 0x00, a: 0x01, hl: P1_SCORE, seed: seedAll(zeroSortRegion(), putScore(P1_SCORE, 0x12, 0x34, 0x56), setKey(0x61a5, 0xff, 0xff, 0xff)) });
  const nibbleDiffs = contractDiffs(dd, brokenNibbleOrder);
  assert.ok(nibbleDiffs.length > 0, "the nibble-order twin escaped — the gate is worthless");

  // (b) compare-direction: 5-pass score. Correct swaps 5 times; the twin stops at 0.
  const multi = craft(base, { attract: 0x00, a: 0x01, hl: P1_SCORE, seed: seedAll(zeroSortRegion(), putScore(P1_SCORE, 0xff, 0xff, 0xff)) });
  const dirDiffs = contractDiffs(multi, brokenCompareDir);
  assert.ok(dirDiffs.length > 0, "the compare-direction twin escaped — the gate is worthless");

  console.log(`  TEETH: nibble-order caught (${nibbleDiffs[0]}); compare-direction caught (${dirDiffs[0]})`);
});
