// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for walkMarioLeft (ROM 0x1CAB) — one frame of Mario's LEFTWARD
 * ground walk: while the sub-step timer MARIO_MOVE_STEP_TIMER is running, shift Mario one
 * pixel left (advanceMarioWalkX with a delta of −1); when it has expired, advance
 * MARIO_WALK_ANIM one place around its ring via nextAnimationStep and hand the ring index's low two
 * bits — with the facing-right bit LEFT CLEAR — to beginWalkStep.
 *
 * The routine WRITES MEMORY and both arms end by tailing into a callee's `ret`, so it is
 * gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never on a
 * register file (its live-out is memory-only; see the routine header). Every case runs on
 * a FRESH clone, since this writes.
 *
 * STACK / RETURN. The oracle's in-progress arm calls 0x1CD2, whose chain nets exactly one
 * caller-return; its new-step arm brackets 0x3009 with a push16(0x1CBD) that 0x3009's own
 * `ret` pops (net zero) and then tails into 0x1CC2, which also nets one caller-return. So
 * BOTH arms net one pop, and the pushed bytes linger only in STACK_SCRATCH. The idiomatic
 * routine models no stack (direct JS calls), so the harness performs ONE m.ret() on the
 * candidate to line pc + SP up with the oracle — the same pattern as equivalence-1cd2 and
 * equivalence-1cc2.
 *
 * LIVE-OUT beyond RAM: the RETURN VALUE. walkLeftWhileHeld tail-returns whatever this yields and the
 * cascade propagates it upward, where a truthy value would read as a caller-skip signal, so
 * every case asserts oracle and candidate both return `undefined`.
 *
 * OFF-RING INPUTS ARE SKIPPED, NOT GUARDED. nextAnimationStep spins forever when no field of its
 * packed table matches the selector, so a MARIO_WALK_ANIM outside {0,1,2,3,4} hangs the
 * real ROM. The sweep below skips exactly those values using an independent predicate
 * (the same treatment equivalence-3009 gives its non-terminating domain).
 *
 *   1. REACHABILITY + EQUAL (real dispatches) — hook 0x1CAB in a real attract run (the 25m
 *      demo walks Mario left) and clone at each true dispatch; oracle vs candidate agree on
 *      RAM + pc + SP + return value for every one. Both arms and all four ring values occur
 *      naturally, which the test asserts rather than assumes.
 *   2. EQUAL (crafted, exhaustive over the decision surface) — seeded from a real capture:
 *      all 256 MARIO_MOVE_STEP_TIMER values on 25m (pinning the timer branch exhaustively),
 *      the same sweep on a non-25m board (so advanceMarioWalkX's girder-snap skip arm is
 *      exercised too), and every MARIO_WALK_ANIM value on which nextAnimationStep terminates. Each
 *      case additionally checks the concrete effects against literal expectations — the
 *      leftward X step, the ring successor, the masked walk tile with bit 7 clear, and the
 *      timer reload — so a green EQUAL cannot be vacuous.
 *   3. TEETH — four deliberately-broken twins, each MUST be caught. Three of them are
 *      precisely the constants that separate this routine from the rightward twin at
 *      ROM 0x1C8F, so the gate proves the direction is pinned and not merely plausible:
 *      (a) inverted timer branch — takes the wrong arm; diverges on MARIO_WALK_ANIM.
 *      (b) rightward walk delta (+1 instead of −1) — diverges on MARIO_X.
 *      (c) rightward facing bit (`| 0x80` on the walk tile) — diverges on MARIO_SPRITE_CODE.
 *      (d) rightward ring selector (5 instead of 1) — diverges on MARIO_WALK_ANIM.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1cab.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1cab as oracle } from "../../translated/loc_1cab.js";
