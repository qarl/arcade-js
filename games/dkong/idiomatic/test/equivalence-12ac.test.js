// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stepMarioDeathAnimation (ROM 0x12ac) — arm 1 of Mario's DEATH ANIMATION
 * (selector DEATH_ANIM_PHASE 0x639D): on each 8-frame gate tick it steps his sprite record
 * (0x694D/0x694E) to the next of four orientations, and when DEATH_ANIM_TICKS_LEFT runs out it
 * settles the sprite on tile 0x7A and advances the phase. Grounded in real MAME: 43/43
 * completed episodes identical — scratchpad/pass13-grounding.md §2.
 * (Case labels below call the cycling arm the SPIN arm: the sprite rotates through four orientations.
 * The pre-pass-13 word for it was "blink", which pass-13 grounding refuted — nothing here blinks
 * anything on or off; all four observed (code, attr) pairs are visible sprites.)
 *
 * The routine WRITES MEMORY, calls the rst-0x18 gate, and has a gate that can skip its
 * whole body, so it is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc +
 * SP — never on a register file (its live-out is memory-only; see the routine header),
 * and every case runs on a FRESH clone (a reused clone is only safe for a read-only
 * leaf). The idiomatic routine models the Z80 `ret` as a JS return and calls its callee
 * (tickSubstateTimer) directly (no stack modelling), so the harness performs ONE
 * m.ret() on the candidate clone after the call to line pc + SP up with the oracle:
 *
 *   - All three arms collapse to that single net return. On EXPIRY the oracle threads
 *     push(0x12ad) -> sub_0018 `ret z` -> body (the sprite step, or the 0x12CB settle-and-
 *     advance tail) -> the final `ret`; on the SKIP the oracle's sub_0018 does
 *     `inc sp/inc sp/ret` to drop its own frame and return to the caller's caller. Either
 *     way it ends SP = entry+2, pc = the caller's return — one candidate m.ret() reproduces it.
 *     The oracle's transient push byte lands in STACK_SCRATCH, excluded by the contract.
 *
 *   1. EQUAL (real dispatches) — hook 0x12ac in a real attract run and clone the machine
 *      at each true dispatch (stepMarioDeathAnimation first fires ~frame 2619 skip, ~2626 step, ~2722
 *      advance). oracle vs candidate must agree on RAM + pc + SP for every one.
 *      COVERAGE HOLE, stated plainly (R17): these captures come from an ATTRACT run ONLY.
 *      The same arm runs during a credited game's death sub-state, and those episodes —
 *      byte-identical in grounding, but never replayed here — are not covered by this gate.
 *
 *   2. EQUAL (crafted arms) — the exact step/advance/skip arms, poked from a real
 *      captured state (SUBSTATE_TIMER + 0x639E) so all three are covered regardless of
 *      capture timing. Each compared identically both sides.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) a wrong sprite store (the sprite-code write lands value ^ 0xFF) — caught on a
 *          step (cycling) arm;
 *      (b) a gate-polarity inversion (runs the body while counting, skips on expiry) —
 *          caught on the skip arm and on real skip-arm dispatches.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-12ac.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_12ac as oracle } from "../../translated/loc_12ac.js";
import { stepMarioDeathAnimation } from "../stepMarioDeathAnimation.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  SUBSTATE_TIMER,
  MARIO_SPRITE_RECORD,
  DEATH_ANIM_PHASE,
  DEATH_ANIM_TICKS_LEFT,
} from "../names.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x12ac;
// DEATH_ANIM_PHASE (0x639D) and DEATH_ANIM_TICKS_LEFT (0x639E) are imported from names.js,
// the single source of truth — both [seen], grounded on the pass-13 real-MAME death runs.
const SPRITE_CODE = MARIO_SPRITE_RECORD + 1; // 0x694D
const SPRITE_ATTR = MARIO_SPRITE_RECORD + 2; // 0x694E

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

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

/**
 * Run a candidate on a fresh clone, then model its return with ONE m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself — the harness supplies the single net return
 * that all three arms collapse to).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. NO
 * registers — stepMarioDeathAnimation's live-out is memory-only, and because it calls the idiomatic
 * callee directly (whereas the oracle calls the translated one) the two leave different
 * DEAD registers behind; comparing them would fail on values nothing reads. Returns a
 * list of human-readable mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

/** The gate expires this frame iff SUBSTATE_TIMER decrements to 0 (i.e. it is 1). */
const gateExpires = (e) => ((e.mem.read8(SUBSTATE_TIMER) - 1) & 0xff) === 0;
/** The advance tail runs iff the gate expires AND 0x639E decrements to 0 (i.e. it is 1). */
const isAdvanceArm = (e) => gateExpires(e) && ((e.mem.read8(DEATH_ANIM_TICKS_LEFT) - 1) & 0xff) === 0;
const isDeathAnimArm = (e) => gateExpires(e) && !isAdvanceArm(e);
const isSkipArm = (e) => !gateExpires(e);

/**
 * Hook 0x12ac in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. dispatchGameState routes 0x12ac through m.call, which the override map
 * overlays, so every dispatch is captured here.
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

/** A real captured state with surgical pokes: gate value, tick count, and a safe SP. */
function craft(seed, { timer, count }) {
  const e = seed.clone();
  e.mem.write8(SUBSTATE_TIMER, timer);
  e.mem.write8(DEATH_ANIM_TICKS_LEFT, count);
  e.regs.sp = 0x6bfe; // pushes land in STACK_SCRATCH, well clear of work RAM
  return e;
}

