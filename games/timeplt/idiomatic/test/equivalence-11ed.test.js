// SPDX-License-Identifier: GPL-3.0-only
/**
 * loseLifeAndHandOver — memory-equivalent to the frozen oracle at ROM 0x11ED.
 *
 * GATE: strict unit-capture at the one real dispatch of the coin -> start tape, compared minus
 *   the stack scratch below the entry SP, plus a crafted cross-product that drives both the lives-zero tail
 *   and the selector/toggle arms the natural run never takes, plus teeth. Each dissolved call —
 *   the sprite hide, the round start, the sound queue and the tail banner — is held load-bearing
 *   by a twin that drops it.
 *
 * HOLE: only one natural dispatch, and it takes the normal path, so the tail, the flag call and
 * the toggle rest entirely on crafted entries. WHAT the callees do is never asserted, only that
 * both sides reach them from an identical machine.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-11ed.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loseLifeAndHandOver } from "../loseLifeAndHandOver.js";
import { enqueueTransitionSoundStops } from "../enqueueTransitionSoundStops.js";
import { hideAllSprites } from "../hideAllSprites.js";
import { startNextRound } from "../startNextRound.js";
import { postGameOverBanner } from "../postGameOverBanner.js";
import { loc_11ed as oracle } from "../../translated/loc_11ed.js";
import manifest from "../../manifest.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x11ed;
const DISPATCHES = 1;

const RECORD = 0xad00;
const SLOT_A = 0xad10;
const SLOT_B = 0xad20;
const SELECTOR = 0xad32;
const RECORD_LEN = 16;
const EVENT_FLAG = 0xacc6;
const STAMP_CELL = 0xa9eb;
const STAMP_VALUE = 90;
const IMAGE_TARGET = 0xa9ac;
const IMAGE_BYTE = 0x4b52;

const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;
const STACK_WINDOW = { lo: STACK_LO, hi: STACK_HI };
const EXCLUDED = ["a", "f", "b", "c", "d", "e", "h", "l", "sp"];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** Stack scratch below the entry SP `floor` is dead; every cell from the floor up is compared. */
const deadStack = (floor) => deadStackBelow(STACK_WINDOW, floor);

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "completed", b: String(e).slice(0, 60) };
  }
  const dead = deadStack(machine.regs.sp);
  return allDiffs(a, b).find((d) => !dead(d.addr)) ?? null;
}

let entry = null;

