// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_13a1 (ROM 0x13A1) — the timer-gated 0x0702 sub-state
 * handler (table idx 0x17), twin of loc_138f.
 *
 * loc_13a1 is NEVER dispatched in attract or ordinary play (a probe hooked at 0x13a1
 * saw 0 dispatches over 1500 attract + 3000 coin-start frames): GAME_SUBSTATE never
 * reaches 0x17, so this defensively-wired table slot only ever runs if it is entered
 * directly. That rules out "real captured dispatches" — but it doesn't weaken the gate,
 * because the handler's entire memory-observable behaviour is a TOTAL FUNCTION of just
 * two bytes: SUBSTATE_TIMER (0x6009) and P1_CONTEXT (0x6040). It reads those two, writes
 * SUBSTATE_TIMER and GAME_SUBSTATE (0x600A), and touches nothing else outside the dead
 * stack region. So it is validated the strongest way — EXHAUSTIVELY:
 *
 *   1. EQUAL (exhaustive) — loc_13a1 == oracle over ALL 65,536 (0x6009, 0x6040) combos,
 *      compared on RAM − the stack scratch below the entry SP (the memory-equivalence contract). The oracle's
 *      push16 / rst-0x18 stack churn lands in STACK_SCRATCH and is excluded; the
 *      direct-call candidate leaves the stack alone. 256x256 is the complete input
 *      space, so this is a proof, not a sample.
 *
 *   2. TEETH (exhaustive) — two deliberately-broken twins the sweep MUST catch, one per
 *      memory location the routine owns:
 *        (a) inverted-selection — swaps the 0x17/0x14 arms of the P1-byte test; caught by
 *            the GAME_SUBSTATE (0x600A) diff on the expiry rows.
 *        (b) no-rearm — drops the `inc (hl)` that re-arms SUBSTATE_TIMER to 1 on expiry;
 *            caught by the SUBSTATE_TIMER (0x6009) diff on the expiry rows.
 *
 *   3. REALISM (crafted onto real in-game states) — attract can't reach idx 0x17, so we
 *      drive a coin+start game, hook 0x06fe, and clone REAL credited-game states. Onto
 *      each we poke the surgical nudge (GAME_SUBSTATE = 0x17) and both timer values
 *      (expiry / not-yet) crossed with a zero and a non-zero P1 byte, identically on both
 *      sides, then confirm loc_13a1 reproduces the oracle's RAM − the stack scratch below the entry SP against a
 *      realistic full-RAM background — not just a fresh machine.
 *
 * Contract: RAM − the stack scratch below the entry SP only. LIVE-OUT is memory-only; SP/PC are the rst-0x18
 * caller-skip mechanism the boolean early-return replaces, and the dispatcher ignores the
 * handler's residual registers/flags — so neither is compared (never the full register
 * file, never cycles).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-13a1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_13a1 as oracle } from "../../translated/loc_13a1.js";
import { loc_06fe as oracleDispatcher } from "../../translated/loc_06fe.js";
import { loc_13a1 } from "../loc_13a1.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { SUBSTATE_TIMER, GAME_SUBSTATE, P1_CONTEXT, STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x13a1;
const DISPATCHER = 0x06fe;
// The oracle's push16 + rst-0x18 pops read/write the stack; point SP low in work RAM so
// those accesses stay valid (never I/O). It only lands in STACK_SCRATCH, which is excluded
// from the diff, so it never affects the compared state.
const SAFE_SP = 0x6bf8;
// GAME_SUBSTATE's value on the base state — its natural dispatch value for this slot. On
// the not-yet-expired path the routine must leave it untouched; the RAM diff proves that.
const SUBSTATE_SENTINEL = 0x17;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

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

/**
 * Run the oracle and a candidate on two fresh clones of `entry` and diff the
 * memory-equivalence contract (RAM − the stack scratch below the entry SP). A FRESH clone per side because the
 * routine WRITES memory (docs/decompiler-pipeline: only a pure read-only leaf may reuse a clone).
 */
function runPair(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffExStack(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off), entry.regs.sp);
}

/** A synthetic entry: `base` with the two input bytes set, GAME_SUBSTATE at its sentinel,
 *  and a safe stack. */
function makeEntry(base, timer, p1) {
  const e = base.clone();
  e.mem.write8(SUBSTATE_TIMER, timer);
  e.mem.write8(P1_CONTEXT, p1);
  e.mem.write8(GAME_SUBSTATE, SUBSTATE_SENTINEL);
  e.regs.sp = SAFE_SP;
  return e;
}

/**
 * Sweep a candidate against the oracle over all 65,536 (0x6009, 0x6040) combos.
 * Returns the first RAM mismatch (or null) and the combo count.
 */
function sweep(base, candidate) {
  let count = 0;
  for (let timer = 0; timer < 256; timer++) {
    for (let p1 = 0; p1 < 256; p1++) {
      const ram = runPair(makeEntry(base, timer, p1), candidate);
      count++;
      if (ram) return { mismatch: { timer, p1, ram }, count };
    }
  }
  return { mismatch: null, count };
}

