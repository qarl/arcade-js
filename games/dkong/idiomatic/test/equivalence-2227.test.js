// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for hold50mObjectParked (ROM 0x2227) — one arm of the dispatch50mObjectState board-object
 * state machine: tick this object's dwell timer, advance its state when the timer
 * elapses, and stamp the shared flag 0x621a when Mario has reached the object's target X.
 *
 * hold50mObjectParked is dispatched only in gameplay — dispatch50mObjectState's board gate skips its whole body
 * in attract, so 0x2227 (and its hit-test callee 0x2243) never fire there. Realistic
 * machine states are therefore captured at the reachable ancestor dispatch50mObjectState (ROM 0x2207)
 * and a valid record base + caller stack are laid over each; crafted entries then drive
 * every arm directly.
 *
 * STACK MODEL. The record base arrives on the Z80 stack (dispatch50mObjectState pushes it) and this arm
 * pops it — a genuine oracle boundary, kept as a stack pop. The oracle then brackets its
 * hit-test call with a pushed return that either the hit (0x2243's `ret`) or the miss
 * (0x2257's `pop hl`/`ret`) pops, and finishes with its own `ret`; on EVERY path it nets
 * exactly one caller-return pop, so the idiomatic routine (a plain JS return + a direct
 * loc_2243 call) is lined up with ONE m.ret() after it. The pushed return addresses and
 * the popped bytes live in STACK_SCRATCH, excluded by the memory-equivalence contract.
 *
 *   1. EQUAL (crafted) — poke the record (state/timer/target-X) and Mario cells
 *      identically on both sides to drive all four arms for both record bases:
 *        - timer running + hit  -> stamp 0x621a = 0, state untouched
 *        - timer running + miss -> no stamp, state untouched (caller-skip)
 *        - timer elapses + hit  -> advance state, stamp 0x621a = 1
 *        - timer elapses + miss -> advance state (it happens before the test), NO stamp
 *      plus miss via each of the hit test's three conditions (X, airborne, reach-Y) and
 *      the timer wrap (a 0 timer decrements to 0xff and counts as still-running, proving
 *      the elapse test is `== 0` on the decremented value, not `<= 0`). The dwell timer
 *      is decremented on every arm. RAM − the stack scratch below the caller frame + pc + SP identical to the oracle.
 *
 *   2. REALISM (captured) — capture real in-play states at dispatch50mObjectState (0x2207) during
 *      attract, overlay a valid record base + stack, and confirm hold50mObjectParked == oracle on
 *      each over several timer/target configs (real Mario cells decide hit vs miss).
 *
 *   3. TEETH — three broken twins, each MUST be caught:
 *      (a) stamps the flag on a miss (drops the caller-skip) — caught at 0x621a.
 *      (b) stamps the wrong branch value (1 in the running branch) — caught at 0x621a.
 *      (c) drops the state advance in the elapsed branch — caught at the record's +0 byte.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2227.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2227 as oracle } from "../../translated/loc_2227.js";
import { hold50mObjectParked } from "../hold50mObjectParked.js";
import { marioReachedTargetColumn as loc_2243 } from "../marioReachedTargetColumn.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD_OBJ_SCRATCH,
  MARIO_X,
  MARIO_Y,
  MARIO_AIRBORNE,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2227;
const ANCESTOR = 0x2207;      // dispatch50mObjectState: the reachable same-subsystem ancestor
const RET_ADDR = 0x199e;      // the site right after `call 0x2207`; the arm returns here
const FLAG = 0x621a;          // the shared object flag this arm stamps (kept hex in names.js)
const REACH_Y = 0x7a;         // loc_2243: a hit needs MARIO_Y < 0x7a
const FLAG_INIT = 0x77;       // sentinel pre-value, so "no stamp" is visibly unchanged
// The two record bases dispatch50mObjectState selects on frame parity (0x6280 odd / 0x6288 even).
const BASES = [BOARD_OBJ_SCRATCH, BOARD_OBJ_SCRATCH + 8];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const POPPED_ARG = 2; // ROM opens with `pop hl`: the stacked word at entry SP is consumed, so the caller frame starts above it

// First RAM byte that differs between two machines, skipping the stack scratch below the caller frame
// region (the memory-equivalence contract is RAM − the stack scratch below the caller frame). { addr, a, b } | null.
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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single net caller-return with one
 * m.ret() so pc + SP line up with the oracle (the idiomatic routine replaces the Z80
 * stack with the JS call stack, so it does not touch pc/SP itself beyond the live-in pop).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the caller frame, pc, SP. Live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp + POPPED_ARG);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values. clone() neutralises the frame machinery (nextNmi/nextBoundary = ∞).
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// Lay a valid hold50mObjectParked entry over a base: a caller return then the record base on the
// stack (the arm pops the base), the three record bytes, and the three Mario cells.
function craft(base, { recordBase, state = 0x03, timer, targetX, marioX, marioY, marioAir, flag = FLAG_INIT }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);       // caller return, below the record base
  m.push16(recordBase);     // record base on top — the arm pops this
  m.mem.write8(recordBase + 0, state);
  m.mem.write8(recordBase + 1, timer);
  m.mem.write8(recordBase + 2, targetX);
  m.mem.write8(MARIO_X, marioX);
  m.mem.write8(MARIO_Y, marioY);
  m.mem.write8(MARIO_AIRBORNE, marioAir);
  m.mem.write8(FLAG, flag);
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2227 never dispatches in attract, but its ancestor 0x2207 does", () => {
  let armCount = 0, ancCount = 0;

  // Count target dispatches: none expected — dispatch50mObjectState's body is gated off in attract.
  const host = new Machine(ROM, { overrides: new Map([[TARGET, (mm) => { armCount++; return oracle(mm); }]]) });
  host.runFrames(1200);
  assert.equal(armCount, 0, "0x2227 should NOT dispatch in attract (dispatch50mObjectState's body is gated off)");

  // Count ancestor dispatches: the override delegates to the un-overridden oracle copy.
  const orig = new Machine(ROM).routines.get(ANCESTOR);
  const host2 = new Machine(ROM, { overrides: new Map([[ANCESTOR, (mm) => { ancCount++; return orig(mm); }]]) });
  host2.runFrames(1200);
  assert.ok(ancCount > 0, "the ancestor dispatch50mObjectState (0x2207) should dispatch in attract");
  console.log(`  REACHABILITY: 0x2227 dispatched ${armCount}x; ancestor 0x2207 ${ancCount}x in 1200 frames (target is crafted below)`);
});