/**
 * Broken twin (a): the wrong sprite store. Steps the animation correctly EXCEPT the
 * sprite-code write lands value ^ 0xFF (guaranteed to differ). Agrees on the gate and on
 * the advance/skip arms, so only a cycling (step) arm exposes it.
 */
function brokenDeathAnimStore(m) {
  const { mem } = m;
  if (!tickSubstateTimer(m)) return;
  mem.write8(SUBSTATE_TIMER, 0x08);
  const remaining = (mem.read8(DEATH_ANIM_TICKS_LEFT) - 1) & 0xff;
  mem.write8(DEATH_ANIM_TICKS_LEFT, remaining);
  if (remaining === 0) {
    const code = mem.read8(SPRITE_CODE);
    mem.write8(SPRITE_CODE, (code & 0x80) | 0x7a);
    mem.write8(DEATH_ANIM_PHASE, (mem.read8(DEATH_ANIM_PHASE) + 1) & 0xff);
    mem.write8(SUBSTATE_TIMER, 0x80);
    return;
  }
  const code = mem.read8(SPRITE_CODE);
  const b = ((code & 0x01) << 7) | 0x01;
  mem.write8(SPRITE_CODE, (b ^ code) ^ 0xff); // BUG: wrong value to the sprite-code cell
  mem.write8(SPRITE_ATTR, (b & 0x80) ^ mem.read8(SPRITE_ATTR));
}

/**
 * Broken twin (b): the gate-polarity inversion. Runs the body while the counter is
 * still counting down and skips on expiry — the classic "do it every Nth frame" misread.
 * Ticks the timer identically (so the skip arm still decrements 0x6009) but takes the
 * wrong branch, so it diverges on every arm.
 */
function brokenGatePolarity(m) {
  const { mem } = m;
  const expired = tickSubstateTimer(m);
  if (expired) return; // BUG: inverted — should be `if (!expired) return`
  mem.write8(SUBSTATE_TIMER, 0x08);
  const remaining = (mem.read8(DEATH_ANIM_TICKS_LEFT) - 1) & 0xff;
  mem.write8(DEATH_ANIM_TICKS_LEFT, remaining);
  if (remaining === 0) {
    const code = mem.read8(SPRITE_CODE);
    mem.write8(SPRITE_CODE, (code & 0x80) | 0x7a);
    mem.write8(DEATH_ANIM_PHASE, (mem.read8(DEATH_ANIM_PHASE) + 1) & 0xff);
    mem.write8(SUBSTATE_TIMER, 0x80);
    return;
  }
  const code = mem.read8(SPRITE_CODE);
  const b = ((code & 0x01) << 7) | 0x01;
  mem.write8(SPRITE_CODE, b ^ code);
  mem.write8(SPRITE_ATTR, (b & 0x80) ^ mem.read8(SPRITE_ATTR));
}

test("EQUAL (real dispatches): stepMarioDeathAnimation == oracle on every captured 0x12ac entry", () => {
  const caps = captureDispatches(400, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x12ac dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, stepMarioDeathAnimation);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const skip = caps.filter(isSkipArm).length;
  const spinArm = caps.filter(isDeathAnimArm).length;
  const advance = caps.filter(isAdvanceArm).length;
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical ` +
      `(${skip} skip-arm, ${spinArm} spin-arm, ${advance} advance-arm)`,
  );
});

test("EQUAL (crafted): the death animation, advance and skip arms each match the oracle", () => {
  const caps = captureDispatches(1, 3000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const cases = [
    { name: "spin arm (gate expires, DEATH_ANIM_TICKS_LEFT 13 -> 12)", e: craft(seed, { timer: 0x01, count: 0x0d }) },
    { name: "advance arm (gate expires, 0x639E 1 -> 0)", e: craft(seed, { timer: 0x01, count: 0x01 }) },
    { name: "skip arm (SUBSTATE_TIMER 5 -> 4, gate still counting)", e: craft(seed, { timer: 0x05, count: 0x0d }) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, stepMarioDeathAnimation);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (spin, advance, skip) identical to the oracle`);
});

test("TEETH: the wrong spin store and the gate-polarity inversion are CAUGHT", () => {
  const caps = captureDispatches(400, 3000);
  assert.ok(caps.length >= 1, "need real captures for the teeth check");
  const seed = caps[0];

  const deathAnimArm = craft(seed, { timer: 0x01, count: 0x0d });
  const storeDiffs = contractDiffs(deathAnimArm, brokenDeathAnimStore);
  assert.ok(storeDiffs.length > 0, "the wrong spin store escaped on the spin arm — the gate is worthless");

  // (b) gate-polarity inversion: diverges on every arm. Catch it on a crafted skip arm
  //     and confirm it is caught on the real skip-arm dispatches too.
  const skipArm = craft(seed, { timer: 0x05, count: 0x0d });
  const polSkip = contractDiffs(skipArm, brokenGatePolarity);
  assert.ok(polSkip.length > 0, "the gate-polarity inversion escaped on the crafted skip arm");

  const realSkips = caps.filter(isSkipArm);
  let caughtReal = 0;
  for (const c of realSkips) {
    if (contractDiffs(c, brokenGatePolarity).length > 0) caughtReal++;
  }
  assert.equal(
    caughtReal, realSkips.length,
    `the gate-polarity inversion escaped on ${realSkips.length - caughtReal}/${realSkips.length} real skip dispatches`,
  );

  console.log(
    `  TEETH: wrong spin store caught on the spin arm (${storeDiffs[0]}); ` +
      `gate-polarity caught on the crafted skip arm (${polSkip[0]}) and all ${realSkips.length} real skip dispatches`,
  );
});
