// SPDX-License-Identifier: GPL-3.0-only
/**
 * steerEra4CraftTowardAimHeadingThenFly — memory-equivalent to the frozen oracle at ROM 0x29F7.
 * GATE: crafted entries plus a poked corpus; RAM compared with the dead stack scratch below the
 *   seated SP masked out (the oracle's tail pops a return address this rewrite dissolved away), the
 *   +2 SP drift and the return value asserted, registers not compared. Neither tape reaches the
 *   era-4 arm that dispatches this, so the corpus pins the era index and lets the ROM reach it.
 *   Run: node --test games/timeplt/idiomatic/test/equivalence-29f7.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { steerEra4CraftTowardAimHeadingThenFly as candidate } from "../steerEra4CraftTowardAimHeadingThenFly.js";
import { loc_29f7 as oracle } from "../../translated/loc_29f7.js";
import { steerTowardAimHeading } from "../steerTowardAimHeading.js";
import { loc_58aa } from "../loc_58aa.js";
import { flyAtSecondFastestSpeed } from "../flyAtSecondFastestSpeed.js";
import { ERA_INDEX, FRAME_TICK } from "../names.js";

const TARGET = 0x29f7;
const CALLER = 0x29d5;
const DISPATCHER = 0x290e;
const PROBE = 49;
const IN_BAND = 120;
const OUT_OF_BAND = 0;
const OFF_ERA = 12;
const DATA_TOP = 0xadff;
const POKE_FROM = 600;
const POKED_DISPATCHES = 1792;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/**
 * Oracle vs a candidate on independent clones. The oracle's tail pops the caller's return address
 * and its inner call leaves dead scratch below the seat, so the diff excludes [low, seat) — low
 * measured by watching the oracle's own pushes. Anything outside that window has escaped.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => {
    push(v);
    if (a.regs.sp < low) low = a.regs.sp;
  };
  const retOracle = oracle(a);
  const retCand = cand(b);
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, retOracle, retCand };
}

/** Cells at or below the data ceiling the oracle moves from a state — a path's footprint. */
function footprint(machine) {
  const a = machine.clone();
  const before = a.dumpState().slice();
  oracle(a);
  const now = a.dumpState();
  const cells = [];
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && addr <= DATA_TOP) cells.push(addr);
  }
  return cells;
}

// ── the poked corpus and the crafted branch entries ───────────────────────────────────────

