// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for walkMarioRight (ROM 0x1C8F) — the RIGHTWARD arm of Mario's per-frame
 * horizontal walk. While the sub-step pacer MARIO_MOVE_STEP_TIMER is still running the frame is
 * a plain +1 pixel slide (advanceMarioWalkX); on the frame it has expired the walk-cycle index
 * MARIO_WALK_ANIM is stepped through nextAnimationStep's packed table (key 5 = the rightward cycle),
 * stored back, and its low two bits handed to beginWalkStep with the facing-right bit 7 set.
 *
 * The routine WRITES MEMORY and both arms end by tailing into the mover's shared sprite-record
 * tail, so it is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never on a
 * register file (its live-out is memory-only; see the routine header). Every case runs on a
 * FRESH clone, since the routine writes.
 *
 * REGISTER ABI: the oracle loads the walk delta into B and hands the sprite-code byte to
 * 0x1CC2 in A. The idiomatic routine passes the delta to advanceMarioWalkX as a parameter and
 * stages the sprite code in the accumulator, which is beginWalkStep's current live-in.
 *
 * RETURN / STACK: the oracle's two arms each net exactly ONE caller-return pop (the mid-step
 * arm through loc_1cd2 -> loc_1ceb -> loc_1da6; the animation arm through the balanced
 * push16(0x1ca1)/call(0x3009)/ret bracket and then loc_1cc2 -> loc_1da6). The idiomatic routine
 * models no stack, so the harness performs ONE m.ret() on the candidate to line pc + SP up, and
 * the bytes the oracle leaves in the dead STACK_SCRATCH region are excluded by the contract.
 *
 *   1. REACHABILITY + EQUAL (real dispatches) — hook 0x1C8F in a plain attract run and clone at
 *      each true dispatch. The routine is genuinely reachable: attract walks Mario right on 25m,
 *      dispatching it hundreds of times, and BOTH arms plus every walk-anim value the cycle
 *      produces (0, 2, 4, 1) occur naturally. The test asserts that coverage, not just equality.
 *   2. EQUAL (crafted) — the arms attract cannot mint: the off-cycle animation value 3, the
 *      non-25m boards on the mid-step arm (attract only walks on 25m), and pacer values 1/2/255.
 *      Each is compared identically on both sides, with an independent expectation for the
 *      resulting MARIO_WALK_ANIM / MARIO_SPRITE_CODE / MARIO_X so the case cannot pass vacuously.
 *      Animation inputs >= 5 are NOT crafted: nextAnimationStep has no matching table field for them and
 *      spins forever, faithfully to the ROM, on both sides.
 *   3. TEETH — five deliberately-broken twins, each MUST be caught. Every twin is checked twice:
 *      the whole contract must report a divergence, AND the specific cell the bug corrupts must
 *      differ (naming the cell, not just "something moved", so a twin cannot pass on a side
 *      effect while leaving the byte it was written to break intact):
 *      (a) dropped facing bit (no `| 0x80`)            — MARIO_SPRITE_CODE.
 *      (b) dropped tile mask (stores the raw index)    — MARIO_SPRITE_CODE (anim 2->4).
 *      (c) leftward table key (1 instead of 5)         — MARIO_WALK_ANIM.
 *      (d) inverted pacer test (arms swapped)          — MARIO_WALK_ANIM.
 *      (e) leftward walk delta (255 instead of 1)      — MARIO_X.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1c8f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1c8f as oracle } from "../../translated/loc_1c8f.js";
import { walkMarioRight } from "../walkMarioRight.js";
import { nextAnimationStep } from "../nextAnimationStep.js";
import { advanceMarioWalkX } from "../advanceMarioWalkX.js";
import { beginWalkStep } from "../beginWalkStep.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH, MARIO_X, MARIO_Y, BOARD,
  MARIO_WALK_ANIM, MARIO_MOVE_STEP_TIMER, MARIO_SPRITE_CODE,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1c8f;
const FRAMES = 3000;      // the 25m demo walks Mario right well inside this
const RET_ADDR = 0x1af5;  // a plausible caller-return; only pc-equality matters, not its value

// The constants the routine is built on, restated here so the test checks them independently.
const WALK_RIGHT_STEP = 1;
const WALK_CYCLE_RIGHT_KEY = 0x05;
const WALK_CYCLE_LEFT_KEY = 0x01; // the leftward twin's key — used only by a teeth twin
const WALK_TILE_MASK = 0x03;
const FACING_RIGHT = 0x80;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
 *  (the oracle's push16(0x1ca1) and the nested returns linger there; the idiomatic routine
 *  uses the JS call stack, so excluding it is the contract, not a fudge). */
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

