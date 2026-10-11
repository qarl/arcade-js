// SPDX-License-Identifier: GPL-3.0-only
/**
 * splitCollisionWorkByFrameParity — memory-equivalent to the frozen oracle at ROM 0x4EBC.
 * GATE: unit-capture on every real dispatch (the attract demo reaches it; coin-start does not in
 *   the budget, with the caller as the live control) plus crafted collision entries for the three
 *   even-frame arms. RAM compared with the dead stack scratch below the seated SP masked out (the
 *   oracle brackets its calls with pushes the rewrite does not), the SP re-seat and the return
 *   value checked, registers not compared (the dissolved callees leave a different register dance
 *   and the tail exits mean no caller consumes one), and teeth on each dissolved arm.
 *   Run: node --test games/timeplt/idiomatic/test/equivalence-4ebc.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { splitCollisionWorkByFrameParity as candidate } from "../splitCollisionWorkByFrameParity.js";
import { loc_4ebc as oracle } from "../../translated/loc_4ebc.js";
import { loc_4e4f as caller } from "../../translated/loc_4e4f.js";
import { dispatchShotSweepByMotherShipArmed } from "../dispatchShotSweepByMotherShipArmed.js";
import { markEra1BomberAndShotHitByShots } from "../markEra1BomberAndShotHitByShots.js";
import { destroyPlayerAndObjectsTouchingIt } from "../destroyPlayerAndObjectsTouchingIt.js";
import { destroySlotsAndPlayerOnContact } from "../destroySlotsAndPlayerOnContact.js";
import { destroyPlayerAndMotherShipOnContactByEra } from "../destroyPlayerAndMotherShipOnContactByEra.js";
import { destroyFixedTargetReachedByPlayer } from "../destroyFixedTargetReachedByPlayer.js";
import { markObjectsTouchingPlayer } from "../markObjectsTouchingPlayer.js";

const TARGET = 0x4ebc;
const CALLER = 0x4e4f;
const FRAME_TICK = 0xa980;
const MOTHER_SHIP_ARMED = 0xad0d;
const PLAYER_STATE = 0xa800;
const MOTHER_SHIP_STATE = 0xa8a0;
const CLEARED_BESIDE = 0xa8a4;
const TARGET_STATE = 0xa8c0;
const ERA_INDEX = 0xad04;
const PLAYER_FIRST = 0xaa10;
const PLAYER_SECOND = 0xaa41;

// Every path's game writes land at or below here; the stack seats far above it (seat 0xafe4,
// deepest push 0xafda), so masking the scratch window can never hide a game-data divergence.
const DATA_TOP = 0xadff;
const CORPUS_DISPATCHES = 279;
const CORPUS_ODD_MISMATCH = 41;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/** Oracle vs a candidate on independent clones; the diff excludes [lowestSp, seat) — the dead
 * return-address scratch the oracle brackets each dissolved call with — with lowestSp measured by
 * watching the oracle's own pushes. Anything outside that window has escaped. */
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
  return cells;
}

// ── the captured corpus and crafted entries ───────────────────────────────────────────────

const pathOf = (mm) =>
  mm.mem8[FRAME_TICK] & 1 ? "odd" : mm.mem8[MOTHER_SHIP_ARMED] !== 0 ? "armed" : "not-armed";

let corpus = null;
function captureCorpus() {
  if (corpus) return corpus;
  const arr = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    arr.push({ path: pathOf(mm), machine: mm.clone() });
    return oracle(mm);
  }]]), { tape: [] });
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the attract run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the attract run ran short");
  corpus = arr;
  return corpus;
}

const baseOf = (path) => captureCorpus().find((e) => e.path === path).machine;

/** A not-armed capture nudged so the FIRST player-vs-object sweep marks its first record. */
function craftFirstHit() {
  const m = baseOf("not-armed").clone();
  m.mem8[PLAYER_STATE] = 0xff;
  m.mem8[0xa810] = 0xff;
  m.mem8[0xaa12] = m.mem8[PLAYER_FIRST];
  m.mem8[0xaa43] = m.mem8[PLAYER_SECOND];
  return m;
}

/** Armed, with the earlier sweeps blanked so only the mother-ship mutual kill can fire; the era is
 * held off the two that hand off to the wider box. CLEARED_BESIDE is dirtied because only the armed
 * arm clears it, which tells it apart from the not-armed sweep that also reaches that record. */
function craftArmedHit() {
  const m = baseOf("not-armed").clone();
  m.mem8[MOTHER_SHIP_ARMED] = 1;
  m.mem8[ERA_INDEX] = 2;
  m.mem8[PLAYER_STATE] = 0xff;
  for (let a = 0xa810; a <= 0xa890; a += 0x10) m.mem8[a] = 0;
  m.mem8[MOTHER_SHIP_STATE] = 0xff;
  m.mem8[CLEARED_BESIDE] = 0x55;
  m.mem8[0xaa24] = m.mem8[PLAYER_FIRST];
  m.mem8[0xaa55] = m.mem8[PLAYER_SECOND];
  return m;
}

/** Earlier sweeps blanked so the player survives to the tail, one object seated where the second
 * sweep leaves its cursor, one axis inside the real box but outside a narrowed one. */
function craftTailHit() {
  const m = baseOf("not-armed").clone();
  m.mem8[PLAYER_STATE] = 0xff;
  for (let a = 0xa810; a <= 0xa8e0; a += 0x10) m.mem8[a] = 0;
  m.mem8[TARGET_STATE] = 0;
  m.mem8[0xa8f0] = 0xff;
  m.mem8[0xaa2e] = (m.mem8[PLAYER_FIRST] - 4) & 0xff;
  m.mem8[0xaa5f] = m.mem8[PLAYER_SECOND];
  return m;
}