// -- 1. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): every timer/hit arm matches the oracle over both record bases", () => {
  const base = attractBase();
  let n = 0;

  for (const recordBase of BASES) {
    const cases = [
      // timer running (dec 5->4, nonzero) + HIT -> stamp 0
      { name: "running+hit", timer: 5, targetX: 0x50, marioX: 0x50, marioY: 0x40, marioAir: 0,
        elapse: false, hit: true, flag: 0 },
      // timer running + MISS via X mismatch -> no stamp
      { name: "running+miss(X)", timer: 5, targetX: 0x50, marioX: 0x51, marioY: 0x40, marioAir: 0,
        elapse: false, hit: false },
      // timer elapses (dec 1->0) + HIT -> advance state, stamp 1
      { name: "elapse+hit", timer: 1, targetX: 0x60, marioX: 0x60, marioY: 0x40, marioAir: 0,
        elapse: true, hit: true, flag: 1 },
      // timer elapses + MISS via airborne -> advance state (before the test), NO stamp
      { name: "elapse+miss(air)", timer: 1, targetX: 0x60, marioX: 0x60, marioY: 0x40, marioAir: 1,
        elapse: true, hit: false },
      // timer elapses + MISS via reach-Y (>= 0x7a) -> advance state, NO stamp
      { name: "elapse+miss(Y)", timer: 1, targetX: 0x60, marioX: 0x60, marioY: REACH_Y, marioAir: 0,
        elapse: true, hit: false },
      // timer wrap: 0 -> 0xff counts as STILL RUNNING (not elapsed) + HIT -> stamp 0
      { name: "wrap(0->ff)+hit", timer: 0, targetX: 0x70, marioX: 0x70, marioY: 0x40, marioAir: 0,
        elapse: false, hit: true, flag: 0 },
    ];

    for (const c of cases) {
      const entry = craft(base, { recordBase, ...c });
      const diffs = contractDiffs(entry, hold50mObjectParked);
      assert.equal(diffs.length, 0, `${c.name} @${hx(recordBase)}: ${diffs.join("; ")}`);

      // Non-vacuity: confirm the ORACLE actually took the arm this case intends.
      const after = runOracle(entry);
      const expTimer = (c.timer - 1) & 0xff;
      assert.equal(after.mem.read8(recordBase + 1), expTimer, `${c.name}: timer not decremented`);
      assert.equal(after.mem.read8(recordBase + 0), c.elapse ? 0x04 : 0x03, `${c.name}: state advance wrong`);
      assert.equal(after.mem.read8(FLAG), c.hit ? c.flag : FLAG_INIT, `${c.name}: flag stamp wrong`);
      n++;
    }
  }
  console.log(`  EQUAL/crafted: ${n} arms (running/elapse × hit/miss × 2 bases, +wrap +Y/air misses) identical to the oracle`);
});