/** Run the ORACLE on a fresh clone; its tail `ret` advances pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its single net return with ONE m.ret() so
 *  pc + SP match the oracle's. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const returned = fn(c);
  c.ret();
  return { machine: c, returned };
}

/** The oracle-vs-candidate values of one work-RAM cell, so a teeth case can name the exact
 *  byte it expects to be corrupted rather than whichever address happens to sort first. */
function cellDiff(entry, fn, addr) {
  const o = runOracle(entry);
  const { machine: c } = runCandidate(entry, fn);
  return { addr, oracle: o.mem.read8(addr), cand: c.mem.read8(addr) };
}

const shows = (d) => `${hx(d.addr)} oracle=${d.oracle} cand=${d.cand}`;

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const { machine: c, returned } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  // Declared live-out includes NO return value: the caller (ROM 0x1AE6) tail-jumps here and
  // consumes nothing. Anything other than undefined would be an undeclared live-out.
  if (returned !== undefined) diffs.push(`return oracle=<none> cand=${returned}`);
  return diffs;
}

// -- capture + craft ----------------------------------------------------------

/** Hook 0x1C8F in a real attract run; clone the machine at up to K real dispatches. */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

/** A real, self-consistent attract machine (its clone neutralises the frame machinery). */
function attractBase(frames = 400) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

/** Stamp a crafted 0x1C8F dispatch onto a clone of the base: a stack with a plausible caller
 *  return (so the terminal `ret` has a sane target), then the pacer, the walk-cycle index,
 *  Mario's X/Y and the board. */
function craft(base, { pacer, anim, x, y, board }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(MARIO_MOVE_STEP_TIMER, pacer);
  m.mem.write8(MARIO_WALK_ANIM, anim);
  m.mem.write8(MARIO_X, x);
  m.mem.write8(MARIO_Y, y);
  m.mem.write8(BOARD, board);
  return m;
}

// Independent expectations: the animation arm steps the index and publishes the masked tile
// with the facing bit; the mid-step arm slides X by +1 and leaves the index alone.
const expectAnim = ({ pacer, anim }) =>
  pacer === 0 ? nextAnimationStep(WALK_CYCLE_RIGHT_KEY, anim).a : anim;
const expectSpriteCode = (c) => (expectAnim(c) & WALK_TILE_MASK) | FACING_RIGHT;
const expectX = ({ pacer, x }) => (pacer === 0 ? x : (x + WALK_RIGHT_STEP) & 0xff);

// -- teeth twins --------------------------------------------------------------

/** (a) dropped facing bit: publishes the walk tile without the facing-right flag. */
function brokenNoFacing(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) { advanceMarioWalkX(m, WALK_RIGHT_STEP); return; }
  const nextAnim = nextAnimationStep(WALK_CYCLE_RIGHT_KEY, mem.read8(MARIO_WALK_ANIM)).a;
  mem.write8(MARIO_WALK_ANIM, nextAnim);
  regs.a = nextAnim & WALK_TILE_MASK; // BUG: the facing-right bit is dropped
  beginWalkStep(m);
}

/** (b) dropped tile mask: publishes the raw animation index instead of its low two bits. */
function brokenNoTileMask(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) { advanceMarioWalkX(m, WALK_RIGHT_STEP); return; }
  const nextAnim = nextAnimationStep(WALK_CYCLE_RIGHT_KEY, mem.read8(MARIO_WALK_ANIM)).a;
  mem.write8(MARIO_WALK_ANIM, nextAnim);
  regs.a = nextAnim | FACING_RIGHT; // BUG: no & 0x03
  beginWalkStep(m);
}

/** (c) leftward table key: steps the animation through the twin's cycle. */
function brokenLeftKey(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) { advanceMarioWalkX(m, WALK_RIGHT_STEP); return; }
  const nextAnim = nextAnimationStep(WALK_CYCLE_LEFT_KEY, mem.read8(MARIO_WALK_ANIM)).a; // BUG: key 1
  mem.write8(MARIO_WALK_ANIM, nextAnim);
  regs.a = (nextAnim & WALK_TILE_MASK) | FACING_RIGHT;
  beginWalkStep(m);
}

/** (d) inverted pacer test: takes the animation arm while the pacer is still running. */
function brokenInvertedPacer(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) === 0) { advanceMarioWalkX(m, WALK_RIGHT_STEP); return; } // BUG
  const nextAnim = nextAnimationStep(WALK_CYCLE_RIGHT_KEY, mem.read8(MARIO_WALK_ANIM)).a;
  mem.write8(MARIO_WALK_ANIM, nextAnim);
  regs.a = (nextAnim & WALK_TILE_MASK) | FACING_RIGHT;
  beginWalkStep(m);
}

