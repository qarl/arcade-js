// SPDX-License-Identifier: GPL-3.0-only
/**
 * awardCoinCreditThenPulseCoinCounter — memory-equivalent to the frozen oracle at ROM 0x496E.
 * GATE: crafted entries off a real captured state (this address is never dispatched by either tape,
 *   with its callers as the live positive control). RAM compared with the dead stack scratch below
 *   the seated SP masked out (the oracle pushes and rets, the rewrite does neither), the SP re-seat
 *   and the return checked, and the latched counter line at 0xC30A compared as an ordered device
 *   write since it is not in the RAM dump. Registers are not compared: the dissolved callees do not
 *   reproduce the register dance and no caller consumes one. Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-496e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { awardCoinCreditThenPulseCoinCounter as candidate } from "../awardCoinCreditThenPulseCoinCounter.js";
import { loc_496e as oracle } from "../../translated/loc_496e.js";
import { loc_4984 as tailOracle } from "../../translated/loc_4984.js";
import { paintCreditCountPanel } from "../paintCreditCountPanel.js";
import { pulseSlot1CoinCounter } from "../pulseSlot1CoinCounter.js";
import { recordHardwareWrites } from "./_spineSever.js";

const TARGET = 0x496e;
const CALLERS = [0x48e7, 0x4911];
const TAIL = 0x4984;

const FREE_PLAY = 0xa9c0;
const CREDIT_COUNT = 0xa986;
const COIN_COUNTER_PULSES_OWED = 0xa981;
const COIN_PULSE_TIMER = 0xa984;
const COUNTER_LINE = 0xc30a;
const SATURATED = 0x99;

// Every game cell sits at or below here; the stack seats far above it, so masking the scratch
// window can never hide a real divergence. Asserted against the measured floor.
const DATA_TOP = 0xadff;
const SCRATCH_MAX = 10;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${d.addr == null ? "device/return" : hex4(d.addr)}: oracle=${d.o} rewrite=${d.c}` : "identical");

// ── the masked comparison ──────────────────────────────────────────────────────────────────

const lineWrites = (m) => (m.hardwareWrites || []).filter((w) => w.addr === COUNTER_LINE).map((w) => w.value).join(",");

/**
 * Oracle vs candidate on independent clones. lowestSp is watched off the oracle's own pushes and
 * [lowestSp, seat) excluded; anything outside has escaped. The latched line is compared as an
 * ordered sequence, and both the SP drift and the return value are carried back.
 */
function compare(cand, machine) {
  const seat = machine.regs.sp;
  const a = machine.clone();
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  a.hardwareWrites = recordHardwareWrites(a);
  const retO = oracle(a);
  const droveO = lineWrites(a);
  const b = machine.clone();
  b.hardwareWrites = recordHardwareWrites(b);
  let retC, threw = null;
  try { retC = cand(b); } catch (e) { threw = String(e).slice(0, 40); }
  const droveC = lineWrites(b);
  if (threw) return { escaped: { addr: null, o: "returned", c: threw }, low, seat, spDiff: null };
  const da = a.dumpState(), db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, o: da[i], c: db[i] };
  }
  if (!escaped && droveO !== droveC) escaped = { addr: null, o: droveO || "none", c: droveC || "none" };
  if (!escaped && retO !== retC) escaped = { addr: null, o: retO, c: retC };
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, droveO };
}

/** Cells the oracle moves outside the scratch window — a path's real footprint. */
function footprint(machine) {
  const a = machine.clone();
  const before = a.dumpState().slice();
  oracle(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i] && a.stateOffsetToAddr(i) <= DATA_TOP) n++;
  return n;
}

// ── the captured base, and the two crafted crosses ──────────────────────────────────────────

let base = null;
function baseState() {
  if (base === null) {
    const m = makeMachine(new Map([[TAIL, (mm) => { if (base === null) base = mm.clone(); return tailOracle(mm); }]]));
    m.runFrames(ENTRY_FRAMES);
  }
  return base;
}

function craft(mutate) {
  const m = baseState().clone();
  mutate(m);
  return m;
}

