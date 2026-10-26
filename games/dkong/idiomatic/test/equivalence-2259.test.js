// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for slide50mObjectDown (ROM 0x2259) — the descend arm of the dispatch50mObjectState
 * board-object state machine: tick the object's timer, step its position counter UP — which
 * moves the object DOWN the screen, since larger Y is lower — and mirror it on-screen, advance
 * its state at the BOTTOM of travel (the counter's maximum, 120, its lowest point on screen),
 * then (once Mario has reached the object's target column) settle his climb one pixel at a time.
 *
 * slide50mObjectDown is entered with the object record base on the stack (the oracle's `pop hl`); the
 * idiomatic routine takes that base as a parameter. Its observable effect factors cleanly
 * into two independent regimes, so a crafted sweep is a PROOF, not a sample:
 *
 *   OBJECT TICK — the +4 timer decrements; until it underflows only +4 is written. On the
 *                 underflow it reloads +4, steps the +3 counter UP, mirrors the new counter
 *                 to a sprite cell (publish50mObjectYToSprite), and — only when the stepped counter equals
 *                 120 — advances the state byte (+0). Everything here is a function of the
 *                 +4 and +3 values alone. Swept with Mario held in a hit-test MISS (airborne)
 *                 so the climb-settle never runs and cannot confound this regime.
 *   CLIMB SETTLE — after the tick, the hit test (marioReachedTargetColumn) fires; on a hit
 *                 the routine either steps Mario down one pixel in the climb pose
 *                 (stepMarioDownInClimbPose) while his screen Y is below the centring band
 *                 (104) or on an odd row, or else publishes bit 1 of his Y into the 0x6222
 *                 climb-centring toggle. Swept over EVERY MARIO_Y 0..255 with Mario pinned to
 *                 a hit, covering every descend/toggle decision AND the Y-based hit-test miss.
 *
 * The two records dispatch50mObjectState actually uses (0x6280 / 0x6288) between them exercise BOTH sprite
 * slots publish50mObjectYToSprite can pick: +3 of 0x6280 is 0x6283 (bit 3 clear -> 0x6947), +3 of 0x6288 is
 * 0x628b (bit 3 set -> 0x694b).
 *
 * The oracle brackets each dissolved call (the mirror, the hit test, the descend) with a
 * pushed return address; the idiomatic routine direct-calls, dropping those pushes. Their
 * dead scratch lands in STACK_SCRATCH, which the memory-equivalence contract excludes
 * (mirrors equivalence-22a2 / -2281). The oracle's entry `pop hl`, its returns, and the
 * two-level hit-test skip only READ the stack, so live-out is memory-only and pc/SP are not
 * compared.
 *
 *   1. EQUAL (object tick, exhaustive) — slide50mObjectDown == oracle on RAM − the stack scratch below the caller frame across
 *      the timer sweep and the counter sweep on both records, plus non-vacuity: the mirror
 *      really copies the stepped counter to the record's selected sprite cell (leaving the
 *      other untouched) and the state byte really advances at counter 120.
 *   2. EQUAL (climb settle, exhaustive over Y) — slide50mObjectDown == oracle across every MARIO_Y on
 *      both records, plus non-vacuity: a below-band/odd Y steps Mario down and pins the pose
 *      (0x6222 untouched); an in-band even Y publishes bit 1 of Y into 0x6222 (Mario
 *      untouched); a Y past the reach band skips the settle entirely.
 *   3. EQUAL (hit-test miss via X) — a hit test that misses on the target-X condition also
 *      skips the settle, matching the oracle.
 *   4. TEETH — four broken twins the sweeps MUST catch: counter-goes-down, wrong state
 *      threshold, dropped Mario descend, and wrong toggle bit.
 *   5. REALISM — hook 0x2259 in a real attract run; document the (zero) natural dispatches
 *      (dispatch50mObjectState's board gate is closed in attract) and verify any that DO occur.
 *
 * COVERAGE HOLE, stated plainly (R17). Attract-zero is NOT "this arm never runs". Grounding on
 * a real 50m board has since driven this arm through hundreds of body passes and steered all
 * three of its write sites, and THIS GATE REPLAYS NONE OF THAT. What it proves is agreement
 * with the oracle over the arm's whole factored decision space on crafted entries; what it
 * does not prove is that a real 50m board reproduces frame for frame.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2259.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2259 as oracle } from "../../translated/loc_2259.js";
import { slide50mObjectDown } from "../slide50mObjectDown.js";
import { publish50mObjectYToSprite } from "../publish50mObjectYToSprite.js"; // mirror the twins still call
import { marioReachedTargetColumn } from "../marioReachedTargetColumn.js"; // hit test the twins still call
import { stepMarioDownInClimbPose } from "../stepMarioDownInClimbPose.js"; // descend the twins still call
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD_OBJ_SCRATCH,
  SPRITE_BUFFER,
  MARIO_X,
  MARIO_Y,
  MARIO_AIRBORNE,
  MARIO_SPRITE_RECORD,
  SPRITE_CODE,
  SPRITE_Y,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2259;

// The two records dispatch50mObjectState dispatches (odd/even frame parity); between them their +3 field
// selects both of publish50mObjectYToSprite's sprite slots.
const RECORDS = [BOARD_OBJ_SCRATCH, BOARD_OBJ_SCRATCH + 8]; // 0x6280, 0x6288

// publish50mObjectYToSprite's two destination cells (+3 field of sprite records 17/18 inside SPRITE_BUFFER).
const DEST_BIT3_CLEAR = SPRITE_BUFFER + 17 * 4 + 3; // 0x6947 — chosen by 0x6280's +3 (0x6283)
const DEST_BIT3_SET = SPRITE_BUFFER + 18 * 4 + 3; // 0x694b — chosen by 0x6288's +3 (0x628b)
const spriteDest = (recordBase) => (((recordBase + 3) & 0x08) !== 0 ? DEST_BIT3_SET : DEST_BIT3_CLEAR);
const spriteOther = (recordBase) => (spriteDest(recordBase) === DEST_BIT3_SET ? DEST_BIT3_CLEAR : DEST_BIT3_SET);

// Mario sprite record cells stepMarioDownInClimbPose touches on the descend.
const POSE_CELL = MARIO_SPRITE_RECORD + SPRITE_CODE; // 0x694d — pinned to 3 by the descend
const SPRITE_Y_CELL = MARIO_SPRITE_RECORD + SPRITE_Y; // 0x694f — stepped down by the descend
const CLIMB_CENTRING_TOGGLE = 0x6222; // examined-and-unnamed in names.js (shared toggle)

// The counter's maximum — the BOTTOM of travel, lowest on screen, where the state advances —
// and Mario's centring band, in slide50mObjectDown. (COUNTER_TOP names the top of the counter's
// numeric range, not the top of the screen.)
const COUNTER_TOP = 120; // 0x78
const CENTRING_BAND = 104; // 0x68
const REACH_TOP = 122; // 0x7a — marioReachedTargetColumn's Y cutoff; at/above it, always a miss
const TARGET_X = 0x50; // the object's target column used in the climb-settle sweeps

// Distinct sentinels so every write is observable — a wrong/missing store shows as a real
// RAM difference rather than aliasing the value already there.
const STATE_SENTINEL = 0xaa; // field +0 (state advance writes +1)
const FIELD1_SENTINEL = 0x55; // field +1 (never written by slide50mObjectDown)
const TARGET_SENTINEL = 0x33; // field +2 target column (read, never written)
const SPRITE_SENTINEL = 0x11; // both mirror cells (mirror writes one)
const POSE_SENTINEL = 0x77; // 0x694d (descend pins it to 3)
const SPRITE_Y_SENTINEL = 0x99; // 0x694f (descend steps it)
const TOGGLE_SENTINEL = 0xc3; // 0x6222 (settle writes 0/1; sentinel is neither)

// The oracle pops the record base, then pushes/pops return addresses around its dissolved
// calls and returns; point SP at the stack scratch so those bytes stay clear of the record,
// Mario, and sprite regions.
const SP_TOP = 0x6c00;
const CALLER_RET = 0x199e; // plausible terminal-return target (pc is not compared)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const fieldOf = (recordBase, n) => (recordBase & 0xff00) | ((recordBase + n) & 0xff);
const POPPED_ARG = 2; // ROM opens with `pop hl`: the stacked word at entry SP is consumed, so the caller frame starts above it

// First RAM byte that differs between two machines, skipping the stack scratch below the caller frame
// (the memory-equivalence contract is RAM − the stack scratch below the caller frame). { addr, a, b } | null.
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

// A real, self-consistent machine: boot + a stretch of attract so surrounding work RAM holds
// realistic values. 0x2259's body is never reached here; it is crafted by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Lay the oracle's stack on a crafted entry: caller return then the record base, so the top
// holds the base for the oracle's `pop hl`. Frame machinery neutralised so no stray NMI can
// masquerade as a side effect.
function layStack(e, recordBase) {
  e.regs.sp = SP_TOP;
  e.push16(CALLER_RET);
  e.push16(recordBase);
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

// -- object-tick entries: Mario forced into a hit-test MISS (airborne) so only the tick runs.
function makeTickEntry(base, recordBase, timer, position) {
  const e = base.clone();
  const at = (n) => fieldOf(recordBase, n);
  e.mem.write8(at(0), STATE_SENTINEL);
  e.mem.write8(at(1), FIELD1_SENTINEL);
  e.mem.write8(at(2), TARGET_SENTINEL);
  e.mem.write8(at(3), position);
  e.mem.write8(at(4), timer);
  e.mem.write8(DEST_BIT3_CLEAR, SPRITE_SENTINEL);
  e.mem.write8(DEST_BIT3_SET, SPRITE_SENTINEL);
  e.mem.write8(MARIO_AIRBORNE, 1); // airborne -> the hit test always misses
  return layStack(e, recordBase);
}

// -- climb-settle entries: the tick fires cleanly (timer 1, counter well below the top) and
// Mario is pinned to a HIT (grounded, X aligned) so the settle decision is driven by MARIO_Y.
function makeClimbEntry(base, recordBase, marioY, { marioX = TARGET_X, airborne = 0 } = {}) {
  const e = base.clone();
  const at = (n) => fieldOf(recordBase, n);
  e.mem.write8(at(0), STATE_SENTINEL);
  e.mem.write8(at(1), FIELD1_SENTINEL);
  e.mem.write8(at(2), TARGET_X); // the object's target column
  e.mem.write8(at(3), 0x40); // -> counter 0x41; nowhere near the state-advance top
  e.mem.write8(at(4), 1); // fires this tick
  e.mem.write8(DEST_BIT3_CLEAR, SPRITE_SENTINEL);
  e.mem.write8(DEST_BIT3_SET, SPRITE_SENTINEL);
  e.mem.write8(MARIO_X, marioX);
  e.mem.write8(MARIO_Y, marioY);
  e.mem.write8(MARIO_AIRBORNE, airborne);
  e.mem.write8(POSE_CELL, POSE_SENTINEL);
  e.mem.write8(SPRITE_Y_CELL, SPRITE_Y_SENTINEL);
  e.mem.write8(CLIMB_CENTRING_TOGGLE, TOGGLE_SENTINEL);
  return layStack(e, recordBase);
}

// Run the oracle and a candidate on two fresh, byte-identical crafted entries and diff the
// memory-equivalence contract (RAM − the stack scratch below the caller frame). Fresh entries because the routine WRITES
// memory. Returns the RAM diff (or null) and the finished oracle machine (for non-vacuity).
function runPair(makeEntry, candidate, recordBase, ...args) {
  const a = makeEntry(...args); // oracle
  const aFloor = a.regs.sp;
  const b = makeEntry(...args); // candidate
  oracle(a);
  candidate(b, recordBase);
  return { ram: firstRamDiff(a, b, aFloor + POPPED_ARG), a };
}

// -- 1. EQUAL — object tick (exhaustive by factorisation) ---------------------

test("EQUAL (object tick): slide50mObjectDown == oracle across the timer and counter sweeps on both records", () => {
  const base = attractBase();
  let count = 0;

  for (const recordBase of RECORDS) {
    // Timer sweep — every +4 value (position fixed away from the state-advance top).
    for (let t = 0; t < 256; t++) {
      const { ram } = runPair(() => makeTickEntry(base, recordBase, t, 0x40), slide50mObjectDown, recordBase);
      count++;
      assert.equal(ram, null, ram &&
        `timer sweep record=${hx(recordBase)} timer=${hx(t)}: RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
    }
    // Counter sweep — the fire path (timer 1 underflows), every +3 value; covers the mirror
    // for every position and the state advance where the stepped counter hits the top.
    for (let p = 0; p < 256; p++) {
      const { ram } = runPair(() => makeTickEntry(base, recordBase, 1, p), slide50mObjectDown, recordBase);
      count++;
      assert.equal(ram, null, ram &&
        `counter sweep record=${hx(recordBase)} position=${hx(p)}: RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
    }
  }
  assert.equal(count, RECORDS.length * (256 + 256), "must have compared the full factored tick space");

  // Non-vacuity, per record: the fire really mirrors the stepped counter to the selected
  // sprite cell (leaving the other), and the state advances only at the top.
  for (const recordBase of RECORDS) {
    const dest = spriteDest(recordBase), other = spriteOther(recordBase);

    // fire, counter 0x41 -> mirror 0x41, no state advance.
    const { a: fire } = runPair(() => makeTickEntry(base, recordBase, 1, 0x40), slide50mObjectDown, recordBase);
    assert.equal(fire.mem.read8(dest), 0x41, `oracle must mirror the stepped counter to ${hx(dest)}`);
    assert.equal(fire.mem.read8(other), SPRITE_SENTINEL, `oracle must leave ${hx(other)} untouched`);
    assert.equal(fire.mem.read8(fieldOf(recordBase, 3)), 0x41, "oracle must step the counter UP");
    assert.equal(fire.mem.read8(recordBase & 0xffff), STATE_SENTINEL, "oracle must NOT advance state below the top");

    // fire, position 0x77 -> counter 0x78 == the top -> state advances.
    const { a: top } = runPair(() => makeTickEntry(base, recordBase, 1, COUNTER_TOP - 1), slide50mObjectDown, recordBase);
    assert.equal(top.mem.read8(recordBase & 0xffff), (STATE_SENTINEL + 1) & 0xff, "oracle must advance state at the top");

    // idle, timer 5 -> only +4 written (to 4), nothing else.
    const { a: idle } = runPair(() => makeTickEntry(base, recordBase, 5, 0x40), slide50mObjectDown, recordBase);
    assert.equal(idle.mem.read8(fieldOf(recordBase, 4)), 4, "oracle must step the idle timer down");
    assert.equal(idle.mem.read8(dest), SPRITE_SENTINEL, "oracle must not mirror on the idle path");
  }
  console.log(`  EQUAL/tick: ${count} crafted (record, timer|position) combos — RAM identical to the oracle`);
});

// -- 2. EQUAL — climb settle (exhaustive over MARIO_Y) ------------------------

test("EQUAL (climb settle): slide50mObjectDown == oracle across every MARIO_Y on both records", () => {
  const base = attractBase();
  let count = 0;

  for (const recordBase of RECORDS) {
    for (let y = 0; y < 256; y++) {
      const { ram } = runPair(() => makeClimbEntry(base, recordBase, y), slide50mObjectDown, recordBase);
      count++;
      assert.equal(ram, null, ram &&
        `climb sweep record=${hx(recordBase)} marioY=${hx(y)}: RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
    }
  }
  assert.equal(count, RECORDS.length * 256, "must have compared every MARIO_Y on both records");

  // Non-vacuity: the three settle outcomes each do the right thing on the oracle.
  const rb = RECORDS[0];

  // below the band -> step down, pin pose, DO NOT write the toggle.
  const { a: below } = runPair(() => makeClimbEntry(base, rb, 0x50), slide50mObjectDown, rb);
  assert.equal(below.mem.read8(MARIO_Y), 0x51, "below-band Y must step Mario down");
  assert.equal(below.mem.read8(POSE_CELL), 3, "below-band Y must pin the climb pose");
  assert.equal(below.mem.read8(SPRITE_Y_CELL), (SPRITE_Y_SENTINEL + 1) & 0xff, "below-band Y must step the sprite Y");
  assert.equal(below.mem.read8(CLIMB_CENTRING_TOGGLE), TOGGLE_SENTINEL, "below-band Y must not touch the toggle");

  // in-band, odd -> step down (not a toggle write).
  const { a: odd } = runPair(() => makeClimbEntry(base, rb, 0x69), slide50mObjectDown, rb);
  assert.equal(odd.mem.read8(MARIO_Y), 0x6a, "in-band odd Y must step Mario down");
  assert.equal(odd.mem.read8(CLIMB_CENTRING_TOGGLE), TOGGLE_SENTINEL, "in-band odd Y must not touch the toggle");

  // in-band, even -> publish bit 1 of Y; Mario untouched.
  const { a: even1 } = runPair(() => makeClimbEntry(base, rb, 0x6a), slide50mObjectDown, rb); // 106 -> bit1 = 1
  assert.equal(even1.mem.read8(CLIMB_CENTRING_TOGGLE), 1, "Y=0x6a must publish toggle 1");
  assert.equal(even1.mem.read8(MARIO_Y), 0x6a, "the toggle path must not move Mario");
  assert.equal(even1.mem.read8(POSE_CELL), POSE_SENTINEL, "the toggle path must not pin the pose");

  const { a: even0 } = runPair(() => makeClimbEntry(base, rb, 0x68), slide50mObjectDown, rb); // 104 -> bit1 = 0
  assert.equal(even0.mem.read8(CLIMB_CENTRING_TOGGLE), 0, "Y=0x68 must publish toggle 0");

  // past the reach band -> the hit test misses on Y; the settle is skipped entirely.
  const { a: miss } = runPair(() => makeClimbEntry(base, rb, REACH_TOP), slide50mObjectDown, rb); // 122
  assert.equal(miss.mem.read8(MARIO_Y), REACH_TOP, "a Y past the reach band must not move Mario");
  assert.equal(miss.mem.read8(CLIMB_CENTRING_TOGGLE), TOGGLE_SENTINEL, "a Y past the reach band must not write the toggle");

  console.log(`  EQUAL/climb: ${count} crafted (record, marioY) combos — RAM identical to the oracle`);
});

// -- 3. EQUAL — hit-test miss via the target-X condition ----------------------

test("EQUAL (hit-test miss via X): a target-X mismatch skips the settle, matching the oracle", () => {
  const base = attractBase();
  for (const recordBase of RECORDS) {
    // grounded, Y inside the band, but MARIO_X != the target column -> miss on X.
    const { ram, a } = runPair(() => makeClimbEntry(base, recordBase, 0x50, { marioX: TARGET_X ^ 0x0f }), slide50mObjectDown, recordBase);
    assert.equal(ram, null, ram && `X-miss record=${hx(recordBase)}: RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
    assert.equal(a.mem.read8(MARIO_Y), 0x50, "X-miss must not move Mario");
    assert.equal(a.mem.read8(CLIMB_CENTRING_TOGGLE), TOGGLE_SENTINEL, "X-miss must not write the toggle");
  }
  console.log("  EQUAL/X-miss: target-X mismatch skips the settle on both records — RAM identical");
});

// -- 4. TEETH -----------------------------------------------------------------

// Faithful replicas of slide50mObjectDown with exactly ONE injected bug each.
function brokenCounterDown(m, recordBase) {
  const { regs, mem } = m;
  const f = (n) => fieldOf(recordBase, n);
  const timer = (mem.read8(f(4)) - 1) & 0xff;
  mem.write8(f(4), timer);
  if (timer !== 0) return;
  mem.write8(f(4), 4);
  const counter = (mem.read8(f(3)) - 1) & 0xff; // BUG: steps DOWN instead of UP
  mem.write8(f(3), counter);
  publish50mObjectYToSprite(m, f(3));
  if (counter === COUNTER_TOP) mem.write8(f(0), mem.read8(f(0)) + 1);
  regs.hl = f(2);
  if (!marioReachedTargetColumn(m)) return;
  const y = mem.read8(MARIO_Y);
  if (y < CENTRING_BAND || (y & 1) !== 0) { stepMarioDownInClimbPose(m); return; }
  mem.write8(CLIMB_CENTRING_TOGGLE, (y >> 1) & 1);
}

function brokenWrongThreshold(m, recordBase) {
  const { regs, mem } = m;
  const f = (n) => fieldOf(recordBase, n);
  const timer = (mem.read8(f(4)) - 1) & 0xff;
  mem.write8(f(4), timer);
  if (timer !== 0) return;
  mem.write8(f(4), 4);
  const counter = (mem.read8(f(3)) + 1) & 0xff;
  mem.write8(f(3), counter);
  publish50mObjectYToSprite(m, f(3));
  if (counter === COUNTER_TOP - 1) mem.write8(f(0), mem.read8(f(0)) + 1); // BUG: advances at 119, not 120
  regs.hl = f(2);
  if (!marioReachedTargetColumn(m)) return;
  const y = mem.read8(MARIO_Y);
  if (y < CENTRING_BAND || (y & 1) !== 0) { stepMarioDownInClimbPose(m); return; }
  mem.write8(CLIMB_CENTRING_TOGGLE, (y >> 1) & 1);
}

function brokenDroppedDescend(m, recordBase) {
  const { regs, mem } = m;
  const f = (n) => fieldOf(recordBase, n);
  const timer = (mem.read8(f(4)) - 1) & 0xff;
  mem.write8(f(4), timer);
  if (timer !== 0) return;
  mem.write8(f(4), 4);
  const counter = (mem.read8(f(3)) + 1) & 0xff;
  mem.write8(f(3), counter);
  publish50mObjectYToSprite(m, f(3));
  if (counter === COUNTER_TOP) mem.write8(f(0), mem.read8(f(0)) + 1);
  regs.hl = f(2);
  if (!marioReachedTargetColumn(m)) return;
  const y = mem.read8(MARIO_Y);
  if (y < CENTRING_BAND || (y & 1) !== 0) { return; } // BUG: dropped stepMarioDownInClimbPose
  mem.write8(CLIMB_CENTRING_TOGGLE, (y >> 1) & 1);
}

function brokenWrongToggleBit(m, recordBase) {
  const { regs, mem } = m;
  const f = (n) => fieldOf(recordBase, n);
  const timer = (mem.read8(f(4)) - 1) & 0xff;
  mem.write8(f(4), timer);
  if (timer !== 0) return;
  mem.write8(f(4), 4);
  const counter = (mem.read8(f(3)) + 1) & 0xff;
  mem.write8(f(3), counter);
  publish50mObjectYToSprite(m, f(3));
  if (counter === COUNTER_TOP) mem.write8(f(0), mem.read8(f(0)) + 1);
  regs.hl = f(2);
  if (!marioReachedTargetColumn(m)) return;
  const y = mem.read8(MARIO_Y);
  if (y < CENTRING_BAND || (y & 1) !== 0) { stepMarioDownInClimbPose(m); return; }
  mem.write8(CLIMB_CENTRING_TOGGLE, y & 1); // BUG: bit 0 instead of bit 1
}

// Sweep the tick space (records × timer sweep + counter sweep) and return the first mismatch.
function tickSweep(base, candidate) {
  for (const recordBase of RECORDS) {
    for (let t = 0; t < 256; t++) {
      const { ram } = runPair(() => makeTickEntry(base, recordBase, t, 0x40), candidate, recordBase);
      if (ram) return { recordBase, kind: `timer=${hx(t)}`, ram };
    }
    for (let p = 0; p < 256; p++) {
      const { ram } = runPair(() => makeTickEntry(base, recordBase, 1, p), candidate, recordBase);
      if (ram) return { recordBase, kind: `position=${hx(p)}`, ram };
    }
  }
  return null;
}

// Sweep the climb space (records × every MARIO_Y) and return the first mismatch.
function climbSweep(base, candidate) {
  for (const recordBase of RECORDS) {
    for (let y = 0; y < 256; y++) {
      const { ram } = runPair(() => makeClimbEntry(base, recordBase, y), candidate, recordBase);
      if (ram) return { recordBase, kind: `marioY=${hx(y)}`, ram };
    }
  }
  return null;
}

test("TEETH: the counter-goes-down twin is CAUGHT", () => {
  const mm = tickSweep(attractBase(), brokenCounterDown);
  assert.notEqual(mm, null, "the tick sweep FAILED to catch an inverted counter step — worthless");
  console.log(`  TEETH/counter-down: caught at record=${hx(mm.recordBase)} ${mm.kind} — RAM@${hx(mm.ram.addr)}`);
});

test("TEETH: the wrong-state-threshold twin is CAUGHT", () => {
  const mm = tickSweep(attractBase(), brokenWrongThreshold);
  assert.notEqual(mm, null, "the tick sweep FAILED to catch a wrong state threshold — worthless");
  console.log(`  TEETH/threshold: caught at record=${hx(mm.recordBase)} ${mm.kind} — RAM@${hx(mm.ram.addr)}`);
});

test("TEETH: the dropped-Mario-descend twin is CAUGHT", () => {
  const mm = climbSweep(attractBase(), brokenDroppedDescend);
  assert.notEqual(mm, null, "the climb sweep FAILED to catch a dropped descend — worthless");
  assert.equal(mm.ram.addr, MARIO_Y, `the dropped-descend diff must land on MARIO_Y, got ${hx(mm.ram.addr)}`);
  console.log(`  TEETH/dropped-descend: caught at record=${hx(mm.recordBase)} ${mm.kind} — RAM@${hx(mm.ram.addr)}`);
});

test("TEETH: the wrong-toggle-bit twin is CAUGHT", () => {
  const mm = climbSweep(attractBase(), brokenWrongToggleBit);
  assert.notEqual(mm, null, "the climb sweep FAILED to catch a wrong toggle bit — worthless");
  assert.equal(mm.ram.addr, CLIMB_CENTRING_TOGGLE, `the wrong-toggle diff must land on the toggle, got ${hx(mm.ram.addr)}`);
  console.log(`  TEETH/toggle-bit: caught at record=${hx(mm.recordBase)} ${mm.kind} — RAM@${hx(mm.ram.addr)}`);
});

// -- 5. REALISM (natural dispatches) ------------------------------------------

test("REALISM: 0x2259 attract dispatches match the oracle (attract never reaches it)", () => {
  let count = 0;
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    count++;
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);

  for (const cap of caps) {
    const a = cap.clone(); // oracle
    const b = cap.clone(); // candidate
    a.nextNmi = Infinity; a.nextBoundary = Infinity;
    b.nextNmi = Infinity; b.nextBoundary = Infinity;
    const recordBase = b.mem.read8(b.regs.sp) | (b.mem.read8((b.regs.sp + 1) & 0xffff) << 8);
    oracle(a);
    slide50mObjectDown(b, recordBase);
    const ram = firstRamDiff(a, b, cap.regs.sp + POPPED_ARG);
    assert.equal(ram, null, ram && `real dispatch diverged at ${hx(ram.addr ?? 0)} (oracle=${ram.a} cand=${ram.b})`);
  }

  console.log(
    `  REALISM: ${count} natural 0x2259 dispatches in 2000 attract frames` +
      (count === 0
        ? " (none — dispatch50mObjectState's board gate is closed in attract; the exhaustive crafted sweeps cover the full observable space)"
        : " (all matched the oracle)"),
  );
});