import { walkMarioLeft } from "../walkMarioLeft.js";
import { advanceMarioWalkX } from "../advanceMarioWalkX.js";
import { nextAnimationStep } from "../nextAnimationStep.js";
import { beginWalkStep } from "../beginWalkStep.js";
import { Machine } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import {
  STACK_SCRATCH, MARIO_MOVE_STEP_TIMER, MARIO_WALK_ANIM,
  MARIO_X, MARIO_Y, MARIO_SPRITE_CODE, BOARD,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1cab;
const FRAMES = 1400;      // first natural dispatch lands between frames 1000 and 1200
const RET_ADDR = 0x1afe;  // a plausible caller-return; only pc-equality matters, not its value
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** MARIO_WALK_ANIM values nextAnimationStep terminates on, derived independently of nextAnimationStep: its
 *  selector is the walk-anim byte, decremented first when bit 2 is set, and the leftward
 *  table 0xB4 holds a permutation of {0,1,2,3}, so any selector past 3 matches no field and
 *  the ROM spins. Off-ring values are skipped by the sweeps, never guarded in the routine. */
const terminates = (anim) => (((anim & 0x04) ? u8(anim - 1) : anim)) <= 3;

/** The leftward ring's successor for every terminating index, written out as literals so the
 *  non-vacuity checks do not just re-run nextAnimationStep. The four on-ring values cycle
 *  0 -> 1 -> 4 -> 2 -> 0; 3 is off-cycle and lands back on the ring at 2. The EQUAL
 *  comparison against the frozen oracle remains the actual gate. */
const LEFT_RING_NEXT = { 0: 1, 1: 4, 2: 0, 3: 2, 4: 2 };

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
 *  region (the oracle's push16(0x1CBD) and the chain's returns land there; the idiomatic
 *  routine uses the JS call stack, so excluding it is the contract, not a fudge). */
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

/** Run the ORACLE on a fresh clone; its callee chain's tail `ret` advances pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { m: c, ret };
}

/** Run a candidate on a fresh clone, then model its single net caller-return with ONE
 *  m.ret() so pc + SP match the oracle's. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  c.ret();
  return { m: c, ret };
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP, and the
 *  return value the cascade propagates. NO registers — the live-out is memory-only. */
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

// -- capture + craft ----------------------------------------------------------

/** Hook 0x1CAB in a real attract run and clone the machine at up to K real dispatches.
 *  The wrapper snapshots the entry state, then runs the oracle so the host proceeds. */
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

/** A real captured state with the routine's inputs poked and a stack carrying a plausible
 *  caller return (so the chain's terminal `ret` has a sane target and its pops land in the
 *  dead STACK_SCRATCH region). */
function craft(seed, { timer, anim, board, x, y, code }) {
  const m = seed.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  if (timer !== undefined) m.mem.write8(MARIO_MOVE_STEP_TIMER, timer);
  if (anim !== undefined) m.mem.write8(MARIO_WALK_ANIM, anim);
  if (board !== undefined) m.mem.write8(BOARD, board);
  if (x !== undefined) m.mem.write8(MARIO_X, x);
  if (y !== undefined) m.mem.write8(MARIO_Y, y);
  if (code !== undefined) m.mem.write8(MARIO_SPRITE_CODE, code);
  return m;
}

// -- teeth twins --------------------------------------------------------------

/** (a) inverted timer branch: begins a new step while one is in progress and vice versa. */
function brokenInvertedBranch(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) === 0) { // BUG: inverted
    return advanceMarioWalkX(m, 255);
  }
  const nextAnim = nextAnimationStep(0x01, mem.read8(MARIO_WALK_ANIM)).a;
  mem.write8(MARIO_WALK_ANIM, nextAnim);
  regs.a = nextAnim & 0x03;
  return beginWalkStep(m);
}

/** (b) rightward walk delta: steps Mario +1 (the rightward twin's direction) instead of −1. */
function brokenRightwardDelta(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) {
    return advanceMarioWalkX(m, 1); // BUG: should be 255 (one pixel left)
  }
  const nextAnim = nextAnimationStep(0x01, mem.read8(MARIO_WALK_ANIM)).a;
  mem.write8(MARIO_WALK_ANIM, nextAnim);
  regs.a = nextAnim & 0x03;
  return beginWalkStep(m);
}