/** The crediting path: not free play, so C's low digit folds into the credit count and repaints. */
const C_VALUES = [0x00, 0x01, 0x09, 0x0a, 0x0f, 0x10, 0x19, 0x90, 0xff];
function creditCross() {
  const out = [];
  for (let count = 0; count < 256; count++) {
    for (const c of C_VALUES) out.push(craft((m) => { m.mem8[FREE_PLAY] = 0; m.mem8[CREDIT_COUNT] = count; m.regs.c = c; }));
  }
  return out;
}

/** Free play, so only the coin-counter pulse runs; sweeps the pulse across its arms. */
const TIMERS = [0, 1, 24, 25, 48, 100];
const ACCEPTED = [0, 1, 2, 255];
function skipCross() {
  const out = [];
  for (const t of TIMERS) for (const ac of ACCEPTED) {
    out.push(craft((m) => { m.mem8[FREE_PLAY] = 1; m.mem8[COIN_PULSE_TIMER] = t; m.mem8[COIN_COUNTER_PULSES_OWED] = ac; }));
  }
  return out;
}

// ── the twins ───────────────────────────────────────────────────────────────────────────────

const brokenNoOp = () => {};

/** BUG: credits even in free play, where no coin was paid for. */
function brokenAlwaysCredits(m) {
  const { regs, mem8 } = m;
  regs.a = regs.c & 0x0f; regs.add(mem8[CREDIT_COUNT]); regs.daa();
  mem8[CREDIT_COUNT] = regs.fNC ? regs.a : SATURATED;
  paintCreditCountPanel(m);
  return pulseSlot1CoinCounter(m);
}

/** BUG: no saturation, so the count rolls past 99. */
function brokenNoClamp(m) {
  const { regs, mem8 } = m;
  if (mem8[FREE_PLAY] === 0) { regs.a = regs.c & 0x0f; regs.add(mem8[CREDIT_COUNT]); regs.daa(); mem8[CREDIT_COUNT] = regs.a; paintCreditCountPanel(m); }
  return pulseSlot1CoinCounter(m);
}

/** BUG: folds the whole C byte, not just its low digit. */
function brokenFullCByte(m) {
  const { regs, mem8 } = m;
  if (mem8[FREE_PLAY] === 0) { regs.a = regs.c; regs.add(mem8[CREDIT_COUNT]); regs.daa(); mem8[CREDIT_COUNT] = regs.fNC ? regs.a : SATURATED; paintCreditCountPanel(m); }
  return pulseSlot1CoinCounter(m);
}

/** BUG: updates the count but never repaints the field. */
function brokenSkipRepaint(m) {
  const { regs, mem8 } = m;
  if (mem8[FREE_PLAY] === 0) { regs.a = regs.c & 0x0f; regs.add(mem8[CREDIT_COUNT]); regs.daa(); mem8[CREDIT_COUNT] = regs.fNC ? regs.a : SATURATED; }
  return pulseSlot1CoinCounter(m);
}

/** BUG: skips the coin-counter pulse. */
function brokenSkipPulse(m) {
  const { regs, mem8 } = m;
  if (mem8[FREE_PLAY] === 0) { regs.a = regs.c & 0x0f; regs.add(mem8[CREDIT_COUNT]); regs.daa(); mem8[CREDIT_COUNT] = regs.fNC ? regs.a : SATURATED; paintCreditCountPanel(m); }
}

/** [name, twin, caught-on-credit-cross, caught-on-skip-cross]. */
const TWINS = [
  ["no-op", brokenNoOp, 2304, 18],
  ["always-credits", brokenAlwaysCredits, 0, 24],
  ["no-clamp", brokenNoClamp, 977, 0],
  ["full-c-byte", brokenFullCByte, 587, 0],
  ["skip-repaint", brokenSkipRepaint, 2304, 0],
  ["skip-pulse", brokenSkipPulse, 0, 18],
];

