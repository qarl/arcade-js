// SPDX-License-Identifier: GPL-3.0-only
/**
 * dispatchEra4CollisionByFrameParity — memory-equivalent to the frozen oracle at ROM 0x4F2A. A pure leaf: every ROM call
 * dissolves into a direct import, so the rewrite pushes no return address and omits its own ret.
 * UNREACHED by both tapes (the era index never reaches four in the budget), so the corpus is a
 * poked dispatch with the caller as the live control; RAM is compared with the dead stack scratch
 * below the seated SP masked out, the +2 re-seat and the return checked, registers not compared.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4f2a.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { dispatchEra4CollisionByFrameParity as candidate } from "../dispatchEra4CollisionByFrameParity.js";
import { loc_4f2a as oracle } from "../../translated/loc_4f2a.js";
import { loc_4e4f as caller } from "../../translated/loc_4e4f.js";
import { runAllCollisionSweepsThisFrame } from "../runAllCollisionSweepsThisFrame.js";
import { destroyTargetsHitByShots } from "../destroyTargetsHitByShots.js";
import { markMotherShipAndShotHitByShots } from "../markMotherShipAndShotHitByShots.js";

const TARGET = 0x4f2a;
const CALLER = 0x4e4f;
const ERA_INDEX = 0xad04;
const FRAME_TICK = 0xa980;
const MOTHER_SHIP_ARMED = 0xad0d;
const MOTHER_SHIP_STATE = 0xa8a0;
const SHOT_SLOTS = 0xaa80;
const TARGET_RECORDS = 0xa810;
const TARGET_ENTRIES = 0xaa12;
const ROAMER_FIRST = 0xaa24;
const ROAMER_SECOND = 0xaa55;

// Every path's game write lands at or below here; the stack seats far above it, so masking the
// scratch window can never hide a data divergence. Asserted against the measured floor below.
const DATA_TOP = 0xadff;
const POKE_FROM = 600;
const ERA_FOUR = 4;
const CORPUS_DISPATCHES = 448;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/** Oracle vs a candidate on independent clones; the diff excludes [low, seat) — the dead
 * return-address scratch the oracle brackets its armed call with — low watched off the oracle's
 * own pushes. Anything outside that window has escaped. */
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
  const retO = oracle(a);
  const retC = cand(b);
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, retO, retC };
}

/** Game cells the oracle moves from a state, ignoring the stack scratch — one arm's footprint. */
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
  return cells.map(hex4).join(",");
}

// ── the poked corpus and crafted arms ─────────────────────────────────────────────────────

let corpus = null;
function captureCorpus() {
  if (corpus) return corpus;
  const arr = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    arr.push(mm.clone());
    return oracle(mm);
  }]]), {});
  m.pokes = [{ frame: POKE_FROM, addr: ERA_INDEX, val: ERA_FOUR }];
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the poked run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the poked run ran short");
  corpus = arr;
  return corpus;
}

const oddBase = () => captureCorpus().find((e) => e.mem8[FRAME_TICK] & 1);
const evenBase = () => captureCorpus().find((e) => !(e.mem8[FRAME_TICK] & 1));

function seatOneShot(m, first, second) {
  for (let k = 0; k < 6; k++) m.mem8[SHOT_SLOTS + k * 0x10] = 0;
  m.mem8[SHOT_SLOTS] = 0xff;
  m.mem8[SHOT_SLOTS + 6] = first;
  m.mem8[SHOT_SLOTS + 4] = second;
}
function blankTargetRun(m) {
  for (let k = 0; k < 11; k++) m.mem8[(TARGET_RECORDS + k * 0x10) & 0xffff] = 0;
}

/** Odd, mother ship clear: the eleven-long run and one live target the sole shot reaches. */
function craftOddOpenKill() {
  const m = oddBase().clone();
  m.mem8[MOTHER_SHIP_ARMED] = 0;
  seatOneShot(m, 0x64, 0x64);
  blankTargetRun(m);
  m.mem8[TARGET_RECORDS] = 0xff;
  m.mem8[TARGET_ENTRIES] = 0x64;
  m.mem8[TARGET_ENTRIES + 49] = 0x64;
  return m;
}

/** Odd, mother ship armed: a shot-vs-target kill AND a slot the following mother-ship pass reaches. */
function craftOddArmedKill() {
  const m = craftOddOpenKill();
  m.mem8[MOTHER_SHIP_ARMED] = 1;
  m.mem8[MOTHER_SHIP_STATE] = 0xff;
  m.mem8[SHOT_SLOTS + 0x10] = 0xff;
  m.mem8[SHOT_SLOTS + 0x10 + 6] = m.mem8[ROAMER_FIRST];
  m.mem8[SHOT_SLOTS + 0x10 + 4] = m.mem8[ROAMER_SECOND];
  return m;
}

/** Odd, clear, with only the eleventh target live: the nine-long run cannot reach it, eleven can. */
function craftOddOpenFar() {
  const m = oddBase().clone();
  m.mem8[MOTHER_SHIP_ARMED] = 0;
  seatOneShot(m, 0x64, 0x64);
  blankTargetRun(m);
  const rec = (TARGET_RECORDS + 10 * 0x10) & 0xffff;
  const ent = TARGET_ENTRIES + 10 * 2;
  m.mem8[rec] = 0xff;
  m.mem8[ent] = 0x64;
  m.mem8[ent + 49] = 0x64;
  return m;
}

