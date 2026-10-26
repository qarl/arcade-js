// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for sub_32d6 (ROM 0x32D6) — an object's interval down-counter
 * with a position-gated reload, tailing into the periodic-timer tick tickFireTimerAndRerollDirection.
 *
 * 0x32D6 hangs off the entry_3202 chain and is NEVER dispatched during attract
 * (re-derived: 0 in 2500 frames — see REACHABILITY below), so there are no real
 * captured dispatches to replay. ★ CORRECTION: this header used to call that chain
 * "(still-untranslated)". It is not — ROM 0x3202 has a frozen oracle AND a readable
 * twin, and is itself dispatched 481x in the same 2500 frames; what is true is only
 * that no attract path reaches 0x32D6 through it. The gate is therefore CRAFTED: a real boot/attract
 * base machine, cloned per case, with a surgical poke of the object record and
 * MARIO_Y that forces each of the five exit paths, crossed with tickFireTimerAndRerollDirection's own
 * timer/random arms so the tail is exercised both ways. Every case is compared
 * oracle-vs-candidate on the memory-equivalence contract (RAM − the stack scratch below the entry SP).
 *
 * The oracle dissolves a push16/ret bracket at the loc_330B tail (`call 0x330f`),
 * so on the three tick-out paths it WRITES the pushed return address into the dead
 * stack region; the idiomatic routine models no stack. STACK_SCRATCH is therefore
 * excluded from the RAM diff — every live cell is kept.
 *
 *   1. REACHABILITY — document that 0x32D6 is not live-dispatched (0 in attract),
 *      which is why the gate is crafted rather than captured.
 *   2. EQUAL (crafted) — all five exit paths (still-counting, step-to-zero tick,
 *      counter-zero-not-armed tick, armed+borrow tick, armed+no-borrow reload), the
 *      MARIO_Y == limit boundary (proves `<` not `<=`), the arm != 1 check (arm==2),
 *      tickFireTimerAndRerollDirection's timer-expiry random bit both ways, and a second record base — each
 *      identical to the oracle, with a coverage assertion that the intended path ran.
 *   3. TEETH — a twin that reads a STALE zero-test (the exact bug the oracle warns
 *      about): it decrements the counter but never takes the hit-zero branch. The
 *      same crafted suite MUST catch it on the step-to-zero case.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-32d6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_32d6 as oracle } from "../../translated/loc_32d6.js";
