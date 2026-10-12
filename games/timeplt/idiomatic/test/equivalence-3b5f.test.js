// SPDX-License-Identifier: GPL-3.0-only
/**
 * serviceEra1BomberObject — memory-equivalent to the frozen oracle at ROM 0x3b5f. GATE: masked strict — real
 * dispatches under the tape plus crafted entries forcing each head arm; the dissolved arms drop the
 * oracle's tail return, so [low, seat) stack scratch is masked and the two-byte SP drift asserted.
 * FIRING ARM: a REGRESSION check. The rewrite seats no index register; arming hands the snapped facing
 * to the velocity lookup as an argument. So with a STALE IX (another bank's record base, whose heading
 * no facing snaps to) the rewrite must still match the frozen oracle on the arming path, and a twin
 * that takes the lookup's heading off the record the register names is caught there -- and only
 * there: with IX seated on the right record the same twin matches, so the catch is the stale record.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3b5f.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { serviceEra1BomberObject } from "../serviceEra1BomberObject.js";
import { loc_3b5f as oracle } from "../../translated/loc_3b5f.js";
import { ERA_INDEX, FRAME_TICK, BOMBER_HITS_TO_ABSORB, MOTHER_SHIP_ARMED } from "../names.js";
import { armBomberSlotWhenTimerFires } from "../armBomberSlotWhenTimerFires.js";
import { velocityForHeadingAtSlowestSpeed } from "../velocityForHeadingAtSlowestSpeed.js";
import { advanceHitSoakingObjectThenAnimateDeath } from "../advanceHitSoakingObjectThenAnimateDeath.js";
import { flyBomberThenTryAimedShot } from "../flyBomberThenTryAimedShot.js";

const TARGET = 0x3b5f;
const RECORD = 0xa8c0;
const ENTRY = 0xaa28;
const HEAD_LIVE = 0xff;
const HEAD_HIT = 0x05;
const HEAD_EMPTY = 0x00;
const ACTIVE_ERA = 1;
const OTHER_ERA = 2;
const DATA_TOP = 0xadff;
const CAP = 120;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr)}: frozen=${d.a} rewrite=${d.b}` : "identical");

let captured = null;
function capture() {
  if (captured) return captured;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (entries.length < CAP) entries.push(mm.clone());
    return oracle(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the run ran short");
  captured = entries;
  return captured;
}

/** A captured machine forced to a given era and head, identically before either side runs. */
function craft(era, head) {
  const m = capture()[0].clone();
  m.mem8[ERA_INDEX] = era;
  m.mem8[RECORD] = head;
  return m;
}

/** Masked memory diff: run oracle and candidate on clones, skip the oracle's own stack window. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  candidate(b);
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** The stack floor the oracle reaches and the SP drift the omitted tail return leaves. */
function spProbe(machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  serviceEra1BomberObject(b);
  return { low, seat, spDiff: a.regs.sp - b.regs.sp };
}

