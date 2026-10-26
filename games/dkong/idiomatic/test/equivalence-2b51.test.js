// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2b51 (ROM 0x2B51) — the unconditional caller-skip that
 * abandons the player-vs-tilemap probe cascade and unwinds past entry_2b1c.
 *
 * skip_2b51 is a LEAF that reads NO memory and writes NO memory: on the raw Z80 it
 * discards entry_2b29's return address and returns two levels up, so its only live
 * output is the caller-skip decision — always false (an unconditional skip). SP/PC
 * and the popped register are the Z80 return mechanism the idiomatic layer replaces
 * with a JS return; the bytes it pops sit in the dead STACK_SCRATCH region. So the
 * output does not depend on any input, and the contract is memory-only + the boolean:
 *
 *   1. REACHABILITY — 0x2B51 is really dispatched during attract (via entry_1c05 ->
 *      entry_2b1c -> entry_2b29's reject arm), so the captured arm is in-distribution.
 *
 *   2. EQUAL + PURITY (captured) — hook 0x2B51 in a real attract run, clone at each
 *      dispatch, and for every real state confirm (a) the oracle writes NO RAM
 *      (licensing the memory-only contract), (b) the oracle returns false, and
 *      (c) loc_2b51 reproduces the oracle over RAM (minus the stack scratch below the entry SP) and
 *      the boolean return.
 *
 *   3. EQUAL (crafted, state-independence) — vary the stack pointer, the popped
 *      register value, the bytes on the stack, and work RAM, all off a real
 *      attract-base machine, and confirm loc_2b51 == oracle every time. This proves
 *      the skip is state-INDEPENDENT: no input the routine is handed can change its
 *      RAM footprint (none) or its boolean (false).
 *
 *   4. TEETH — two broken twins, each MUST be caught by the same contract diff:
 *      (a) returns true instead of false — a failed skip; caught by the boolean check.
 *      (b) writes a live RAM cell (LEVEL, 0x6229) — caught by the RAM diff, proving
 *          the "writes nothing" contract has teeth (and that a stray write outside
 *          STACK_SCRATCH is not swallowed by the exclusion).
 *
 * The oracle is always run on a clone() (frame machinery neutralised:
 * nextNmi/nextBoundary = Infinity) so an m.step inside its `ret` cannot trip a live
 * NMI whose handler writes RAM and masquerades as an oracle side effect.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2b51.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b51 as oracle } from "../../translated/loc_2b51.js";
import { loc_2b51 } from "../loc_2b51.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2b51;
const TWIN_CELL = 0x6229; // LEVEL — a live work-RAM cell (outside the stack scratch below the entry SP) for teeth (b)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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
 * Full contract diff on a captured/crafted entry: run oracle and candidate on two
 * fresh, byte-identical clones and compare RAM (− STACK_SCRATCH) + the boolean
 * return. pc/SP are NOT compared — the idiomatic routine replaces the Z80 stack
 * unwind with a JS return, so its live-out is memory + the boolean only.
 */
function contractDiffs(entry, fn) {
  const o = entry.clone(); o.nextNmi = Infinity; o.nextBoundary = Infinity;
  const c = entry.clone(); c.nextNmi = Infinity; c.nextBoundary = Infinity;
  const oRet = oracle(o);
  const cRet = fn(c);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (oRet !== cRet) diffs.push(`return oracle=${oRet} cand=${cRet}`);
  return diffs;
}

/** Run the oracle on a fresh clone and report whether it wrote any RAM + its return. */
function oraclePurity(entry) {
  const o = entry.clone(); o.nextNmi = Infinity; o.nextBoundary = Infinity;
  const before = o.dumpState();
  const ret = oracle(o);
  const after = o.dumpState();
  const wroteAt = firstStateDiff(before, after, (off) => o.stateOffsetToAddr(off));
  return { ret, wroteAt };
}

// A real, self-consistent machine: boot + a stretch of attract so RAM holds realistic
// values. clone() neutralises the frame machinery.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// A crafted entry off the attract base: park SP inside STACK_SCRATCH (so the oracle's
// two pops read valid RAM and never touch I/O), then vary the popped register, the
// bytes the pops will read, and an arbitrary work-RAM cell. None of it may change the
// result — that is the point.
function craft(base, { sp = 0x6bf0, hl = 0x0000, a = 0x00, b = 0x00, stackWords = [], poke } = {}) {
  const m = base.clone();
  m.regs.sp = sp;
  m.regs.hl = hl;
  m.regs.a = a;
  m.regs.b = b;
  stackWords.forEach((w, i) => {
    m.mem.write8((sp + 2 * i) & 0xffff, w & 0xff);
    m.mem.write8((sp + 2 * i + 1) & 0xffff, (w >> 8) & 0xff);
  });
  if (poke) poke(m);
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

// Hook 0x2B51 in a real attract run and clone the machine at up to K real dispatches.
// The wrapper clones the entry state, then runs the oracle so the host game proceeds
// undisturbed to a clean stop.
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x2B51 is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(count > 0, "0x2B51 should be dispatched — reached via entry_1c05 -> entry_2b1c -> entry_2b29");
  console.log(`  REACHABILITY: ${count} natural 0x2B51 dispatches in 1500 frames`);
});