let poked = null;
function capturePoked() {
  if (poked) return poked;
  const entries = [];
  let collecting = true;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (collecting) entries.push(mm.clone());
    return oracle(mm);
  }]]));
  m.pokes = [{ frame: POKE_FROM, addr: ERA_INDEX, val: 4 }];
  const frames = m.runFrames(ENTRY_FRAMES);
  collecting = false;
  assert.equal(m.stoppedBy, null, `the poked run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the poked run ran short");
  poked = entries;
  return poked;
}

function craft(mutate) {
  const m = capturePoked()[0].clone();
  mutate(m);
  return m;
}

/** The probe forced in and out of the window, each with both tail bits; the era set off four so the
 * in-band reseat to four is observable. */
function scenarios() {
  const at = (probe, tick) => (m) => {
    m.mem8[ERA_INDEX] = OFF_ERA;
    m.mem8[m.regs.iy + PROBE] = probe;
    m.mem8[FRAME_TICK] = tick;
  };
  return [
    ["hit-a", craft(at(IN_BAND, 0))],
    ["hit-b", craft(at(IN_BAND, 2))],
    ["miss-a", craft(at(OUT_OF_BAND, 0))],
    ["miss-b", craft(at(OUT_OF_BAND, 2))],
  ];
}

// ── the twins ───────────────────────────────────────────────────────────────────────────────

const within = (m) => {
  const probe = m.mem8[m.regs.iy + PROBE];
  return [120, 132].some((ref) => ((ref - probe + 72) & 0xff) < 144);
};
const chooseTail = (m) => (((m.mem8[FRAME_TICK] >> 1) & 1) === 0 ? loc_58aa(m) : flyAtSecondFastestSpeed(m));

/** BUG: does nothing. */
function brokenNoOp() {}
/** BUG: never forces the rate index low nor reseats it, so the in-band turn and the reseat are lost. */
function brokenSkipWindow(m) {
  steerTowardAimHeading(m);
  return chooseTail(m);
}
/** BUG: swaps the two movers, so every step takes the wrong velocity table. */
function brokenWrongTail(m) {
  if (within(m)) {
    m.mem8[ERA_INDEX] = 0;
    steerTowardAimHeading(m);
    m.mem8[ERA_INDEX] = 4;
  } else steerTowardAimHeading(m);
  return ((m.mem8[FRAME_TICK] >> 1) & 1) === 0 ? flyAtSecondFastestSpeed(m) : loc_58aa(m);
}
/** BUG: forces the rate index low for the turn but never reseats it to four. */
function brokenNoReseat(m) {
  if (within(m)) {
    m.mem8[ERA_INDEX] = 0;
    steerTowardAimHeading(m);
  } else steerTowardAimHeading(m);
  return chooseTail(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 4],
  ["skip-window", brokenSkipWindow, 2],
  ["wrong-tail", brokenWrongTail, 4],
  ["no-reseat", brokenNoReseat, 2],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("UNREACHED: neither tape dispatches this, with a live control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["attract", { tape: [] }]]) {
    const seen = { [TARGET]: 0, [CALLER]: 0, [DISPATCHER]: 0 };
    const realCaller = TRANSLATED.get(CALLER);
    const realDispatcher = TRANSLATED.get(DISPATCHER);
    const m = makeMachine(new Map([
      [TARGET, (mm) => { seen[TARGET]++; return oracle(mm); }],
      [CALLER, (mm) => { seen[CALLER]++; return realCaller(mm); }],
      [DISPATCHER, (mm) => { seen[DISPATCHER]++; return realDispatcher(mm); }],
    ]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // The zero is evidence only because the dispatcher — the same tap, the same run — fired.
    assert.ok(seen[DISPATCHER] > 0, `${label}: the dispatcher never ran, so the tap is dead`);
    assert.equal(seen[TARGET], 0, `${label} now dispatches this; the corpus should capture plain entries`);
    assert.equal(seen[CALLER], 0, `${label} now reaches the era-4 arm; the account above is stale`);
    console.log(`  UNREACHED: ${label} — target ${seen[TARGET]}, arm ${seen[CALLER]}, control ${seen[DISPATCHER]}`);
  }
});

test("POKED: every dispatch is memory-equivalent outside the masked stack scratch", { skip }, () => {
  const entries = capturePoked();
  assert.equal(entries.length, POKED_DISPATCHES, "the poked dispatch count moved");
  let touched = 0;
  for (const e of entries) {
    const r = compare(candidate, e);
    assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
    // ★ The mask is safe only if it never covers a data cell: prove its floor sits above them all.
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached into game data`);
    if (footprint(e).length > 0) touched++;
  }
  assert.ok(touched > 0, "no poked dispatch moved a cell, so a do-nothing rewrite would pass");
  console.log(`  POKED: ${entries.length} dispatches identical, ${touched} moved cells`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return the same", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.spDiff, 2, `${label}: the oracle pops the tail's return address and the rewrite does not`);
    assert.equal(r.retOracle, r.retCand, `${label}: the return value diverged`);
  }
  console.log("  SP: +2 on every path; return values identical");
});

test("PATHS: the in-band arm and the out-of-band arm move different cells", { skip }, () => {
  const prints = {};
  for (const [label, m] of scenarios()) {
    assert.equal(compare(candidate, m).escaped, null, `${label} escaped`);
    prints[label] = footprint(m).map(hex4).join(",");
  }
  // ★ Vacuity guard: the in-band path reseats the era index and the out-of-band path leaves it.
  assert.notEqual(prints["hit-a"], prints["miss-a"], "the two paths move the same cells");
  console.log(`  PATHS: hit moves ${prints["hit-a"].split(",").length} cells, miss ${prints["miss-a"].split(",").length}`);
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count`, { skip }, () => {
    let caught = 0;
    for (const [, m] of scenarios()) if (compare(twin, m).escaped) caught++;
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${scenarios().length} scenarios`);
  });
}
