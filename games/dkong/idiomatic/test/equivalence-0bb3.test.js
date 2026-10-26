// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for runIntroRoarStep (ROM 0x0BB3) — the roar/finish step of the
 * opening Kong-climb cutscene (index 7 of the 0x0A7A INTRO_STEP table).
 *
 * The routine's whole memory-observable behaviour is a function of the entry RAM, and
 * the only branch selector is SUBSTATE_TIMER (0x6009): it fires the roar cue at 0x90,
 * bumps a cutscene sprite byte down at 0x18, and on the countdown's expiry (0x6009 == 1
 * after the rst-0x18 tick) wraps INTRO_STEP and advances GAME_SUBSTATE. Every other byte
 * it touches (0x6919, SND_PRIORITY/frames, INTRO_STEP, GAME_SUBSTATE) is written, not
 * branched on. The oracle's SP/PC churn is the rst/ret caller-skip mechanism (replaced by
 * tickSubstateTimer's boolean) and its A/F are dead ABI — none reach RAM, so the contract
 * is RAM only, minus the stack scratch below the entry SP (the oracle pushes a return address there; the direct
 * call does not — a benign, excluded difference).
 *
 * REACHABILITY. This is an IN-GAME cutscene step (GAME_SUBSTATE == 7): attract never enters
 * it (test 4 checks this — 0 dispatches over a long run). So there is no real dispatch to
 * capture; per docs/decompiler-pipeline the gate is crafted entries over a REAL attract base — a real state
 * with a surgical nudge — which still proves equivalence because both sides start from a
 * byte-identical clone:
 *
 *   1. EQUAL (exhaustive selector) — runIntroRoarStep == oracle over ALL 256 SUBSTATE_TIMER
 *      values on a real mid-attract base, compared on RAM minus the stack scratch below the entry SP. 256 values is
 *      the complete branch-selector space, covering the 0x90 / 0x18 / expiry / no-op arms.
 *
 *   2. EQUAL (wrap edges) — crafted entries that drive the ±1 bytes across their 8-bit wrap
 *      (0x6919 = 0xff at 0x90, 0x6919 = 0x00 at 0x18, GAME_SUBSTATE = 0xff at expiry) and set
 *      INTRO_STEP nonzero so its reset-to-0 on expiry is observable. Confirms the wraps match.
 *
 *   3. TEETH (exhaustive) — two deliberately-broken twins the sweep MUST catch:
 *        (a) swap the sprite inc/dec — caught at a top arm (memory check has teeth).
 *        (b) skip the GAME_SUBSTATE advance on expiry — caught at 0x6009 == 1 (proves the
 *            sweep actually reaches the expiry arm).
 *
 *   4. REACHABILITY (documented) — hook 0x0BB3 over a long attract run and confirm 0 real
 *      dispatches, recording WHY the gate is crafted-entry rather than captured.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0bb3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0bb3 as oracle } from "../../translated/loc_0bb3.js";
import { runIntroRoarStep } from "../runIntroRoarStep.js";
import { SUBSTATE_TIMER, INTRO_STEP, GAME_SUBSTATE, STACK_SCRATCH } from "../names.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0bb3;
const CUTSCENE_SPRITE_BYTE = 0x6919;
// The oracle push16's a return address onto the stack and its ret pops it; point SP at
// work RAM so those accesses stay in the excluded STACK_SCRATCH region and never hit I/O.
const SAFE_SP = 0x6bf8;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/** First differing RAM byte between two dumps, ignoring the stack scratch below the entry SP. */
function firstNonStackDiff(a, b, m, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = m.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { offset: i, addr, a: a[i], b: b[i] };
  }
  if (a.length !== b.length) return { offset: n, addr: null, a: a.length, b: b.length };
  return null;
}

/**
 * Run the oracle and a candidate on two FRESH clones of `entry` and diff RAM minus
 * STACK_SCRATCH. Fresh clones because the routine WRITES memory (docs/decompiler-pipeline: only a pure
 * read-only leaf may reuse a clone).
 */
function runPair(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstNonStackDiff(a.dumpState(), b.dumpState(), a, entry.regs.sp);
}

/** A real mid-attract machine state — realistic sprite buffer / RAM — with neutralised frame machinery. */
function realAttractBase() {
  const m = new Machine(ROM);
  m.runFrames(600);
  return m.clone();
}

/** A crafted entry: the base with SUBSTATE_TIMER = timer, extra byte pokes, and a safe stack. */
function makeEntry(base, timer, pokes = {}) {
  const e = base.clone();
  e.mem.write8(SUBSTATE_TIMER, timer);
  for (const [addr, val] of Object.entries(pokes)) e.mem.write8(Number(addr), val);
  e.regs.sp = SAFE_SP;
  return e;
}

/** Sweep a candidate against the oracle over all 256 SUBSTATE_TIMER values. */
function sweep(base, candidate) {
  let count = 0;
  for (let v = 0; v < 256; v++) {
    const d = runPair(makeEntry(base, v), candidate);
    count++;
    if (d) return { mismatch: { v, d }, count };
  }
  return { mismatch: null, count };
}

// -- 1. EQUAL (exhaustive selector) -------------------------------------------