// -- 2. EQUAL + PURITY (captured) ---------------------------------------------

test("EQUAL + PURITY (captured): loc_2b51 == oracle on every real dispatch; oracle writes no RAM", () => {
  const caps = captureDispatches(200, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x2B51 dispatch during attract");

  for (const cap of caps) {
    // PURITY + the constant skip: the oracle mutates no RAM and returns false.
    const { ret, wroteAt } = oraclePurity(cap);
    assert.equal(
      wroteAt,
      null,
      wroteAt && `oracle wrote RAM at 0x${(wroteAt.addr ?? 0).toString(16)} (${wroteAt.a}->${wroteAt.b}) — not pure`,
    );
    assert.equal(ret, false, "the oracle's caller-skip decision is always false");

    // EQUAL: loc_2b51 reproduces the oracle over RAM − the stack scratch below the entry SP + the boolean.
    const diffs = contractDiffs(cap, loc_2b51);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL+PURITY/captured: ${caps.length} real dispatches identical to the oracle (all skip=false, no RAM written)`);
});

// -- 3. EQUAL (crafted, state-independence) -----------------------------------

test("EQUAL (crafted): loc_2b51 == oracle across varied stacks / registers / RAM — the skip is state-independent", () => {
  const base = attractBase();

  const cases = [
    { name: "baseline", opts: {} },
    { name: "high SP in stack scratch", opts: { sp: 0x6bfc } },
    { name: "low SP in stack scratch", opts: { sp: 0x6be2 } },
    { name: "nonzero popped register", opts: { hl: 0xabcd, a: 0xff, b: 0x7f } },
    { name: "varied stack bytes the pops read", opts: { sp: 0x6bf0, stackWords: [0x1234, 0x5678] } },
    { name: "different stack bytes", opts: { sp: 0x6bf0, stackWords: [0xffff, 0x0000] } },
    { name: "poked work RAM", opts: { poke: (m) => { m.mem.write8(0x6200, 0x01); m.mem.write8(0x6227, 0x02); m.mem.write8(TWIN_CELL, 0x63); } } },
    { name: "all varied at once", opts: { sp: 0x6be8, hl: 0x9999, a: 0x55, b: 0xaa, stackWords: [0x2b23, 0x1c08], poke: (m) => m.mem.write8(0x6205, 0x88) } },
  ];

  for (const { name, opts } of cases) {
    const entry = craft(base, opts);
    const { ret } = oraclePurity(entry);
    assert.equal(ret, false, `${name}: oracle should skip (false)`);
    const diffs = contractDiffs(entry, loc_2b51);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} varied states — RAM + return identical to the oracle (state-independent)`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): returns true — a failed caller-skip. */
function brokenReturnsTrue(m) {
  return true; // BUG: should be false; the cascade would not unwind
}

/** Broken twin (b): stamps a live RAM cell — violates "writes nothing". */
function brokenWritesRam(m) {
  m.mem.write8(TWIN_CELL, 0x63); // BUG: the routine writes no memory
  return false;
}

test("TEETH: the returns-true twin and the writes-RAM twin are both CAUGHT", () => {
  const base = attractBase();
  const entry = craft(base, { sp: 0x6bf0, poke: (m) => m.mem.write8(TWIN_CELL, 0x01) });

  // (a) wrong boolean — caught by the return check.
  const aDiffs = contractDiffs(entry, brokenReturnsTrue);
  assert.ok(aDiffs.length > 0, "the returns-true twin escaped — the boolean gate is worthless");
  assert.ok(
    aDiffs.some((d) => d.startsWith("return ")),
    `expected a return-value diff, got ${aDiffs.join("; ")}`,
  );

  // (b) stray RAM write — caught by the RAM diff, at TWIN_CELL (not swallowed by the
  // STACK_SCRATCH exclusion since it is outside that region).
  const bDiffs = contractDiffs(entry, brokenWritesRam);
  assert.ok(bDiffs.length > 0, "the writes-RAM twin escaped — the RAM gate is worthless");
  assert.ok(
    bDiffs.some((d) => d.startsWith(`RAM@${hx(TWIN_CELL)}`)),
    `expected a RAM diff at ${hx(TWIN_CELL)}, got ${bDiffs.join("; ")}`,
  );

  console.log(`  TEETH: returns-true caught (${aDiffs.join("; ")}); writes-RAM caught (${bDiffs.join("; ")})`);
});