function replay(candidate) {
  let dispatches = 0;
  let caught = 0;
  const host = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (entry === null) entry = mm.clone();
    const dead = deadStack(mm.regs.sp);
    const b = mm.clone();
    try {
      candidate(b);
    } catch {
      caught++;
      return oracle(mm);
    }
    const r = oracle(mm);
    if (allDiffs(mm, b).some((d) => !dead(d.addr))) caught++;
    return r;
  }]]));
  const frames = host.runFrames(ENTRY_FRAMES);
  assert.equal(host.stoppedBy, null, `session stopped early: ${host.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "session ran short");
  return { dispatches, caught };
}

function entryState() {
  if (entry === null) replay(loseLifeAndHandOver);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  return entry;
}

/** A real captured machine with the four inputs this routine branches on forced. */
function craft({ flag, selector, count, otherHead }) {
  const c = entryState().clone();
  c.mem8[EVENT_FLAG] = flag;
  c.mem8[SELECTOR] = selector;
  c.mem8[RECORD] = count;
  c.mem8[selector === 0 ? SLOT_B : SLOT_A] = otherHead;
  return c;
}

const COMBOS = [];
for (const flag of [0, 1]) {
  for (const count of [1, 2, 3]) {
    for (const selector of [0, 1, 2]) {
      for (const otherHead of [0, 0xff]) COMBOS.push({ flag, count, selector, otherHead });
    }
  }
}
const TAIL_COMBOS = COMBOS.filter((c) => c.count === 1).length;
const NON_TAIL = COMBOS.length - TAIL_COMBOS;
const FLAG_COMBOS = COMBOS.filter((c) => c.flag !== 0).length;

function sweepCaught(candidate) {
  let caught = 0;
  for (const combo of COMBOS) if (unitDiff(candidate, craft(combo))) caught++;
  return caught;
}

// ── twins ─────────────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** ★ BUG: drops the dissolved sprite hide, proving that direct import is load-bearing. */
function brokenNoHide(m) {
  const { mem8 } = m;
  if (mem8[EVENT_FLAG] !== 0) startNextRound(m);
  enqueueTransitionSoundStops(m);
  const count = u8(mem8[RECORD] - 1);
  mem8[RECORD] = count;
  const dest = mem8[SELECTOR] === 0 ? SLOT_A : SLOT_B;
  for (let i = 0; i < RECORD_LEN; i++) mem8[dest + i] = mem8[RECORD + i];
  if (count === 0) return postGameOverBanner(m);
  const other = mem8[SELECTOR] === 0 ? SLOT_B : SLOT_A;
  if (mem8[other] !== 0) mem8[SELECTOR] = (mem8[SELECTOR] + 1) & 1;
  mem8[STAMP_CELL] = STAMP_VALUE;
  mem8[IMAGE_TARGET] = mem8[IMAGE_BYTE];
}

/** ★ BUG: drops the dissolved sound queue call. */
function brokenNoSound(m) {
  const { mem8 } = m;
  hideAllSprites(m);
  if (mem8[EVENT_FLAG] !== 0) startNextRound(m);
  const count = u8(mem8[RECORD] - 1);
  mem8[RECORD] = count;
  const dest = mem8[SELECTOR] === 0 ? SLOT_A : SLOT_B;
  for (let i = 0; i < RECORD_LEN; i++) mem8[dest + i] = mem8[RECORD + i];
  if (count === 0) return postGameOverBanner(m);
  const other = mem8[SELECTOR] === 0 ? SLOT_B : SLOT_A;
  if (mem8[other] !== 0) mem8[SELECTOR] = (mem8[SELECTOR] + 1) & 1;
  mem8[STAMP_CELL] = STAMP_VALUE;
  mem8[IMAGE_TARGET] = mem8[IMAGE_BYTE];
}

/** BUG: never decrements the lives count, so the head byte and its copy are one too high. */
function brokenNoDecrement(m) {
  const { mem8 } = m;
  hideAllSprites(m);
  if (mem8[EVENT_FLAG] !== 0) startNextRound(m);
  enqueueTransitionSoundStops(m);
  const count = u8(mem8[RECORD] - 1);
  const dest = mem8[SELECTOR] === 0 ? SLOT_A : SLOT_B;
  for (let i = 0; i < RECORD_LEN; i++) mem8[dest + i] = mem8[RECORD + i];
  if (count === 0) return postGameOverBanner(m);
  const other = mem8[SELECTOR] === 0 ? SLOT_B : SLOT_A;
  if (mem8[other] !== 0) mem8[SELECTOR] = (mem8[SELECTOR] + 1) & 1;
  mem8[STAMP_CELL] = STAMP_VALUE;
  mem8[IMAGE_TARGET] = mem8[IMAGE_BYTE];
}

/** BUG: copies the record into the other slot, so the live slot is left stale. */
function brokenWrongSlot(m) {
  const { mem8 } = m;
  hideAllSprites(m);
  if (mem8[EVENT_FLAG] !== 0) startNextRound(m);
  enqueueTransitionSoundStops(m);
  const count = u8(mem8[RECORD] - 1);
  mem8[RECORD] = count;
  const dest = mem8[SELECTOR] === 0 ? SLOT_B : SLOT_A;
  for (let i = 0; i < RECORD_LEN; i++) mem8[dest + i] = mem8[RECORD + i];
  if (count === 0) return postGameOverBanner(m);
  const other = mem8[SELECTOR] === 0 ? SLOT_B : SLOT_A;
  if (mem8[other] !== 0) mem8[SELECTOR] = (mem8[SELECTOR] + 1) & 1;
  mem8[STAMP_CELL] = STAMP_VALUE;
  mem8[IMAGE_TARGET] = mem8[IMAGE_BYTE];
}

/** BUG: never stamps the two fixed cells. Invisible on the tail, which skips them anyway. */
function brokenNoStamp(m) {
  const { mem8 } = m;
  hideAllSprites(m);
  if (mem8[EVENT_FLAG] !== 0) startNextRound(m);
  enqueueTransitionSoundStops(m);
  const count = u8(mem8[RECORD] - 1);
  mem8[RECORD] = count;
  const dest = mem8[SELECTOR] === 0 ? SLOT_A : SLOT_B;
  for (let i = 0; i < RECORD_LEN; i++) mem8[dest + i] = mem8[RECORD + i];
  if (count === 0) return postGameOverBanner(m);
  const other = mem8[SELECTOR] === 0 ? SLOT_B : SLOT_A;
  if (mem8[other] !== 0) mem8[SELECTOR] = (mem8[SELECTOR] + 1) & 1;
}

/** BUG: never advances the selector, so an armed idle slot is never promoted. */
function brokenNoToggle(m) {
  const { mem8 } = m;
  hideAllSprites(m);
  if (mem8[EVENT_FLAG] !== 0) startNextRound(m);
  enqueueTransitionSoundStops(m);
  const count = u8(mem8[RECORD] - 1);
  mem8[RECORD] = count;
  const dest = mem8[SELECTOR] === 0 ? SLOT_A : SLOT_B;
  for (let i = 0; i < RECORD_LEN; i++) mem8[dest + i] = mem8[RECORD + i];
  if (count === 0) return postGameOverBanner(m);
  mem8[STAMP_CELL] = STAMP_VALUE;
  mem8[IMAGE_TARGET] = mem8[IMAGE_BYTE];
}

/** ★ BUG: stamps instead of handing off, so the game-over banner is never reached. */
function brokenSkipTail(m) {
  const { mem8 } = m;
  hideAllSprites(m);
  if (mem8[EVENT_FLAG] !== 0) startNextRound(m);
  enqueueTransitionSoundStops(m);
  const count = u8(mem8[RECORD] - 1);
  mem8[RECORD] = count;
  const dest = mem8[SELECTOR] === 0 ? SLOT_A : SLOT_B;
  for (let i = 0; i < RECORD_LEN; i++) mem8[dest + i] = mem8[RECORD + i];
  const other = mem8[SELECTOR] === 0 ? SLOT_B : SLOT_A;
  if (mem8[other] !== 0) mem8[SELECTOR] = (mem8[SELECTOR] + 1) & 1;
  mem8[STAMP_CELL] = STAMP_VALUE;
  mem8[IMAGE_TARGET] = mem8[IMAGE_BYTE];
}

/** ★ BUG: omits the flag-gated round start, so the flag arm goes nowhere. */
function brokenNoEventCall(m) {
  const { mem8 } = m;
  hideAllSprites(m);
  enqueueTransitionSoundStops(m);
  const count = u8(mem8[RECORD] - 1);
  mem8[RECORD] = count;
  const dest = mem8[SELECTOR] === 0 ? SLOT_A : SLOT_B;
  for (let i = 0; i < RECORD_LEN; i++) mem8[dest + i] = mem8[RECORD + i];
  if (count === 0) return postGameOverBanner(m);
  const other = mem8[SELECTOR] === 0 ? SLOT_B : SLOT_A;
  if (mem8[other] !== 0) mem8[SELECTOR] = (mem8[SELECTOR] + 1) & 1;
  mem8[STAMP_CELL] = STAMP_VALUE;
  mem8[IMAGE_TARGET] = mem8[IMAGE_BYTE];
}

const TWINS = [
  ["no-op", brokenNoOp, COMBOS.length],
  ["no-hide", brokenNoHide, COMBOS.length],
  ["no-sound", brokenNoSound, COMBOS.length],
  ["no-decrement", brokenNoDecrement, COMBOS.length],
  ["wrong-slot", brokenWrongSlot, COMBOS.length],
  ["no-stamp", brokenNoStamp, NON_TAIL],
  ["no-toggle", brokenNoToggle, TAIL_COMBOS],
  ["skip-tail", brokenSkipTail, TAIL_COMBOS],
  ["no-event-call", brokenNoEventCall, FLAG_COMBOS],
];

// ── the gate ──────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: loseLifeAndHandOver == oracle minus stack scratch below the entry SP", { skip }, () => {
  const r = replay(loseLifeAndHandOver);
  assert.equal(r.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(r.caught, 0, "the rewrite diverged at the real dispatch");
  console.log(`  EQUAL: ${r.dispatches} dispatch, sp=${hex4(entryState().regs.sp)}`);
});

test("CRAFTED EQUAL: every branch combination behaves as the oracle", { skip }, () => {
  assert.equal(sweepCaught(loseLifeAndHandOver), 0, "the rewrite diverged in the crafted space");
  console.log(`  CRAFTED: ${COMBOS.length} combos identical (${TAIL_COMBOS} take the tail)`);
});

test("NOT VACUOUS: a no-op candidate FAILS on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft({ flag: 0, selector: 0, count: 2, otherHead: 0 }));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell, not in the stack scratch");
  console.log(`  NOT VACUOUS: ${show(d)}`);
});

test("TAIL: a zero lives count hands off, and a twin that skips the tail is caught", { skip }, () => {
  const tail = craft({ flag: 0, selector: 0, count: 1, otherHead: 0 });
  assert.equal(unitDiff(loseLifeAndHandOver, tail), null, "the tail path diverged from the oracle");
  assert.notEqual(unitDiff(brokenSkipTail, tail), null, "the tail branch was never exercised");
  console.log("  TAIL: hand-off matches the oracle and the skip-tail twin is caught");
});

test("EXCLUDED, deliberately: the register-diff set is pinned, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loseLifeAndHandOver(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    EXCLUDED,
    "the register-diff set changed shape",
  );
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")}`);
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of combos`, { skip }, () => {
    assert.equal(sweepCaught(twin), expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${expected} of ${COMBOS.length} combos`);
  });
}