/** (c) rightward facing bit: ORs in bit 7, which only the rightward twin at 0x1C8F does. */
function brokenFacingBit(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) {
    return advanceMarioWalkX(m, 255);
  }
  const nextAnim = nextAnimationStep(0x01, mem.read8(MARIO_WALK_ANIM)).a;
  mem.write8(MARIO_WALK_ANIM, nextAnim);
  regs.a = (nextAnim & 0x03) | 0x80; // BUG: facing-right bit belongs to the twin
  return beginWalkStep(m);
}

/** (d) rightward ring selector: walks MARIO_WALK_ANIM around the ring the other way. */
function brokenRightwardRing(m) {
  const { regs, mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) {
    return advanceMarioWalkX(m, 255);
  }
  const nextAnim = nextAnimationStep(0x05, mem.read8(MARIO_WALK_ANIM)).a; // BUG: should be 0x01
  mem.write8(MARIO_WALK_ANIM, nextAnim);
  regs.a = nextAnim & 0x03;
  return beginWalkStep(m);
}

// -- 1. REACHABILITY + EQUAL (real captured dispatches) -----------------------

test("REACHABILITY + EQUAL (real dispatches): walkMarioLeft == oracle on every captured 0x1CAB entry", () => {
  const caps = captureDispatches(256, FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x1CAB dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, walkMarioLeft); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }

  const newStep = caps.filter((c) => c.mem.read8(MARIO_MOVE_STEP_TIMER) === 0).length;
  const inProgress = caps.length - newStep;
  assert.ok(
    newStep >= 1 && inProgress >= 1,
    `both arms must occur naturally (new-step ${newStep}, in-progress ${inProgress})`,
  );
  const anims = new Set(caps.map((c) => c.mem.read8(MARIO_WALK_ANIM)));
  for (const onRing of [0, 1, 2, 4]) {
    assert.ok(anims.has(onRing), `expected ring value ${onRing} among real dispatches`);
  }
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP+return ` +
      `(new-step arm ${newStep}, in-progress arm ${inProgress}; ring values seen [${[...anims].sort().join(",")}])`,
  );
});

// -- 2. EQUAL (crafted, exhaustive over the decision surface) -----------------

test("EQUAL (crafted): all 256 timer values on 25m and off it, plus every terminating ring index", () => {
  const caps = captureDispatches(1, FRAMES);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // -- the timer branch, swept exhaustively, on 25m (girder snap live) and off it --
  let timerCases = 0;
  for (const board of [1, 4]) {
    for (let timer = 0; timer <= 255; timer++) {
      const c = { timer, anim: 2, board, x: 0x60, y: 0x30, code: 0x11 };
      const entry = craft(seed, c);
      const diffs = contractDiffs(entry, walkMarioLeft);
      assert.equal(diffs.length, 0, `board ${board} timer ${timer}: ${diffs.join("; ")}`);
      timerCases++;

      // Non-vacuity: the arm the timer selects really did what it claims.
      const after = runOracle(entry).m;
      if (timer !== 0) {
        assert.equal(after.mem.read8(MARIO_X), u8(c.x - 1), `board ${board} timer ${timer}: X must step LEFT`);
        assert.equal(after.mem.read8(MARIO_WALK_ANIM), c.anim, `board ${board} timer ${timer}: ring must not advance`);
      } else {
        assert.equal(after.mem.read8(MARIO_X), c.x, `board ${board}: the new-step arm must not move X`);
        assert.equal(after.mem.read8(MARIO_WALK_ANIM), LEFT_RING_NEXT[c.anim], `board ${board}: ring successor`);
      }
    }
  }

  // -- the new-step arm, swept over every MARIO_WALK_ANIM nextAnimationStep terminates on --
  const ringCases = [];
  for (let anim = 0; anim <= 255; anim++) {
    if (!terminates(anim)) continue; // the ROM would spin here; see the header
    ringCases.push(anim);
    const entry = craft(seed, { timer: 0, anim, board: 1, x: 0x60, y: 0x30, code: 0x11 });
    const diffs = contractDiffs(entry, walkMarioLeft);
    assert.equal(diffs.length, 0, `ring index ${anim}: ${diffs.join("; ")}`);

    // Non-vacuity: the ring successor, the masked walk tile with bit 7 CLEAR, and the
    // sub-step timer reload the shared tail performs.
    const after = runOracle(entry).m;
    const next = LEFT_RING_NEXT[anim];
    assert.equal(after.mem.read8(MARIO_WALK_ANIM), next, `ring index ${anim}: successor`);
    assert.equal(after.mem.read8(MARIO_SPRITE_CODE), next & 0x03, `ring index ${anim}: walk tile, facing bit clear`);
    assert.equal(after.mem.read8(MARIO_MOVE_STEP_TIMER), 2, `ring index ${anim}: sub-step timer re-armed`);
  }
  assert.deepEqual(ringCases, [0, 1, 2, 3, 4], "the terminating ring domain must be exactly {0,1,2,3,4}");

  console.log(
    `  EQUAL/crafted: ${timerCases} timer-sweep cases (boards 1 and 4, all 256 values) + ` +
      `${ringCases.length} terminating ring indices identical on RAM+pc+SP+return`,
  );
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: inverted branch, rightward delta, rightward facing bit, and rightward ring are CAUGHT", () => {
  const caps = captureDispatches(1, FRAMES);
  assert.ok(caps.length >= 1, "need a real capture for the teeth check");
  const seed = caps[0];

  // (a) inverted timer branch — on a new-step entry the correct routine advances the ring
  //     and the twin instead walks Mario, so MARIO_WALK_ANIM diverges.
  const branchEntry = craft(seed, { timer: 0, anim: 0, board: 1, x: 0x60, y: 0x30 });
  const dBranch = contractDiffs(branchEntry, brokenInvertedBranch);
  assert.ok(dBranch.length > 0, "the inverted-branch twin escaped — the gate is worthless");

  // (b) rightward walk delta — an in-progress entry; correct X = x−1, twin X = x+1.
  const deltaEntry = craft(seed, { timer: 2, anim: 0, board: 1, x: 0x60, y: 0x30 });
  assert.equal(runOracle(deltaEntry).m.mem.read8(MARIO_X), 0x5f, "sanity: the oracle steps LEFT");
  const dDelta = contractDiffs(deltaEntry, brokenRightwardDelta);
  assert.ok(dDelta.length > 0, "the rightward-delta twin escaped — the gate is worthless");
  assert.ok(dDelta[0].startsWith(`RAM@${hx(MARIO_X)}`), `expected the X diff first, got ${dDelta[0]}`);

  // (c) rightward facing bit — a new-step entry; the twin stores bit 7 into the sprite code.
  const facingEntry = craft(seed, { timer: 0, anim: 0, board: 1, x: 0x60, y: 0x30, code: 0x11 });
  assert.equal(runOracle(facingEntry).m.mem.read8(MARIO_SPRITE_CODE), 0x01, "sanity: facing bit stays clear");
  const dFacing = contractDiffs(facingEntry, brokenFacingBit);
  assert.ok(dFacing.length > 0, "the facing-bit twin escaped — the gate is worthless");
  assert.ok(dFacing[0].startsWith(`RAM@${hx(MARIO_SPRITE_CODE)}`), `expected the sprite-code diff first, got ${dFacing[0]}`);

  // (d) rightward ring selector — a new-step entry where the two rings disagree
  //     (index 0 steps to 1 leftward, to 2 rightward).
  const ringEntry = craft(seed, { timer: 0, anim: 0, board: 1, x: 0x60, y: 0x30 });
  assert.equal(runOracle(ringEntry).m.mem.read8(MARIO_WALK_ANIM), 1, "sanity: the leftward ring steps 0 -> 1");
  const dRing = contractDiffs(ringEntry, brokenRightwardRing);
  assert.ok(dRing.length > 0, "the rightward-ring twin escaped — the gate is worthless");
  assert.ok(dRing[0].startsWith(`RAM@${hx(MARIO_WALK_ANIM)}`), `expected the walk-anim diff first, got ${dRing[0]}`);

  console.log(
    `  TEETH: inverted branch caught (${dBranch[0]}); rightward delta caught (${dDelta[0]}); ` +
      `facing bit caught (${dFacing[0]}); rightward ring caught (${dRing[0]})`,
  );
});
