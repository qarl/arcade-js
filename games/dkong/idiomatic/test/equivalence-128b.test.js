// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for beginMarioDeathAnimation (ROM 0x128b) — arm 0 (seed) of Mario's death
 * animation: on the gate's expiry frame it points his sprite at tile 0x78, primes
 * DEATH_ANIM_TICKS_LEFT=13, clears sprite runs, fires the death sound line, advances the phase.
 *
 * Gated on MEMORY-equivalence: RAM − the stack scratch below the entry SP, on FRESH clones. pc/SP are NOT compared —
 * the idiomatic routine calls its callees (tickSubstateTimer, clearSpriteColumns) as plain JS
 * leaves and never touches the guest stack, so it leaves pc/SP two apart from the oracle. A pure
 * seam artifact (the oracle's pushes land in STACK_SCRATCH, popped bytes never re-enter RAM); the
 * whole-game SP guards (idiomatic "FULL FLIP", barrel-jump-reset) back-stop a stray push.
 *
 *   1. EQUAL (real dispatches) — hook 0x128b in attract, clone at each true dispatch (64× over
 *      3000 frames: 63 skip-arm, then 1 seed-arm on the expiry frame).
 *   2. EQUAL (crafted arms) — seed and skip arms poked from a real captured state.
 *   3. TEETH — (a) wrong sprite-code store (0x7A not 0x78), caught on the seed arm; (b) gate-
 *      polarity inversion (body while counting, skip on expiry), caught on the skip arm.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-128b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_128b as oracle } from "../../translated/loc_128b.js";
import { beginMarioDeathAnimation } from "../beginMarioDeathAnimation.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  SUBSTATE_TIMER,
  MARIO_SPRITE_RECORD,
  SND_IRQ_TRIGGER,
  DEATH_ANIM_PHASE,
  DEATH_ANIM_TICKS_LEFT,
} from "../names.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { loc_30bd } from "../../translated/loc_30bd.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x128b;
// DEATH_ANIM_PHASE (0x639D) and DEATH_ANIM_TICKS_LEFT (0x639E) are imported from names.js,
// the single source of truth — both [seen], grounded on the pass-13 real-MAME death runs.
const SPRITE_CODE = MARIO_SPRITE_RECORD + 1; // 0x694D

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- branch classifier (reads the ENTRY state) --------------------------------

/** The gate expires this frame iff SUBSTATE_TIMER decrements to 0 (i.e. it is 1). On the
 *  seed (expiry) arm the body runs; otherwise the arm is skipped. */
const gateExpires = (e) => ((e.mem.read8(SUBSTATE_TIMER) - 1) & 0xff) === 0;

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the dead
 * stack region the standard gate excludes. The oracle transiently pushes the rst / call
 * return addresses into this region; the idiomatic routine (JS call stack) never writes
 * it, so excluding it is exactly the contract, not a fudge.
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

/** Run the ORACLE on a fresh clone. It performs its own returns, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone (pc/SP a seam artifact, not compared — see the header). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  return c;
}

/** Compare over RAM − the stack scratch below the entry SP (memory-eq). No pc/SP and no registers — live-out is
 *  memory-only. Returns a list of human-readable mismatches (empty when equal). */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x128b in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. dispatchDeathAnimationPhase routes arm 0 through m.call, which the override map overlays, so
 * every dispatch is captured here.
 */
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

/**
 * A real captured state with surgical pokes: the gate value + a safe SP inside
 * STACK_SCRATCH. SP is set to 0x6BF0 (the natural attract dispatch SP) rather than the
 * region top, so there is headroom BOTH ways: loc_30bd pushes 4 deep (down to 0x6BEC, still
 * ≥ STACK_SCRATCH.lo) and the teeth twin's wrong branch can walk the reconciling pops up to
 * 0x6BF4 (still < STACK_SCRATCH.hi = 0x6C00) without an unmapped access. All of it is dead
 * stack scratch, excluded by the contract.
 */
function craft(seed, { timer }) {
  const e = seed.clone();
  e.mem.write8(SUBSTATE_TIMER, timer);
  e.regs.sp = 0x6bf0;
  return e;
}

// -- teeth twins --------------------------------------------------------------