function footprint(machine) {
  const before = machine.dumpState().slice();
  const after = machine.clone();
  oracle(after);
  const now = after.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

// ── broken twins ──────────────────────────────────────────────────────────────────────────

/** BUG: does nothing, so no arm ever runs. */
function brokenNoOp() {}

/** BUG: swaps the two non-empty arms — a live head soaks hits, a hit-soaking head moves. */
function brokenSwapArms(m) {
  const { regs, mem8 } = m;
  if (mem8[ERA_INDEX] !== 1) return;
  regs.ix = RECORD;
  regs.iy = ENTRY;
  const head = mem8[RECORD];
  if (head === 0) return armBomberSlotWhenTimerFires(m);
  regs.a = (head + 1) & 0xff;
  if (head !== 0xff) return flyBomberThenTryAimedShot(m);
  return advanceHitSoakingObjectThenAnimateDeath(m);
}

/** BUG: an empty head runs the move instead of arming the timer. */
function brokenEmptyMoves(m) {
  const { regs, mem8 } = m;
  if (mem8[ERA_INDEX] !== 1) return;
  regs.ix = RECORD;
  regs.iy = ENTRY;
  const head = mem8[RECORD];
  regs.a = (head + 1) & 0xff;
  if (head === 0) return flyBomberThenTryAimedShot(m);
  if (head !== 0xff) return advanceHitSoakingObjectThenAnimateDeath(m);
  return flyBomberThenTryAimedShot(m);
}

/** BUG: dispatches regardless of era, so it moves the object outside era one. */
function brokenNoEraGate(m) {
  const { regs, mem8 } = m;
  regs.ix = RECORD;
  regs.iy = ENTRY;
  const head = mem8[RECORD];
  if (head === 0) return armBomberSlotWhenTimerFires(m);
  regs.a = (head + 1) & 0xff;
  if (head !== 0xff) return advanceHitSoakingObjectThenAnimateDeath(m);
  return flyBomberThenTryAimedShot(m);
}

// ── the gate ──────────────────────────────────────────────────────────────────────────────

test("REAL DISPATCHES: every captured entry under the tape is identical", { skip }, () => {
  const entries = capture();
  assert.ok(entries.length > 0, "vacuous: the tape never dispatched this address");
  for (const e of entries) {
    const d = unitDiff(serviceEra1BomberObject, e);
    assert.equal(d, null, `a real dispatch diverged: ${show(d)}`);
  }
  console.log(`  REAL DISPATCHES: ${entries.length} captured, all identical`);
});

test("HEAD ARMS: each crafted head is identical, and the writing arms actually write",
  { skip }, () => {
    for (const [label, head] of [["live", HEAD_LIVE], ["hit", HEAD_HIT], ["empty", HEAD_EMPTY]]) {
      const d = unitDiff(serviceEra1BomberObject, craft(ACTIVE_ERA, head));
      assert.equal(d, null, `the ${label} arm diverged: ${show(d)}`);
    }
    const live = footprint(craft(ACTIVE_ERA, HEAD_LIVE));
    const hit = footprint(craft(ACTIVE_ERA, HEAD_HIT));
    assert.ok(live > 0 && hit > 0,
      "the live and hit arms move no memory, so these comparisons would pass a no-op rewrite");
    console.log(`  HEAD ARMS: live/hit/empty identical; live moves ${live} bytes, hit ${hit}`);
  });

test("OTHER ERA: outside era one nothing is dispatched", { skip }, () => {
  const m = craft(OTHER_ERA, HEAD_LIVE);
  assert.equal(unitDiff(serviceEra1BomberObject, m), null, "the era gate diverged");
  assert.equal(footprint(m), 0, "the oracle writes memory outside era one, so this arm is wrong");
  console.log("  OTHER ERA: identical, oracle moves 0 bytes");
});

test("SP DRIFT: the omitted tail return is exactly two bytes and the mask sits above data",
  { skip }, () => {
    for (const [label, m] of [
      ["live", craft(ACTIVE_ERA, HEAD_LIVE)],
      ["empty", craft(ACTIVE_ERA, HEAD_EMPTY)],
      ["other-era", craft(OTHER_ERA, HEAD_LIVE)],
    ]) {
      const r = spProbe(m);
      assert.equal(r.spDiff, 2, `the ${label} path no longer omits a two-byte return (${r.spDiff})`);
      // ⚠ an arm that pushes must keep its floor above data, or the mask hides a real write.
      if (r.low < r.seat) assert.ok(r.low > DATA_TOP, `${label} stack window reached into data`);
    }
    console.log("  SP DRIFT: 2 bytes on every path, stack window above data");
  });

test("TEETH: broken twins are caught", { skip }, () => {
  const live = craft(ACTIVE_ERA, HEAD_LIVE);
  const hit = craft(ACTIVE_ERA, HEAD_HIT);
  const empty = craft(ACTIVE_ERA, HEAD_EMPTY);
  assert.ok(unitDiff(brokenNoOp, live), "the no-op twin escaped the live arm");
  assert.ok(unitDiff(brokenSwapArms, hit), "the swapped-arms twin escaped the hit arm");
  assert.ok(unitDiff(brokenSwapArms, live), "the swapped-arms twin escaped the live arm");
  assert.ok(unitDiff(brokenEmptyMoves, empty), "the empty-moves twin escaped the empty arm");
  assert.ok(unitDiff(brokenNoEraGate, craft(OTHER_ERA, HEAD_LIVE)),
    "the no-era-gate twin escaped outside era one");
  // ★ the correct routine must PASS the same entries the twins fail, or catching is vacuous.
  for (const m of [live, hit, empty]) assert.equal(unitDiff(serviceEra1BomberObject, m), null, "serviceEra1BomberObject itself diverged");
  console.log("  TEETH: no-op, swapped-arms, empty-moves, no-era-gate all caught");
});

/** BUG: hands the hit arm the head as it stands, not advanced by one. */
function brokenHeadNotAdvanced(m) {
  const head = m.mem8[RECORD];
  if (m.mem8[ERA_INDEX] !== ACTIVE_ERA || head === HEAD_EMPTY || head === HEAD_LIVE) return serviceEra1BomberObject(m);
  return advanceHitSoakingObjectThenAnimateDeath(m, RECORD, ENTRY, head);
}

/** Heads either side of the hit arm's 0x61 death-animation threshold, hits spent so the head counts on. */
const THRESHOLD_HEADS = [0x5f, 0x60, 0x61, 0x62];

test("HEAD THRESHOLD: the advanced head reaches the hit arm, where its threshold tells", { skip }, () => {
  let caught = 0;
  for (const head of THRESHOLD_HEADS) {
    const m = craft(ACTIVE_ERA, head);
    m.mem8[BOMBER_HITS_TO_ABSORB] = 0;
    assert.equal(unitDiff(serviceEra1BomberObject, m), null, `head ${hex4(head)} diverged`);
    if (unitDiff(brokenHeadNotAdvanced, m)) caught++;
  }
  assert.ok(caught > 0, "a hit arm handed the unadvanced head passed every threshold head");
  console.log(`  HEAD THRESHOLD: ${THRESHOLD_HEADS.length} heads identical; the unadvanced-head twin caught on ${caught}`);
});

// ── the firing arm: the heading reaches the velocity lookup as an argument, not through IX ────

const COUNTDOWN = 0x0e;
const VELOCITY = 0x0a;
/** A stale IX the frame could have left from an earlier service: another bank's record base. */
const STALE_IX = 0xa850;

/** Era one, empty head, the arming countdown about to fire on an even frame with no Mother-Ship. */
function craftFiring(ix = STALE_IX) {
  const m = craft(ACTIVE_ERA, HEAD_EMPTY);
  m.mem8[RECORD + COUNTDOWN] = 1;
  m.mem8[FRAME_TICK] &= 0xfe;
  m.mem8[MOTHER_SHIP_ARMED] = 0;
  m.regs.ix = ix;
  // A heading at the stale base that no facing snaps to (facings are 0x00 or 0x80), on both sides.
  m.mem8[STALE_IX + 2] = 0x40;
  return m;
}

/** BUG: arms correctly, then takes the velocity lookup's heading off the record the IX REGISTER names
 *  rather than the slot's own facing -- the wrong record whenever IX is stale. */
function brokenHeadingFromRegisterRecord(m) {
  const armed = m.mem8[ERA_INDEX] === ACTIVE_ERA && m.mem8[RECORD] === HEAD_EMPTY;
  const r = serviceEra1BomberObject(m);
  if (armed && m.mem8[RECORD] === HEAD_LIVE) {
    const [de, bc] = velocityForHeadingAtSlowestSpeed(m);
    m.mem8[RECORD + VELOCITY] = de & 0xff;
    m.mem8[RECORD + VELOCITY + 1] = de >> 8;
    m.mem8[RECORD + VELOCITY + 2] = bc & 0xff;
    m.mem8[RECORD + VELOCITY + 3] = bc >> 8;
  }
  return r;
}

test("FIRING ARM (regression): arming fires identically with a stale IX; a heading off the register's record is caught", { skip }, () => {
  const m = craftFiring();
  const d = unitDiff(serviceEra1BomberObject, m);
  assert.equal(d, null, `the firing arm diverged under a stale IX: ${show(d)}`);
  const after = m.clone();
  oracle(after);
  assert.equal(after.mem8[RECORD], HEAD_LIVE, "the countdown did not fire, so this is not the arming path");
  assert.notEqual(after.mem16[RECORD + VELOCITY], m.mem16[RECORD + VELOCITY], "arming wrote no velocity");
  const seated = craftFiring(RECORD);
  assert.equal(unitDiff(serviceEra1BomberObject, seated), null, "the firing arm diverged with IX on the record");
  assert.ok(unitDiff(brokenHeadingFromRegisterRecord, craftFiring()),
    "a velocity looked up from the stale record IX names passed, so the firing arm cannot see the wrong record");
  assert.equal(unitDiff(brokenHeadingFromRegisterRecord, seated), null,
    "the wrong-record twin was caught with IX on the right record, so its catch is not the stale record");
  console.log("  FIRING ARM: identical under a stale IX and a seated one; the register-record twin caught only when IX is stale");
});