function scenarios() {
  return [
    ["odd", baseOf("odd")],
    ["not-armed", baseOf("not-armed")],
    ["first-hit", craftFirstHit()],
    ["armed-hit", craftArmedHit()],
    ["tail-hit", craftTailHit()],
  ];
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite's even-frame chain, each option a deliberate defect; defaults match splitCollisionWorkByFrameParity. */
function evenChain(m, { skipFirst = false, forceArmed = null, tailReach = 17, firstRecords = 0xa810 } = {}) {
  const { mem8, regs } = m;
  markEra1BomberAndShotHitByShots(m);
  if (!skipFirst) {
    regs.b = 4;
    regs.de = firstRecords;
    regs.iy = 0xaa12;
    regs.l = 5;
    regs.h = 11;
    destroyPlayerAndObjectsTouchingIt(m);
  }
  const armed = forceArmed === null ? mem8[MOTHER_SHIP_ARMED] !== 0 : forceArmed;
  regs.b = armed ? 5 : 7;
  regs.l = 7;
  regs.h = 15;
  destroySlotsAndPlayerOnContact(m);
  if (armed) destroyPlayerAndMotherShipOnContactByEra(m);
  destroyFixedTargetReachedByPlayer(m);
  regs.b = 1;
  regs.de = 0xa8e0;
  regs.iy = 0xaa2c;
  regs.l = 5;
  regs.h = 11;
  destroyPlayerAndObjectsTouchingIt(m);
  regs.b = 1;
  regs.l = 8;
  regs.h = tailReach;
  return markObjectsTouchingPlayer(m);
}

const onOdd = (opts) => (m) =>
  m.mem8[FRAME_TICK] & 1 ? dispatchShotSweepByMotherShipArmed(m) : evenChain(m, opts);

const TWINS = [
  ["no-op", () => {}, 4],
  ["wrong-parity", (m) => evenChain(m, {}), 1],
  ["skip-first-sweep", onOdd({ skipFirst: true }), 1],
  ["wrong-first-seat", onOdd({ firstRecords: PLAYER_STATE }), 1],
  ["skip-mothership", onOdd({ forceArmed: false }), 1],
  ["wrong-tail-reach", onOdd({ tailReach: 11 }), 1],
];

// ── the gate ──────────────────────────────────────────────────────────────────────────────

test("EQUAL at the first real dispatch: RAM identical outside the masked stack scratch", { skip }, () => {
  const r = compare(candidate, captureCorpus()[0].machine);
  assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
  // ★ The mask is safe only if it never covers a data cell: prove its floor sits above them all.
  assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
  console.log(`  EQUAL: window [${hex4(r.low)},${hex4(r.seat)}) masked, spDiff ${r.spDiff}`);
});

test("CORPUS: every attract dispatch replays; coin-start does not reach it in the budget", { skip }, () => {
  let caught = 0;
  for (const { machine } of captureCorpus()) if (compare(candidate, machine).escaped) caught++;
  assert.equal(caught, 0, `the rewrite diverged on ${caught} attract dispatches`);
  assert.equal(captureCorpus().length, CORPUS_DISPATCHES, "the attract dispatch count moved");
  let target = 0;
  let reachedCaller = 0;
  const m = makeMachine(new Map([
    [TARGET, (mm) => { target++; return oracle(mm); }],
    [CALLER, (mm) => { reachedCaller++; return caller(mm); }],
  ]), {});
  m.runFrames(ENTRY_FRAMES);
  // ★ The zero is a fact, not a dead tap: the SAME run reached the caller, which simply does not
  // take its branch here until deeper into a real game.
  assert.equal(target, 0, "coin-start now reaches this address in the budget; capture plain entries");
  assert.ok(reachedCaller > 0, "the caller never ran under coin-start, so the zero above proves nothing");
  console.log(`  CORPUS: ${CORPUS_DISPATCHES} attract dispatches identical; coin-start target ` +
    `${target}, caller ${reachedCaller}`);
});

test("PATHS: every arm is equivalent, re-seats +2, returns the same, and the arms really differ", { skip }, () => {
  const prints = {};
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${label} escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    assert.equal(r.spDiff, 2, `${label}: the oracle pops a return address and the rewrite does not`);
    assert.equal(r.retOracle, r.retCand, `${label}: the return value diverged`);
    prints[label] = footprint(m).join(",");
  }
  // ★ Vacuity guard: the crafted arms must each move DIFFERENT cells, or a poke changed nothing and
  // the teeth below would be catching an arm that never runs.
  const shapes = new Set([prints.odd, prints["first-hit"], prints["armed-hit"], prints["tail-hit"]]);
  assert.equal(shapes.size, 4, "two arms move the same cells, so a crafted entry did not fire");
  console.log(`  PATHS: 5 scenarios equivalent, +2 each; footprints odd ${prints.odd || "none"}`);
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of scenarios`, { skip }, () => {
    let caught = 0;
    for (const [, m] of scenarios()) if (compare(twin, m).escaped) caught++;
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's scenario catch count moved`);
    if (label === "no-op" || label === "wrong-parity") {
      let corp = 0;
      for (const { machine } of captureCorpus()) if (compare(twin, machine).escaped) corp++;
      assert.equal(corp, CORPUS_ODD_MISMATCH, `the ${label} twin's attract catch count moved`);
    }
    console.log(`  TEETH/${label}: caught on ${caught} of ${scenarios().length} scenarios`);
  });
}