// -- 2. REALISM (captured) ----------------------------------------------------

function captureAncestorStates(K, frames) {
  const orig = new Machine(ROM).routines.get(ANCESTOR);
  const caps = [];
  const snap = new Map([[ANCESTOR, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return orig(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(frames);
  return caps;
}

test("REALISM (captured): hold50mObjectParked == oracle on real states from dispatch50mObjectState", () => {
  const caps = captureAncestorStates(120, 2000);
  assert.ok(caps.length >= 1, "expected dispatch50mObjectState (0x2207) to dispatch during attract");

  let compared = 0, sawHit = 0, sawMiss = 0;
  for (const cap of caps) {
    const realMarioX = cap.mem.read8(MARIO_X);
    const realMarioY = cap.mem.read8(MARIO_Y);
    const realMarioAir = cap.mem.read8(MARIO_AIRBORNE);
    // Overlay several record/timer/target configs onto each real work-RAM state. The
    // first three keep Mario's real position (it decides hit vs miss); the last pins
    // Mario grounded + in-reach at the target so the stamp path is exercised on a real
    // base too (a surgical nudge, everything else real).
    const variants = [
      { recordBase: BASES[0], timer: 1, targetX: realMarioX, marioX: realMarioX, marioY: realMarioY, marioAir: realMarioAir },
      { recordBase: BASES[1], timer: 3, targetX: realMarioX, marioX: realMarioX, marioY: realMarioY, marioAir: realMarioAir },
      { recordBase: BASES[0], timer: 1, targetX: (realMarioX ^ 0xff), marioX: realMarioX, marioY: realMarioY, marioAir: realMarioAir },
      { recordBase: BASES[1], timer: 3, targetX: realMarioX, marioX: realMarioX, marioY: 0x40, marioAir: 0 }, // forced hit
    ];
    for (const v of variants) {
      const entry = craft(cap, v);
      const diffs = contractDiffs(entry, hold50mObjectParked);
      assert.equal(diffs.length, 0, `real state: ${diffs.join("; ")}`);
      // Classify for reporting (did the oracle stamp the flag?).
      if (runOracle(entry).mem.read8(FLAG) !== FLAG_INIT) sawHit++; else sawMiss++;
      compared++;
    }
  }
  console.log(`  REALISM: ${compared} overlays on ${caps.length} real dispatch50mObjectState states — RAM==oracle (${sawHit} hit, ${sawMiss} miss)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): drops the caller-skip — stamps the flag even on a miss. */
function brokenStampOnMiss(m) {
  const { regs, mem } = m;
  const base = m.pop16();
  const timer = (mem.read8(base + 1) - 1) & 0xff;
  mem.write8(base + 1, timer);
  if (timer === 0) {
    mem.write8(base, mem.read8(base) + 1);
    regs.hl = base + 2;
    loc_2243(m);            // BUG: ignore the miss signal
    mem.write8(FLAG, 1);
    return;
  }
  regs.hl = base + 2;
  loc_2243(m);              // BUG: ignore the miss signal
  mem.write8(FLAG, 0);
}

/** Broken twin (b): stamps 1 in the running branch (should be 0). */
function brokenBranchValue(m) {
  const { regs, mem } = m;
  const base = m.pop16();
  const timer = (mem.read8(base + 1) - 1) & 0xff;
  mem.write8(base + 1, timer);
  if (timer === 0) {
    mem.write8(base, mem.read8(base) + 1);
    regs.hl = base + 2;
    if (!loc_2243(m)) return;
    mem.write8(FLAG, 1);
    return;
  }
  regs.hl = base + 2;
  if (!loc_2243(m)) return;
  mem.write8(FLAG, 1);       // BUG: should be 0 in the running branch
}

/** Broken twin (c): drops the state advance in the elapsed branch. */
function brokenNoStateAdvance(m) {
  const { regs, mem } = m;
  const base = m.pop16();
  const timer = (mem.read8(base + 1) - 1) & 0xff;
  mem.write8(base + 1, timer);
  if (timer === 0) {
    // BUG: no state advance here
    regs.hl = base + 2;
    if (!loc_2243(m)) return;
    mem.write8(FLAG, 1);
    return;
  }
  regs.hl = base + 2;
  if (!loc_2243(m)) return;
  mem.write8(FLAG, 0);
}

test("TEETH: the stamp-on-miss, wrong-branch-value, and dropped-state-advance twins are CAUGHT", () => {
  const base = attractBase();
  const rb = BASES[0];

  // (a) stamp-on-miss: a running+miss case — oracle leaves the flag, twin stamps 0.
  const miss = craft(base, { recordBase: rb, timer: 5, targetX: 0x50, marioX: 0x51, marioY: 0x40, marioAir: 0 });
  const dMiss = contractDiffs(miss, brokenStampOnMiss);
  assert.ok(dMiss.length > 0, "stamp-on-miss twin escaped — the gate is worthless");
  assert.ok(dMiss[0].startsWith(`RAM@${hx(FLAG)}`), `expected the miss diff at ${hx(FLAG)}, got ${dMiss[0]}`);

  // (b) wrong branch value: a running+hit case — oracle stamps 0, twin stamps 1.
  const runHit = craft(base, { recordBase: rb, timer: 5, targetX: 0x50, marioX: 0x50, marioY: 0x40, marioAir: 0 });
  const dVal = contractDiffs(runHit, brokenBranchValue);
  assert.ok(dVal.length > 0, "wrong-branch-value twin escaped — the gate is worthless");
  assert.ok(dVal[0].startsWith(`RAM@${hx(FLAG)}`), `expected the value diff at ${hx(FLAG)}, got ${dVal[0]}`);

  // (c) dropped state advance: an elapse case — oracle advances +0, twin does not.
  const elapse = craft(base, { recordBase: rb, timer: 1, targetX: 0x60, marioX: 0x60, marioY: 0x40, marioAir: 0 });
  const dAdv = contractDiffs(elapse, brokenNoStateAdvance);
  assert.ok(dAdv.length > 0, "dropped-state-advance twin escaped — the gate is worthless");
  assert.ok(dAdv[0].startsWith(`RAM@${hx(rb)}`), `expected the state diff at ${hx(rb)}, got ${dAdv[0]}`);

  console.log(`  TEETH: stamp-on-miss (${dMiss[0]}); wrong-branch-value (${dVal[0]}); dropped-state-advance (${dAdv[0]})`);
});