const scenarios = () => [
  ["even", evenBase()],
  ["odd-open", oddBase()],
  ["odd-open-kill", craftOddOpenKill()],
  ["odd-armed-kill", craftOddArmedKill()],
  ["odd-open-far", craftOddOpenFar()],
];

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite's odd arm, each option a deliberate defect; defaults match dispatchEra4CollisionByFrameParity. */
function oddArm(m, { count = null, skipCursors = false, seat = null, skipArmed = false } = {}) {
  const { regs, mem8, mem16 } = m;
  const armed = mem8[MOTHER_SHIP_ARMED] !== 0;
  const targets = count === null ? (armed ? 9 : 11) : count;
  regs.de = TARGET_RECORDS;
  regs.iy = TARGET_ENTRIES;
  regs.ix = SHOT_SLOTS;
  regs.a_ = targets;
  regs.b = targets;
  regs.c = 6;
  if (!skipCursors) {
    mem16[0xa993] = seat === null ? TARGET_RECORDS : seat;
    mem16[0xa991] = seat === null ? TARGET_ENTRIES : seat;
  }
  regs.l = 7;
  regs.h = 0x0f;
  if (armed && !skipArmed) {
    destroyTargetsHitByShots(m);
    return markMotherShipAndShotHitByShots(m);
  }
  return destroyTargetsHitByShots(m);
}
const full = (opts) => (m) =>
  (m.mem8[FRAME_TICK] & 1) === 0 ? runAllCollisionSweepsThisFrame(m) : oddArm(m, opts);

const ODD = ["odd-open", "odd-open-kill", "odd-armed-kill", "odd-open-far"];
const TWINS = [
  ["no-op", () => {}, ["even", ...ODD]],
  ["always-even", (m) => runAllCollisionSweepsThisFrame(m), ODD],
  ["always-odd", (m) => oddArm(m), ["even"]],
  ["skip-cursors", full({ skipCursors: true }), ODD],
  ["wrong-seat", full({ seat: 0x0000 }), ODD],
  ["skip-armed-pass", full({ skipArmed: true }), ["odd-armed-kill"]],
  ["short-run", full({ count: 9 }), ["odd-open-far"]],
];

// ── the gate ──────────────────────────────────────────────────────────────────────────────

test("UNREACHED: neither tape dispatches this address, with the caller as a live control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["attract", { tape: [] }]]) {
    let target = 0;
    let reachedCaller = 0;
    const m = makeMachine(new Map([
      [TARGET, (mm) => { target++; return oracle(mm); }],
      [CALLER, (mm) => { reachedCaller++; return caller(mm); }],
    ]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    assert.equal(target, 0, `${label} now reaches this address in the budget; capture plain entries`);
    // ★ The zero is a fact only because the SAME run reached the caller, which simply does not take
    // its era-four branch here until deeper into a real game.
    assert.ok(reachedCaller > 0, `${label} never ran the caller, so the zero above proves nothing`);
    console.log(`  UNREACHED: ${label} — target ${target}, caller ${reachedCaller}`);
  }
});

test("POKED DISPATCH: the era forced to four, and the ROM reaches the address itself", { skip }, () => {
  const entries = captureCorpus();
  assert.equal(entries.length, CORPUS_DISPATCHES, "the poked dispatch count moved");
  let writing = 0;
  for (const e of entries) {
    const r = compare(candidate, e);
    assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
    assert.equal(r.spDiff, 2, "the oracle pops a return the rewrite does not");
    assert.equal(r.retO, r.retC, "the return value diverged");
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
    if (footprint(e) !== "") writing++;
  }
  // ★ The comparisons are worth nothing if the oracle writes nothing on every one of them.
  assert.ok(writing > 0, "no poked dispatch makes the oracle write a byte");
  console.log(`  POKED: ${entries.length} dispatches identical, ${writing} of them write`);
});

test("PATHS: every arm is equivalent, re-seats +2, returns the same, and the arms really differ", { skip }, () => {
  const prints = {};
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${label} escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    assert.equal(r.spDiff, 2, `${label}: the oracle re-seats two bytes higher and the rewrite does not`);
    assert.equal(r.retO, r.retC, `${label}: the return value diverged`);
    prints[label] = footprint(m);
  }
  // ★ Vacuity guard: the even chain, the open shot sweep and the armed sweep must each move a
  // different set of cells, or a crafted arm never fired and its teeth catch nothing.
  const shapes = new Set([prints.even, prints["odd-open-kill"], prints["odd-armed-kill"]]);
  assert.equal(shapes.size, 3, "two arms move the same cells, so a crafted entry did not fire");
  console.log(`  PATHS: 5 scenarios equivalent, +2 each; even moves ${prints.even}`);
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on exactly its arms`, { skip }, () => {
    const caught = scenarios().filter(([, m]) => compare(twin, m).escaped).map(([n]) => n);
    assert.ok(expected.length > 0, `the ${label} twin is not caught at all`);
    assert.deepEqual(caught.sort(), [...expected].sort(), `the ${label} twin's caught arms moved`);
    console.log(`  TEETH/${label}: caught on ${caught.join(",")}`);
  });
}