test("EQUAL (exhaustive): loc_13a1 == oracle over all 65,536 (0x6009,0x6040) combos", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, loc_13a1);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at 0x6009=${hx(mismatch.timer)} 0x6040=${hx(mismatch.p1)}: RAM diverges at ` +
        `0x${(mismatch.ram.addr ?? 0).toString(16)} (${mismatch.ram.a}->${mismatch.ram.b})`,
  );
  assert.equal(count, 256 * 256, "must have compared all 65,536 (timer,p1) combos");
  console.log(`  EQUAL/exhaustive: ${count} (0x6009,0x6040) combos — RAM − the stack scratch below the entry SP identical to the oracle`);
});

/** BUG: swaps the 0x17/0x14 arms of the P1-byte test — writes the WRONG GAME_SUBSTATE on
 *  expiry. Caught by the 0x600A diff (only on the expiry rows, 0x6009==1). */
function brokenInvertedSelection(m) {
  const { mem } = m;
  if (!tickSubstateTimer(m)) return;
  mem.write8(SUBSTATE_TIMER, (mem.read8(SUBSTATE_TIMER) + 1) & 0xff);
  const p1 = mem.read8(P1_CONTEXT);
  mem.write8(GAME_SUBSTATE, p1 !== 0 ? 0x14 : 0x17); // BUG: arms swapped
}

/** BUG: drops the `inc (hl)` re-arm — leaves SUBSTATE_TIMER at 0 on expiry instead of 1.
 *  Caught by the 0x6009 diff (only on the expiry rows, 0x6009==1). */
function brokenNoRearm(m) {
  const { mem } = m;
  if (!tickSubstateTimer(m)) return;
  // BUG: missing the re-arm write to SUBSTATE_TIMER
  const p1 = mem.read8(P1_CONTEXT);
  mem.write8(GAME_SUBSTATE, p1 !== 0 ? 0x17 : 0x14);
}

test("TEETH (exhaustive): the inverted-selection twin is CAUGHT (GAME_SUBSTATE has teeth)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, brokenInvertedSelection);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a swapped sub-state selection — it is worthless");
  assert.equal(mismatch.ram.addr, GAME_SUBSTATE, "the inverted-selection twin must be caught at GAME_SUBSTATE (0x600A)");
  console.log(
    `  TEETH/selection: caught after ${count} combos at 0x6009=${hx(mismatch.timer)} 0x6040=${hx(mismatch.p1)} ` +
      `(0x600A oracle=${mismatch.ram.a} broken=${mismatch.ram.b})`,
  );
});

test("TEETH (exhaustive): the no-rearm twin is CAUGHT (SUBSTATE_TIMER re-arm has teeth)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = sweep(base, brokenNoRearm);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped timer re-arm — it is worthless");
  assert.equal(mismatch.ram.addr, SUBSTATE_TIMER, "the no-rearm twin must be caught at SUBSTATE_TIMER (0x6009)");
  console.log(
    `  TEETH/re-arm: caught at 0x6009=${hx(mismatch.timer)} 0x6040=${hx(mismatch.p1)} ` +
      `(0x6009 oracle=${mismatch.ram.a} broken=${mismatch.ram.b})`,
  );
});

// A coin+start tape: coin on IN2 bit7 at frame 10, start1 on IN2 bit2 at frame 30. Credits
// and starts a game so GAME_STATE reaches 3 and the 0x06fe sub-state dispatcher runs.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

/**
 * Drive a coin+start game and clone the machine at up to K real 0x06fe dispatches — real,
 * fully-populated credited-game states. The wrapper clones then runs the oracle so the host
 * proceeds undisturbed; capturing is gated off after the run so isolated replays can't
 * pollute it.
 */
function captureInGameStates(K, maxFrames) {
  const caps = [];
  let capturing = true;
  // Wrap 0x06fe: clone the real state, then run the frozen dispatcher oracle so the host
  // game proceeds undisturbed to a clean stop.
  const snap = new Map([[DISPATCHER, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracleDispatcher(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

test("REALISM: crafted idx-0x17 entries on real credited-game states — RAM − the stack scratch below the entry SP matches", () => {
  const caps = captureInGameStates(6, 1500);
  assert.ok(caps.length >= 1, "expected at least one real in-game 0x06fe state to craft from");

  const TIMERS = [0x01, 0x05]; // expiry / not-yet-expired
  const P1S = [0x00, 0x03];    // zero / non-zero P1 context byte
  let compared = 0;
  for (const cap of caps) {
    for (const timer of TIMERS) {
      for (const p1 of P1S) {
        const entry = cap.clone();
        entry.mem.write8(SUBSTATE_TIMER, timer);
        entry.mem.write8(P1_CONTEXT, p1);
        entry.mem.write8(GAME_SUBSTATE, SUBSTATE_SENTINEL); // the surgical nudge into idx 0x17
        entry.regs.sp = SAFE_SP;
        const ram = runPair(entry, loc_13a1);
        assert.equal(
          ram,
          null,
          ram && `RAM diverged on crafted real state (0x6009=${hx(timer)} 0x6040=${hx(p1)}) at ` +
            `0x${(ram.addr ?? 0).toString(16)} (${ram.a}->${ram.b})`,
        );
        compared++;
      }
    }
  }
  console.log(`  REALISM: ${compared} crafted entries over ${caps.length} real in-game states — RAM − the stack scratch below the entry SP == oracle`);
});
