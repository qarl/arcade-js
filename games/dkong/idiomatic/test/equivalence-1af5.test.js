// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for walkLeftWhileHeld (ROM 0x1AF5) — the LEFT arm of Mario's ground-movement
 * direction dispatch: walk him one frame left when the control word says Left is held AND the
 * horizontal position gate's left verdict is not blocking, otherwise fall through to the
 * ladder/climb collision handler.
 *
 * The routine writes no memory of its own — everything observable is written by the callee it
 * picks — so what is really being gated is the BRANCH. Both arms end by tailing into a callee
 * whose chain nets exactly one caller-return, so the harness performs ONE m.ret() on the
 * candidate to line pc + SP up with the oracle (the same pattern as equivalence-1cab and
 * equivalence-1afe). The contract is RAM − the stack scratch below the entry SP + pc + SP + the return value; no
 * register file, because the live-out is memory-only plus that return (see the routine header).
 * Real dispatches sit at SP 0x6BEA..0x6BEE, so all the dissolved call/return churn stays inside
 * STACK_SCRATCH.
 *
 *   1. REACHABILITY — hook 0x1AF5 in a real attract run and classify EVERY dispatch (not just
 *      the cloned ones). The walk-left and fall-through arms both occur in quantity — 1422
 *      dispatches over the 9000 frames this test runs, split 745 walk-left / 677 fall-through when
 *      last measured; the test classifies and prints them rather than asserting those numbers. The
 *      BLOCKED arm (left verdict == 1) occurs ZERO times, because attract keeps Mario where the
 *      position gate answers 0 — the left-limit flag is 0 on every single one of those dispatches.
 *      The test asserts that zero explicitly rather than leaving it implied: crafted entries are
 *      the only thing covering that arm.
 *
 *   2. EQUAL (real dispatches) — replay every cloned attract dispatch, oracle vs candidate.
 *
 *   3. EQUAL (crafted, exhaustive over the decision surface) — the routine's whole decision is
 *      (left verdict == 1, control word bit 1), so the sweep is exhaustive: all 256 control
 *      words against left verdicts 0, 1, 2 and 255, seeded from a real captured dispatch so the
 *      surrounding RAM and stack are in-distribution. Non-vacuity is asserted separately: on the
 *      seed, the walk arm and the blocked arm really do leave different RAM, and the walk arm
 *      really does move Mario.
 *
 *   4. TEETH — four deliberately-broken twins, each of which the contract MUST catch. Two are
 *      exactly the constants that separate this arm from its 0x1AE6 mirror, so a green run means
 *      the direction is pinned and not merely plausible:
 *        (a) dropped left-limit gate — walks left even when the position gate blocks it.
 *        (b) inverted left-limit gate — walks left ONLY when blocked.
 *        (c) the mirror's input bit — tests bit 0 (Right) instead of bit 1 (Left).
 *        (d) the mirror's stepper — calls walkMarioRight instead of walkMarioLeft.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1af5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1af5 as oracle } from "../../translated/loc_1af5.js";
import { walkLeftWhileHeld } from "../walkLeftWhileHeld.js";
import { walkMarioLeft } from "../walkMarioLeft.js";   // ROM 0x1CAB — used by the teeth twins
import { walkMarioRight } from "../walkMarioRight.js"; // ROM 0x1C8F — the mirror arm's stepper
import { armMarioClimbAtLadderEnd } from "../armMarioClimbAtLadderEnd.js";             // ROM 0x1AFE — used by the teeth twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, P1_INPUT, MARIO_X, MARIO_WALK_ANIM, MARIO_SPRITE_CODE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1af5;
const FRAMES = 9000;   // the attract loop; 0x1AF5 dispatches throughout
const MAX_CLONES = 400;
const LEFT_HELD = 0x02;
const LEFT_BLOCKED = 1;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** Which arm the oracle takes, from the two register live-ins alone. */
const armOf = (a, d) => (d === LEFT_BLOCKED ? "blocked" : (a & LEFT_HELD) !== 0 ? "walk-left" : "fall-through");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead stack the
 *  oracle's dissolved tail-call returns churn; the candidate uses the JS call stack). */
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