/** (e) leftward walk delta: slides Mario left on the mid-step arm. */
function brokenLeftDelta(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) { advanceMarioWalkX(m, 0xff); return; } // BUG: -1
  const nextAnim = nextAnimationStep(WALK_CYCLE_RIGHT_KEY, mem.read8(MARIO_WALK_ANIM)).a;
  mem.write8(MARIO_WALK_ANIM, nextAnim);
  regs.a = (nextAnim & WALK_TILE_MASK) | FACING_RIGHT;
  beginWalkStep(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("REACHABILITY + EQUAL (real dispatches): walkMarioRight == oracle on every captured 0x1c8f entry", () => {
  const caps = captureDispatches(400, FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x1c8f dispatch during attract");

  for (const entry of caps) {
    const diffs = contractDiffs(entry, walkMarioRight); // FRESH clones inside — entry untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }

  // Coverage: both arms and the whole naturally-occurring walk-cycle must be represented,
  // otherwise "570 identical dispatches" would only prove one path.
  const midStep = caps.filter((c) => c.mem.read8(MARIO_MOVE_STEP_TIMER) !== 0).length;
  const animStep = caps.length - midStep;
  const anims = new Set(
    caps.filter((c) => c.mem.read8(MARIO_MOVE_STEP_TIMER) === 0).map((c) => c.mem.read8(MARIO_WALK_ANIM)),
  );
  assert.ok(midStep > 0, "no mid-step (pacer running) dispatch captured");
  assert.ok(animStep > 0, "no animation-step (pacer expired) dispatch captured");
  for (const a of [0, 1, 2, 4]) {
    assert.ok(anims.has(a), `walk-cycle value ${a} never arrived at a real dispatch`);
  }

  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(${midStep} mid-step / ${animStep} animation-step; walk-cycle inputs seen: [${[...anims].sort().join(",")}])`,
  );
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): off-cycle anim value, non-25m boards, and pacer edges match", () => {
  const base = attractBase();

  const cases = [
    // Animation arm, every legal walk-cycle index — including 3, which the cycle never mints.
    { name: "anim step from 0", pacer: 0, anim: 0, x: 0x40, y: 0x10, board: 1 },
    { name: "anim step from 1", pacer: 0, anim: 1, x: 0x40, y: 0x10, board: 1 },
    { name: "anim step from 2", pacer: 0, anim: 2, x: 0x40, y: 0x10, board: 1 },
    { name: "anim step from 3 (off-cycle)", pacer: 0, anim: 3, x: 0x40, y: 0x10, board: 1 },
    { name: "anim step from 4", pacer: 0, anim: 4, x: 0x40, y: 0x10, board: 1 },
    // Animation arm off 25m — the walk cycle is board-independent.
    { name: "anim step on 50m", pacer: 0, anim: 2, x: 0x40, y: 0x10, board: 2 },
    { name: "anim step on 100m", pacer: 0, anim: 4, x: 0x40, y: 0x10, board: 4 },
    // Mid-step arm: pacer edges, and the non-25m boards attract never walks on.
    { name: "mid-step pacer 1 on 25m", pacer: 1, anim: 2, x: 0x3f, y: 0x10, board: 1 },
    { name: "mid-step pacer 2 on 25m", pacer: 2, anim: 0, x: 0x41, y: 0x10, board: 1 },
    { name: "mid-step pacer 255 on 25m", pacer: 255, anim: 1, x: 0x8f, y: 240, board: 1 },
    { name: "mid-step on 50m (no girder snap)", pacer: 2, anim: 4, x: 0x4f, y: 0x30, board: 2 },
    { name: "mid-step on 100m (no girder snap)", pacer: 1, anim: 0, x: 0x80, y: 0x50, board: 4 },
    // X wrap on the mid-step arm.
    { name: "mid-step X wraps 255->0", pacer: 3, anim: 2, x: 0xff, y: 0x30, board: 2 },
  ];

  for (const c of cases) {
    const entry = craft(base, c);
    const diffs = contractDiffs(entry, walkMarioRight);
    assert.equal(diffs.length, 0, `${c.name}: ${diffs.join("; ")}`);

    // Non-vacuity: the oracle really did what the case claims.
    const after = runOracle(entry);
    assert.equal(after.mem.read8(MARIO_WALK_ANIM), expectAnim(c), `${c.name}: walk-cycle index wrong`);
    assert.equal(after.mem.read8(MARIO_X), expectX(c), `${c.name}: X not as expected`);
    if (c.pacer === 0) {
      assert.equal(after.mem.read8(MARIO_SPRITE_CODE), expectSpriteCode(c), `${c.name}: sprite code wrong`);
      assert.notEqual(after.mem.read8(MARIO_WALK_ANIM), c.anim, `${c.name}: the animation must actually step`);
    } else {
      assert.equal(after.mem.read8(MARIO_WALK_ANIM), c.anim, `${c.name}: mid-step must not touch the walk cycle`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (off-cycle anim 3, 50m/100m, pacer edges, X wrap) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: no-facing, no-mask, left-key, inverted-pacer and left-delta twins are CAUGHT", () => {
  const base = attractBase();

  // (a) dropped facing bit — any animation-arm entry; correct code has bit 7 set.
  const facingEntry = craft(base, { pacer: 0, anim: 0, x: 0x40, y: 0x10, board: 1 });
  assert.ok(runOracle(facingEntry).mem.read8(MARIO_SPRITE_CODE) & FACING_RIGHT,
    "sanity: the oracle must set the facing bit for this twin to diverge");
  assert.ok(contractDiffs(facingEntry, brokenNoFacing).length > 0,
    "the dropped-facing twin escaped — the gate is worthless");
  const dFacing = cellDiff(facingEntry, brokenNoFacing, MARIO_SPRITE_CODE);
  assert.notEqual(dFacing.cand, dFacing.oracle, "the dropped-facing twin must corrupt MARIO_SPRITE_CODE");

  // (b) dropped tile mask — needs an index whose low two bits differ from itself: 2 -> 4.
  assert.equal(nextAnimationStep(WALK_CYCLE_RIGHT_KEY, 2).a, 4, "sanity: anim 2 must step to 4 for the mask to matter");
  const maskEntry = craft(base, { pacer: 0, anim: 2, x: 0x40, y: 0x10, board: 1 });
  assert.ok(contractDiffs(maskEntry, brokenNoTileMask).length > 0,
    "the dropped-mask twin escaped — the gate is worthless");
  const dMask = cellDiff(maskEntry, brokenNoTileMask, MARIO_SPRITE_CODE);
  assert.notEqual(dMask.cand, dMask.oracle, "the dropped-mask twin must corrupt MARIO_SPRITE_CODE");

  // (c) leftward table key — an index where the two cycles disagree.
  assert.notEqual(nextAnimationStep(WALK_CYCLE_RIGHT_KEY, 0).a, nextAnimationStep(WALK_CYCLE_LEFT_KEY, 0).a,
    "sanity: the two walk cycles must differ at index 0 for this twin to diverge");
  const keyEntry = craft(base, { pacer: 0, anim: 0, x: 0x40, y: 0x10, board: 1 });
  assert.ok(contractDiffs(keyEntry, brokenLeftKey).length > 0,
    "the leftward-key twin escaped — the gate is worthless");
  const dKey = cellDiff(keyEntry, brokenLeftKey, MARIO_WALK_ANIM);
  assert.notEqual(dKey.cand, dKey.oracle, "the leftward-key twin must corrupt MARIO_WALK_ANIM");

  // (d) inverted pacer test — a mid-step entry the twin mistakes for an animation step.
  const pacerEntry = craft(base, { pacer: 2, anim: 0, x: 0x40, y: 0x10, board: 1 });
  assert.ok(contractDiffs(pacerEntry, brokenInvertedPacer).length > 0,
    "the inverted-pacer twin escaped — the gate is worthless");
  const dPacer = cellDiff(pacerEntry, brokenInvertedPacer, MARIO_WALK_ANIM);
  assert.notEqual(dPacer.cand, dPacer.oracle, "the inverted-pacer twin must step the walk cycle on a mid-step frame");

  // (e) leftward walk delta — a mid-step entry; correct X = x+1, twin X = x-1.
  const deltaEntry = craft(base, { pacer: 2, anim: 0, x: 0x41, y: 0x10, board: 2 });
  assert.ok(contractDiffs(deltaEntry, brokenLeftDelta).length > 0,
    "the leftward-delta twin escaped — the gate is worthless");
  const dDelta = cellDiff(deltaEntry, brokenLeftDelta, MARIO_X);
  assert.notEqual(dDelta.cand, dDelta.oracle, "the leftward-delta twin must corrupt MARIO_X");

  console.log(
    `  TEETH: no-facing caught (${shows(dFacing)}); no-mask caught (${shows(dMask)}); ` +
      `left-key caught (${shows(dKey)}); inverted-pacer caught (${shows(dPacer)}); ` +
      `left-delta caught (${shows(dDelta)})`,
  );
});