test("EQUAL (exhaustive): runIntroRoarStep == oracle over all 256 SUBSTATE_TIMER values", () => {
  const base = realAttractBase();
  const { mismatch, count } = sweep(base, runIntroRoarStep);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at 0x6009=${hx(mismatch.v)}: RAM diverges at ${hx(mismatch.d.addr & 0xff)} ` +
        `(0x${(mismatch.d.addr ?? 0).toString(16)}: ${mismatch.d.a}->${mismatch.d.b})`,
  );
  assert.equal(count, 256, "must have compared all 256 SUBSTATE_TIMER values");
  console.log(`  EQUAL/exhaustive: ${count} SUBSTATE_TIMER values — RAM (minus stack) identical to the oracle`);
});

// -- 2. EQUAL (wrap edges) ----------------------------------------------------

test("EQUAL (wrap edges): the ±1 bytes match the oracle across their 8-bit wrap", () => {
  const base = realAttractBase();
  const edges = [
    { timer: 0x90, pokes: { [CUTSCENE_SPRITE_BYTE]: 0xff } }, // inc wraps 0xff -> 0x00
    { timer: 0x90, pokes: { [CUTSCENE_SPRITE_BYTE]: 0x00 } }, // inc 0x00 -> 0x01
    { timer: 0x18, pokes: { [CUTSCENE_SPRITE_BYTE]: 0x00 } }, // dec wraps 0x00 -> 0xff
    { timer: 0x18, pokes: { [CUTSCENE_SPRITE_BYTE]: 0xff } }, // dec 0xff -> 0xfe
    { timer: 0x01, pokes: { [GAME_SUBSTATE]: 0xff, [INTRO_STEP]: 0x07 } }, // expiry: inc 0x600A wraps + reset INTRO_STEP
    { timer: 0x01, pokes: { [GAME_SUBSTATE]: 0x07, [INTRO_STEP]: 0x07 } }, // expiry: normal advance 7 -> 8
  ];
  for (const { timer, pokes } of edges) {
    const d = runPair(makeEntry(base, timer, pokes), runIntroRoarStep);
    assert.equal(
      d,
      null,
      d && `wrap-edge mismatch at 0x6009=${hx(timer)} pokes=${JSON.stringify(pokes)}: ` +
        `RAM diverges at 0x${(d.addr ?? 0).toString(16)} (${d.a}->${d.b})`,
    );
  }
  console.log(`  EQUAL/wrap-edges: ${edges.length} crafted ±1-wrap entries identical to the oracle`);
});

// -- 3. TEETH (exhaustive) ----------------------------------------------------

/** BUG: swaps the sprite inc/dec — bumps DOWN at 0x90 and UP at 0x18. Caught at a top arm. */
function brokenSwapSpriteBump(m) {
  const { mem } = m;
  const countdown = mem.read8(SUBSTATE_TIMER);
  if (countdown === 0x90) {
    mem.write8(0x608a, 0x0f);
    mem.write8(0x608b, 0x03);
    mem.write8(CUTSCENE_SPRITE_BYTE, (mem.read8(CUTSCENE_SPRITE_BYTE) - 1) & 0xff); // BUG: dec, should inc
  } else if (countdown === 0x18) {
    mem.write8(CUTSCENE_SPRITE_BYTE, (mem.read8(CUTSCENE_SPRITE_BYTE) + 1) & 0xff); // BUG: inc, should dec
  }
  if (!tickSubstateTimer(m)) return;
  mem.write8(INTRO_STEP, 0);
  mem.write8(SUBSTATE_TIMER, (mem.read8(SUBSTATE_TIMER) + 1) & 0xff);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
}

/** BUG: skips the GAME_SUBSTATE advance on expiry — the cutscene never ends. Caught at 0x6009 == 1. */
function brokenSkipAdvance(m) {
  const { mem } = m;
  const countdown = mem.read8(SUBSTATE_TIMER);
  if (countdown === 0x90) {
    mem.write8(0x608a, 0x0f);
    mem.write8(0x608b, 0x03);
    mem.write8(CUTSCENE_SPRITE_BYTE, (mem.read8(CUTSCENE_SPRITE_BYTE) + 1) & 0xff);
  } else if (countdown === 0x18) {
    mem.write8(CUTSCENE_SPRITE_BYTE, (mem.read8(CUTSCENE_SPRITE_BYTE) - 1) & 0xff);
  }
  if (!tickSubstateTimer(m)) return;
  mem.write8(INTRO_STEP, 0);
  mem.write8(SUBSTATE_TIMER, (mem.read8(SUBSTATE_TIMER) + 1) & 0xff);
  // BUG: missing inc GAME_SUBSTATE
}

test("TEETH (exhaustive): the swapped-sprite-bump twin is CAUGHT (top-arm memory check has teeth)", () => {
  const base = realAttractBase();
  const { mismatch, count } = sweep(base, brokenSwapSpriteBump);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a swapped sprite inc/dec — the memory check is worthless");
  console.log(`  TEETH/top-arm: caught after ${count} values at 0x6009=${hx(mismatch.v)} (0x6919 diverged)`);
});

test("TEETH (exhaustive): the skipped-advance twin is CAUGHT (proves the sweep reaches expiry)", () => {
  const base = realAttractBase();
  const { mismatch, count } = sweep(base, brokenSkipAdvance);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a missing GAME_SUBSTATE advance — the expiry arm is untested");
  assert.equal(mismatch.v, 0x01, "the missing-advance bug must be caught exactly on the expiry arm (0x6009 == 1)");
  console.log(`  TEETH/expiry: caught at 0x6009=${hx(mismatch.v)} (GAME_SUBSTATE 0x600A not advanced)`);
});

// -- 4. REACHABILITY (documented) ---------------------------------------------

test("REACHABILITY: loc_0bb3 is an in-game cutscene step — attract never dispatches it", () => {
  let n = 0;
  const overrides = new Map([[TARGET, (mm) => { n++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(6000);
  assert.equal(n, 0, "unexpected loc_0bb3 dispatch in attract — the crafted-entry justification no longer holds");
  console.log(`  REACHABILITY: 0 dispatches over 6000 attract frames — gate is crafted-entry (in-game cutscene only)`);
});