/** Run the ORACLE on a fresh clone; the selected chain's tail `ret` advances pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { m: c, ret };
}

/** Run a candidate on a fresh clone, then model the chain's single net caller-return with ONE
 *  m.ret() so pc + SP match the oracle's. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  c.ret();
  return { m: c, ret };
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP, return value. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o.m, c.m, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.m.pc !== c.m.pc) diffs.push(`pc oracle=${hx(o.m.pc)} cand=${hx(c.m.pc)}`);
  if (o.m.regs.sp !== c.m.regs.sp) diffs.push(`SP oracle=${hx(o.m.regs.sp)} cand=${hx(c.m.regs.sp)}`);
  if (o.ret !== c.ret) diffs.push(`return oracle=${String(o.ret)} cand=${String(c.ret)}`);
  return diffs;
}

// -- capture (memoised — attract is deterministic) ----------------------------

let RUN = null;
/** Hook 0x1AF5 in a real attract run: classify EVERY dispatch (so reachability is a true count,
 *  not a count of the ones that fit in the clone budget) and clone the first MAX_CLONES. */
function getRun() {
  if (RUN) return RUN;
  const caps = [];
  const arms = { blocked: 0, "walk-left": 0, "fall-through": 0 };
  let total = 0;
  const hook = new Map([[TARGET, (mm) => {
    total++;
    arms[armOf(mm.regs.a, mm.regs.d)]++;
    if (caps.length < MAX_CLONES) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: hook });
  host.runFrames(FRAMES);
  RUN = { caps, arms, total };
  return RUN;
}

/** A real captured dispatch with the two register live-ins poked. Nothing else is touched, so
 *  the RAM, the stack and SP stay exactly as the running game produced them. */
function craft(seed, { control, leftLimit }) {
  const m = seed.clone();
  if (control !== undefined) m.regs.a = control;
  if (leftLimit !== undefined) m.regs.d = leftLimit;
  return m;
}

// -- teeth twins (same shape as walkLeftWhileHeld, one thing broken) -------------------

/** (a) the left-limit gate is gone: walks left whenever Left is held. */
function brokenNoLimitGate(m) {
  const { regs } = m;
  if ((regs.a & LEFT_HELD) !== 0) return walkMarioLeft(m); // BUG: ignores the left verdict
  return armMarioClimbAtLadderEnd(m);
}

/** (b) the left-limit gate is inverted: walks left ONLY when the gate says blocked. */
function brokenInvertedLimitGate(m) {
  const { regs } = m;
  if (regs.d === LEFT_BLOCKED && (regs.a & LEFT_HELD) !== 0) return walkMarioLeft(m); // BUG
  return armMarioClimbAtLadderEnd(m);
}

/** (c) the mirror arm's input bit: tests Right (bit 0) instead of Left (bit 1). */
function brokenRightInputBit(m) {
  const { regs } = m;
  if (regs.d !== LEFT_BLOCKED && (regs.a & 0x01) !== 0) return walkMarioLeft(m); // BUG: bit 0
  return armMarioClimbAtLadderEnd(m);
}

/** (d) the mirror arm's stepper: walks Mario RIGHT on the left-held branch. */
function brokenRightwardStepper(m) {
  const { regs } = m;
  if (regs.d !== LEFT_BLOCKED && (regs.a & LEFT_HELD) !== 0) return walkMarioRight(m); // BUG
  return armMarioClimbAtLadderEnd(m);
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x1AF5 dispatches all through attract, but NEVER on the blocked arm", () => {
  const { caps, arms, total } = getRun();
  assert.ok(total >= 1, "expected real 0x1AF5 dispatches during attract");
  assert.ok(arms["walk-left"] >= 1, "expected the walk-left arm to occur naturally");
  assert.ok(arms["fall-through"] >= 1, "expected the fall-through arm to occur naturally");
  // Honest hole, asserted rather than assumed: the position gate answers 0 everywhere attract
  // takes Mario, so no natural dispatch ever blocks the walk. Crafted entries carry that arm.
  assert.equal(arms.blocked, 0, "attract was expected NOT to reach the blocked arm");
  // The control word arrives in a register, and the routine header claims it is the value of
  // P1_INPUT (the caller loads it one instruction earlier and nothing writes it in between).
  // That claim is asserted here rather than asserted by hand, over every cloned dispatch.
  const agree = caps.filter((c) => c.regs.a === c.mem.read8(P1_INPUT)).length;
  assert.equal(agree, caps.length, "the handed-over control word must equal P1_INPUT at every dispatch");
  console.log(
    `  REACHABILITY: ${total} dispatches in ${FRAMES} attract frames — ` +
      `${JSON.stringify(arms)}; ${caps.length} cloned for replay ` +
      `(control word == P1_INPUT at all ${agree})`,
  );
});

// -- 2. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): walkLeftWhileHeld == oracle on every cloned 0x1AF5 entry", () => {
  const { caps } = getRun();
  assert.ok(caps.length >= 1, "expected at least one cloned 0x1AF5 dispatch");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, walkLeftWhileHeld); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP+return`);
});

// -- 3. EQUAL (crafted, exhaustive over the decision surface) -----------------

test("EQUAL (crafted): all 256 control words x four left-verdict values, incl. the blocked arm", () => {
  const { caps } = getRun();
  const seed = caps.find((c) => (c.regs.a & LEFT_HELD) !== 0) || caps[0];
  assert.ok(seed, "need a real capture to seed crafted entries with real RAM and a real stack");

  const seen = { blocked: 0, "walk-left": 0, "fall-through": 0 };
  let cases = 0;
  for (const leftLimit of [0, 1, 2, 255]) {
    for (let control = 0; control <= 255; control++) {
      const entry = craft(seed, { control, leftLimit });
      const diffs = contractDiffs(entry, walkLeftWhileHeld);
      assert.equal(diffs.length, 0, `control ${hx(control)} leftLimit ${leftLimit}: ${diffs.join("; ")}`);
      seen[armOf(control, leftLimit)]++;
      cases++;
    }
  }
  assert.equal(cases, 1024, "the sweep must cover all 256 control words on each of four verdicts");
  assert.ok(seen.blocked >= 256, "the crafted sweep must actually reach the blocked arm");
  assert.ok(seen["walk-left"] >= 1 && seen["fall-through"] >= 1, "and both naturally-reached arms");

  // Non-vacuity: on this seed the branch is genuinely observable — the walk arm and the blocked
  // arm leave DIFFERENT RAM, and the walk arm really does step Mario (X back one pixel, or a new
  // animation step when the sub-step pacer has expired).
  const walk = runOracle(craft(seed, { control: LEFT_HELD, leftLimit: 0 })).m;
  const blocked = runOracle(craft(seed, { control: LEFT_HELD, leftLimit: LEFT_BLOCKED })).m;
  assert.ok(firstRamDiff(walk, blocked, seed.regs.sp) !== null, "walk arm and blocked arm must differ in RAM");
  const movedX = walk.mem.read8(MARIO_X) !== seed.mem.read8(MARIO_X);
  const steppedAnim = walk.mem.read8(MARIO_WALK_ANIM) !== seed.mem.read8(MARIO_WALK_ANIM);
  assert.ok(movedX || steppedAnim, "the walk arm must actually move Mario or advance his walk cycle");
  assert.equal(
    walk.mem.read8(MARIO_SPRITE_CODE) & 0x80, 0,
    "sanity: the leftward stepper leaves the facing-right bit clear",
  );

  console.log(
    `  EQUAL/crafted: ${cases} cases identical on RAM+pc+SP+return — ${JSON.stringify(seen)}` +
      ` (blocked arm reachable ONLY here)`,
  );
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: dropped/inverted left-limit gate and both 0x1AE6-mirror defects are CAUGHT", () => {
  const { caps } = getRun();
  const seed = caps.find((c) => (c.regs.a & LEFT_HELD) !== 0) || caps[0];
  const heldAndBlocked = craft(seed, { control: LEFT_HELD, leftLimit: LEFT_BLOCKED });
  const heldAndOpen = craft(seed, { control: LEFT_HELD, leftLimit: 0 });

  // (a) dropped gate — on a blocked entry the twin walks Mario, the oracle does not.
  const dNoGate = contractDiffs(heldAndBlocked, brokenNoLimitGate);
  assert.ok(dNoGate.length > 0, "the dropped-left-limit twin escaped — the gate is worthless");

  // (b) inverted gate — on an open entry the twin refuses to walk, the oracle walks.
  const dInverted = contractDiffs(heldAndOpen, brokenInvertedLimitGate);
  assert.ok(dInverted.length > 0, "the inverted-left-limit twin escaped — the gate is worthless");

  // (c) the mirror's input bit — Left held, Right clear: the twin falls through instead.
  const dRightBit = contractDiffs(heldAndOpen, brokenRightInputBit);
  assert.ok(dRightBit.length > 0, "the bit-0 (Right) twin escaped — the gate is worthless");

  // (d) the mirror's stepper — same branch taken, wrong direction walked.
  const dStepper = contractDiffs(heldAndOpen, brokenRightwardStepper);
  assert.ok(dStepper.length > 0, "the rightward-stepper twin escaped — the gate is worthless");

  console.log(
    `  TEETH: dropped gate caught (${dNoGate[0]}); inverted gate caught (${dInverted[0]}); ` +
      `bit-0 twin caught (${dRightBit[0]}); rightward stepper caught (${dStepper[0]})`,
  );
});