/**
 * Broken twin (a): the wrong sprite-code store. Seeds correctly EXCEPT it writes tile
 * code 0x7A (arm 2's advance constant) instead of 0x78 — a plausible copy-paste bug. The
 * low nibble differs for every input, so any seed arm exposes it; the skip arm is unaffected.
 */
function brokenSpriteStore(m) {
  const { mem } = m;
  if (!tickSubstateTimer(m)) return;
  const code = mem.read8(SPRITE_CODE);
  mem.write8(SPRITE_CODE, (code & 0x80) | 0x7a); // BUG: 0x7A should be 0x78
  mem.write8(DEATH_ANIM_PHASE, (mem.read8(DEATH_ANIM_PHASE) + 1) & 0xff);
  mem.write8(DEATH_ANIM_TICKS_LEFT, 0x0d);
  mem.write8(SUBSTATE_TIMER, 0x08);
  loc_30bd(m);
  mem.write8(SND_IRQ_TRIGGER, 0x03);
}

/**
 * Broken twin (b): the gate-polarity inversion. Runs the body while the counter is still
 * counting down and skips on expiry — the classic "do it every Nth frame" misread. Ticks
 * the timer identically (so the skip arm still decrements 0x6009) but takes the wrong
 * branch, so it diverges on every arm.
 */
function brokenGatePolarity(m) {
  const { mem } = m;
  if (tickSubstateTimer(m)) return; // BUG: inverted — should be `if (!expired) return`
  const code = mem.read8(SPRITE_CODE);
  mem.write8(SPRITE_CODE, (code & 0x80) | 0x78);
  mem.write8(DEATH_ANIM_PHASE, (mem.read8(DEATH_ANIM_PHASE) + 1) & 0xff);
  mem.write8(DEATH_ANIM_TICKS_LEFT, 0x0d);
  mem.write8(SUBSTATE_TIMER, 0x08);
  loc_30bd(m);
  mem.write8(SND_IRQ_TRIGGER, 0x03);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): beginMarioDeathAnimation == oracle on every captured 0x128b entry", () => {
  const caps = captureDispatches(400, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x128b dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, beginMarioDeathAnimation); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const seed = caps.filter(gateExpires).length;
  const skip = caps.length - seed;
  assert.ok(seed >= 1, "expected the seed (expiry) arm among the real dispatches");
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical (${skip} skip-arm, ${seed} seed-arm)`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): the seed and skip arms each match the oracle", () => {
  const caps = captureDispatches(1, 3000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const cases = [
    { name: "seed arm (gate expires: SUBSTATE_TIMER 1 -> 0)", e: craft(seed, { timer: 0x01 }) },
    { name: "skip arm (SUBSTATE_TIMER 5 -> 4, gate still counting)", e: craft(seed, { timer: 0x05 }) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, beginMarioDeathAnimation);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (seed, skip) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong sprite-code store and the gate-polarity inversion are CAUGHT", () => {
  const caps = captureDispatches(400, 3000);
  assert.ok(caps.length >= 1, "need real captures for the teeth check");
  const seed = caps[0];

  // (a) wrong sprite-code store: only shows on the seed arm, so craft one.
  const seedArm = craft(seed, { timer: 0x01 });
  const storeDiffs = contractDiffs(seedArm, brokenSpriteStore);
  assert.ok(storeDiffs.length > 0, "the wrong sprite-code store escaped on the seed arm — the gate is worthless");

  // (b) gate-polarity inversion: diverges on every arm. Catch it on a crafted skip arm and
  //     confirm it is caught on the real skip-arm dispatches too.
  const skipArm = craft(seed, { timer: 0x05 });
  const polSkip = contractDiffs(skipArm, brokenGatePolarity);
  assert.ok(polSkip.length > 0, "the gate-polarity inversion escaped on the crafted skip arm");

  const realSkips = caps.filter((c) => !gateExpires(c));
  let caughtReal = 0;
  for (const c of realSkips) {
    if (contractDiffs(c, brokenGatePolarity).length > 0) caughtReal++;
  }
  assert.equal(
    caughtReal, realSkips.length,
    `the gate-polarity inversion escaped on ${realSkips.length - caughtReal}/${realSkips.length} real skip dispatches`,
  );

  console.log(
    `  TEETH: wrong sprite-code store caught on the seed arm (${storeDiffs[0]}); ` +
      `gate-polarity caught on the crafted skip arm (${polSkip[0]}) and all ${realSkips.length} real skip dispatches`,
  );
});