import { loc_32d6 as candidate } from "../loc_32d6.js";
import { tickFireTimerAndRerollDirection } from "../tickFireTimerAndRerollDirection.js";
import { Machine } from "../../machine.js";
import { MARIO_Y, RANDOM, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x32d6;
// The oracle ends every path with caller-return pops and, on the tick-out paths, a
// push16 of the call's return address. Point SP into the dead stack scratch so those
// reads/writes stay inside the excluded region and never touch I/O or live RAM.
const SAFE_SP = 0x6bf8;

// Object-record field offsets (relative to the record pointer / IX live-in).
const F_STATE = 0x0d;
const F_LIMIT = 0x0f;
const F_TIMER = 0x16; // tickFireTimerAndRerollDirection's periodic timer
const F_EXIT19 = 0x19;
const F_COUNTER = 0x1c;
const F_ARM = 0x1d;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

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

/** Run a function on a fresh clone and return the resulting machine. */
function runOn(entry, fn) {
  const c = entry.clone();
  fn(c);
  return c;
}

/** RAM − the stack scratch below the entry SP diff between the oracle and `fn` on identical clones. */
function ramDiff(entry, fn) {
  return firstRamDiff(runOn(entry, oracle), runOn(entry, fn), entry.regs.sp);
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values. The routine is never dispatched here; every path is crafted.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Craft one dispatch: clone the base, aim IX at a record, set a safe stack, and poke
// the record fields + MARIO_Y + RANDOM the routine (and its tickFireTimerAndRerollDirection tail) read.
function craft(base, o) {
  const m = base.clone();
  m.regs.sp = SAFE_SP;
  m.regs.ix = o.ix;
  const at = (off) => (o.ix + off) & 0xffff;
  m.mem.write8(at(F_COUNTER), o.counter);
  m.mem.write8(at(F_ARM), o.arm);
  m.mem.write8(at(F_LIMIT), o.limit ?? 0);
  m.mem.write8(at(F_STATE), o.state ?? 0x07);   // sentinel: any 0/1 seen was WRITTEN
  m.mem.write8(at(F_EXIT19), o.exit19 ?? 0x55); // nonzero: clearing to 0 is observable
  m.mem.write8(at(F_TIMER), o.timer ?? 0x05);   // tickFireTimerAndRerollDirection timer (nonzero => plain dec)
  m.mem.write8(MARIO_Y, o.marioY ?? 0);
  m.mem.write8(RANDOM, o.random ?? 0);
  return m;
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x32D6 is NOT dispatched in attract — the gate is crafted", () => {
  let count = 0;
  const host = new Machine(ROM, { overrides: new Map([[TARGET, () => { count++; }]]) });
  host.runFrames(2500);
  assert.equal(
    count,
    0,
    "0x32D6 became live-dispatched — add captured-dispatch coverage alongside the crafted gate",
  );
  console.log(`  REACHABILITY: 0x32D6 dispatched ${count}× in 2500 attract frames — crafted entries carry the gate`);
});

// -- 2. EQUAL (crafted, all five paths) ---------------------------------------

const IX_A = 0x6500; // record base well clear of MARIO_Y (0x6205) and I/O
const IX_B = 0x6700; // a second base to pin the record-offset math

// Each case names the path, the poke, and what the oracle MUST leave behind so we
// know the intended path actually ran (not a vacuous match).
const CASES = [
  {
    name: "still counting (dec != 0)",
    opts: { ix: IX_A, counter: 0x05, arm: 0x00 },
    expect: (m, at) => {
      assert.equal(m.mem.read8(at(F_COUNTER)), 0x04, "counter should step 5 -> 4");
      assert.equal(m.mem.read8(at(F_STATE)), 0x00, "state should reset to 0");
      assert.equal(m.mem.read8(at(F_EXIT19)), 0x55, "exit field must NOT be cleared (no tick)");
      assert.equal(m.mem.read8(at(F_TIMER)), 0x05, "timer untouched — tickFireTimerAndRerollDirection did not run");
    },
  },
  {
    name: "step to zero -> clear + tick (random bit SET)",
    opts: { ix: IX_A, counter: 0x01, arm: 0x00, exit19: 0x33, timer: 0x00, random: 0x01 },
    expect: (m, at) => {
      assert.equal(m.mem.read8(at(F_COUNTER)), 0x00, "counter cleared on the tick-out branch");
      assert.equal(m.mem.read8(at(F_EXIT19)), 0x00, "exit field cleared");
      assert.equal(m.mem.read8(at(F_TIMER)), 42, "tickFireTimerAndRerollDirection reloaded (43) then decremented to 42");
      assert.equal(m.mem.read8(at(F_STATE)), 0x01, "tickFireTimerAndRerollDirection advanced state on the set random bit");
    },
  },
  {
    name: "counter zero, not armed (arm=0) -> tick only",
    opts: { ix: IX_A, counter: 0x00, arm: 0x00, timer: 0x09, exit19: 0x44 },
    expect: (m, at) => {
      assert.equal(m.mem.read8(at(F_TIMER)), 0x08, "tickFireTimerAndRerollDirection decremented the timer");
      assert.equal(m.mem.read8(at(F_ARM)), 0x00, "arm untouched on the not-armed path");
      assert.equal(m.mem.read8(at(F_EXIT19)), 0x44, "exit field NOT cleared on the not-armed path");
      assert.equal(m.mem.read8(at(F_COUNTER)), 0x00, "counter stays zero");
    },
  },
  {
    name: "counter zero, arm=2 (not 1) -> tick only",
    opts: { ix: IX_A, counter: 0x00, arm: 0x02, timer: 0x03, exit19: 0x44 },
    expect: (m, at) => {
      assert.equal(m.mem.read8(at(F_TIMER)), 0x02, "tickFireTimerAndRerollDirection ran (arm != 1 takes the tick path)");
      assert.equal(m.mem.read8(at(F_ARM)), 0x02, "arm untouched (only the armed==1 path disarms)");
    },
  },
  {
    name: "counter zero, armed, MARIO_Y below limit (borrow) -> clear + tick (random CLEAR)",
    opts: { ix: IX_A, counter: 0x00, arm: 0x01, limit: 0x40, marioY: 0x10, exit19: 0x77, timer: 0x00, random: 0x00 },
    expect: (m, at) => {
      assert.equal(m.mem.read8(at(F_ARM)), 0x00, "armed path disarms");
      assert.equal(m.mem.read8(at(F_EXIT19)), 0x00, "exit field cleared on the borrow tick-out");
      assert.equal(m.mem.read8(at(F_TIMER)), 42, "tickFireTimerAndRerollDirection reloaded then decremented to 42");
      assert.equal(m.mem.read8(at(F_STATE)), 0x00, "state stays 0 on the clear random bit");
    },
  },
  {
    name: "counter zero, armed, MARIO_Y above limit (no borrow) -> reload",
    opts: { ix: IX_A, counter: 0x00, arm: 0x01, limit: 0x20, marioY: 0x30, exit19: 0x66, timer: 0x05 },
    expect: (m, at) => {
      assert.equal(m.mem.read8(at(F_ARM)), 0x00, "armed path disarms");
      assert.equal(m.mem.read8(at(F_COUNTER)), 0xff, "counter reloaded to 0xFF");
      assert.equal(m.mem.read8(at(F_STATE)), 0x00, "state reset to 0");
      assert.equal(m.mem.read8(at(F_EXIT19)), 0x66, "exit field NOT cleared on the reload path");
      assert.equal(m.mem.read8(at(F_TIMER)), 0x05, "timer untouched — tickFireTimerAndRerollDirection did not run");
    },
  },
  {
    name: "boundary: MARIO_Y == limit -> no borrow, reload (proves < not <=)",
    opts: { ix: IX_A, counter: 0x00, arm: 0x01, limit: 0x30, marioY: 0x30, timer: 0x05 },
    expect: (m, at) => {
      assert.equal(m.mem.read8(at(F_COUNTER)), 0xff, "equal MARIO_Y/limit must reload (borrow is strict <)");
      assert.equal(m.mem.read8(at(F_TIMER)), 0x05, "timer untouched — the reload path does not tick");
    },
  },
  {
    name: "second record base (offset math) — armed borrow tick",
    opts: { ix: IX_B, counter: 0x00, arm: 0x01, limit: 0x50, marioY: 0x20, exit19: 0x22, timer: 0x00, random: 0x01 },
    expect: (m, at) => {
      assert.equal(m.mem.read8(at(F_ARM)), 0x00, "armed path disarms at the second base too");
      assert.equal(m.mem.read8(at(F_EXIT19)), 0x00, "exit field cleared at the second base");
      assert.equal(m.mem.read8(at(F_TIMER)), 42, "tickFireTimerAndRerollDirection ran at the second base");
      assert.equal(m.mem.read8(at(F_STATE)), 0x01, "state advanced on the set random bit");
    },
  },
];

test("EQUAL (crafted): loc_32d6 == oracle on all five exit paths", () => {
  const base = attractBase();
  for (const { name, opts, expect } of CASES) {
    const entry = craft(base, opts);
    const diff = ramDiff(entry, candidate);
    assert.equal(
      diff,
      null,
      diff && `${name}: RAM diverges at ${hx(diff.addr)} oracle=${diff.a} cand=${diff.b}`,
    );
    // Coverage: confirm the oracle actually took the intended path.
    const after = runOn(entry, oracle);
    expect(after, (off) => (opts.ix + off) & 0xffff);
  }
  console.log(`  EQUAL/crafted: ${CASES.length} crafted paths identical to the oracle (RAM − the stack scratch below the entry SP)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: reads a STALE zero-test. It decrements the counter but always treats
 * it as "still counting", so it never takes the hit-zero clear+tick branch — the
 * exact bug the oracle header warns about (a bare (v-1)&0xff leaving the branch on a
 * stale non-zero test). Identical to the correct routine on every OTHER path.
 */
function brokenStaleZeroTest(m) {
  const { mem } = m;
  const record = m.regs.ix;
  const at = (off) => (record + off) & 0xffff;
  const clearExitAndTick = () => {
    mem.write8(at(F_EXIT19), 0);
    mem.write8(at(F_COUNTER), 0);
    tickFireTimerAndRerollDirection(m);
  };
  const counter = mem.read8(at(F_COUNTER));
  if (counter !== 0) {
    mem.write8(at(F_COUNTER), (counter - 1) & 0xff);
    mem.write8(at(F_STATE), 0); // BUG: always the still-counting exit, never hit-zero
    return;
  }
  if (mem.read8(at(F_ARM)) !== 1) {
    tickFireTimerAndRerollDirection(m);
    return;
  }
  mem.write8(at(F_ARM), 0);
  if (mem.read8(MARIO_Y) < mem.read8(at(F_LIMIT))) {
    clearExitAndTick();
    return;
  }
  mem.write8(at(F_COUNTER), 0xff);
  mem.write8(at(F_STATE), 0);
}

test("TEETH: the stale-zero-test twin is CAUGHT on the step-to-zero path", () => {
  const base = attractBase();

  // The twin diverges only where the counter steps to zero — exercise that case.
  const stepToZero = CASES.find((c) => c.opts.counter === 0x01);
  const entry = craft(base, stepToZero.opts);
  const diff = ramDiff(entry, brokenStaleZeroTest);
  assert.ok(diff !== null, "the stale-zero-test twin escaped — the gate is worthless");
  assert.ok(!inStack(diff.addr), `the caught diff must be a live cell, not stack scratch — got ${hx(diff.addr)}`);
  const recLo = stepToZero.opts.ix, recHi = recLo + 0x20;
  assert.ok(
    diff.addr >= recLo && diff.addr < recHi,
    `expected the divergence in the object record [${hx(recLo)},${hx(recHi)}), got ${hx(diff.addr)}`,
  );

  // And the whole crafted suite catches it (at least one case diffs).
  let caught = 0;
  for (const { opts } of CASES) {
    if (ramDiff(craft(base, opts), brokenStaleZeroTest) !== null) caught++;
  }
  assert.ok(caught >= 1, "the crafted suite failed to catch the stale-zero-test twin");

  console.log(`  TEETH: stale-zero-test twin caught at ${hx(diff.addr)} (${diff.a}->${diff.b}); ${caught}/${CASES.length} crafted cases diverge`);
});