const caughtOver = (twin, cross) => cross.filter((m) => compare(twin, m).escaped).length;

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("UNREACHED: neither tape dispatches this address, with its callers as a live control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["attract", { tape: [] }]]) {
    const seen = { [TARGET]: 0, [CALLERS[0]]: 0, [CALLERS[1]]: 0 };
    const ov = new Map();
    for (const a of Object.keys(seen).map(Number)) { const real = TRANSLATED.get(a); ov.set(a, (mm) => { seen[a]++; return real(mm); }); }
    const m = makeMachine(ov, opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // A zero at the target means nothing unless the same taps saw its callers fire.
    assert.ok(seen[CALLERS[0]] > 0 && seen[CALLERS[1]] > 0, `${label}: the caller taps never fired, so the zero below is meaningless`);
    assert.equal(seen[TARGET], 0, `${label} now dispatches this address, so capture plain entries instead of crafting them`);
    console.log(`  UNREACHED: ${label} — ${hex4(TARGET)} ${seen[TARGET]}, callers ${seen[CALLERS[0]]}/${seen[CALLERS[1]]}`);
  }
});

test("NOT VACUOUS: a no-op candidate FAILS on a real cell", { skip }, () => {
  const d = compare(brokenNoOp, creditCross()[81]).escaped;
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell, not on a device write alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("CREDITING: the whole crediting cross is equivalent, and it really credits", { skip }, () => {
  const cross = creditCross();
  let moved = 0, saturated = 0;
  for (const m of cross) {
    const d = compare(candidate, m).escaped;
    assert.equal(d, null, `a crediting entry diverged: ${show(d)}`);
    if (footprint(m) > 0) moved++;
    const after = m.clone(); oracle(after);
    if (after.mem8[CREDIT_COUNT] === SATURATED) saturated++;
  }
  assert.ok(moved > 0, "vacuous: no crediting entry moved a byte");
  assert.ok(saturated > 0, "the saturation arm was never reached, so the clamp is untested");
  console.log(`  CREDITING: ${cross.length} entries identical, ${moved} moved bytes, ${saturated} saturated at 99`);
});

test("FREE PLAY / PULSE: the skip cross is equivalent, and the latched line is driven", { skip }, () => {
  const cross = skipCross();
  let driven = 0;
  for (const m of cross) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `a free-play entry diverged: ${show(r.escaped)}`);
    if (r.droveO) driven++;
  }
  assert.ok(driven > 0, "vacuous: no free-play entry drove the counter line, so the line arm is blind");
  console.log(`  FREE PLAY: ${cross.length} entries identical, counter line driven on ${driven}`);
});

test("WINDOW: the oracle's deepest push is measured and its floor sits above game data", { skip }, () => {
  let deepest = 0;
  for (const m of creditCross()) { const r = compare(candidate, m); deepest = Math.max(deepest, r.seat - r.low); assert.ok(r.low > DATA_TOP, `the mask floor ${hex4(r.low)} reached into game data`); }
  assert.equal(deepest, SCRATCH_MAX, "the oracle's stack footprint moved, so the masked window is wrong");
  console.log(`  WINDOW: the oracle reaches ${deepest} bytes below its seat, floor above ${hex4(DATA_TOP)}`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return the same", { skip }, () => {
  for (const m of [...creditCross().slice(0, 32), ...skipCross()]) {
    const r = compare(candidate, m);
    assert.equal(r.spDiff, 2, "the oracle pops a return address and the rewrite does not");
  }
  console.log("  SP: +2 on every path; returns identical (checked in compare)");
});

for (const [label, twin, onCredit, onSkip] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count`, { skip }, () => {
    const credit = caughtOver(twin, creditCross());
    const skipC = caughtOver(twin, skipCross());
    assert.ok(credit + skipC > 0, `every cross PASSED the ${label} twin`);
    assert.equal(credit, onCredit, `the ${label} twin's crediting catch count moved`);
    assert.equal(skipC, onSkip, `the ${label} twin's free-play catch count moved`);
    console.log(`  TEETH/${label}: caught ${credit}/${creditCross().length} crediting, ${skipC}/${skipCross().length} free-play`);
  });
}
