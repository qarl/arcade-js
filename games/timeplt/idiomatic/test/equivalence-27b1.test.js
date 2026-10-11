// SPDX-License-Identifier: GPL-3.0-only
/**
 * armNewGameThenStepSequence — memory-equivalent to the frozen oracle. The coin-start tape reaches it once with
 * PLAY_ACTIVE set (the mid-game arm); the undriven tape reaches it with the flag clear (the
 * fresh-round arm). Both arms are compared on real captures, the fresh-round arm also on a poked
 * clone. The dissolved callees leave the stack scratch and the registers differently, so RAM is
 * compared outside the frozen side's own push window and registers are left out.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-27b1.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { armNewGameThenStepSequence } from "../armNewGameThenStepSequence.js";
import { loc_27b1 as oracle } from "../../translated/loc_27b1.js";
import { PLAY_ACTIVE, SEQUENCE_SUBSTEP } from "../names.js";

const TARGET = 0x27b1;
const DATA_TOP = 0xadff;
const POSITION_SEED = 0xac64;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) =>
  d ? `${d.addr == null ? "reg/ret" : hex4(d.addr)}: frozen=${d.a} rewrite=${d.b}` : "identical";

/** Machines the ROM itself dispatched this address with, under one tape. */
function captureEntries(tapeOpts, cap = 8) {
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (entries.length < cap) entries.push(mm.clone());
    return oracle(mm);
  }]]), tapeOpts);
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
  return entries;
}

let midGame = null;
let freshRound = null;
const midGameEntries = () => (midGame ??= captureEntries({}));
const freshRoundEntries = () => (freshRound ??= captureEntries({ tape: [] }));

/** A mid-game capture with the play flag forced clear, so the fresh-round arm runs on it. */
function pokedFreshRound() {
  const e = midGameEntries()[0].clone();
  e.mem8[PLAY_ACTIVE] = 0x00;
  return e;
}

function allEntries() {
  return [...midGameEntries(), ...freshRoundEntries(), pokedFreshRound()];
}

/**
 * Oracle vs candidate on independent clones. RAM outside the frozen side's push window must
 * agree byte for byte, and the return value must match; registers and that window are excluded.
 */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const ra = oracle(a);
  let rb;
  try {
    rb = candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: String(e).slice(0, 40) };
  }
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  if (ra !== rb) return { addr: null, a: `ret=${ra}`, b: `ret=${rb}` };
  return null;
}

/** The push window floor, off the frozen side alone. */
function windowFloor(machine) {
  const a = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  return { low, seat };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("MID-GAME ARM: coin-start reaches this with PLAY_ACTIVE set, and rewrite == oracle", { skip }, () => {
  const entries = midGameEntries();
  assert.ok(entries.length > 0, "vacuous: the coin-start tape never dispatched this address");
  for (const e of entries) {
    assert.notEqual(e.mem8[PLAY_ACTIVE], 0, "the mid-game capture no longer has the play flag set");
    assert.equal(unitDiff(armNewGameThenStepSequence, e), null, `mid-game arm diverged: ${show(unitDiff(armNewGameThenStepSequence, e))}`);
  }
  console.log(`  MID-GAME: ${entries.length} capture(s), rewrite identical`);
});

test("FRESH-ROUND ARM: the undriven capture and a poked clone, rewrite == oracle", { skip }, () => {
  const entries = [...freshRoundEntries(), pokedFreshRound()];
  for (const e of entries) {
    assert.equal(e.mem8[PLAY_ACTIVE], 0, "a fresh-round entry no longer has the play flag clear");
    assert.equal(unitDiff(armNewGameThenStepSequence, e), null, `fresh-round arm diverged: ${show(unitDiff(armNewGameThenStepSequence, e))}`);
  }
  console.log(`  FRESH-ROUND: ${freshRoundEntries().length} undriven + 1 poked, rewrite identical`);
});

test("THE TAIL LANDS: both arms advance SEQUENCE_SUBSTEP by one", { skip }, () => {
  for (const e of allEntries()) {
    const before = e.mem8[SEQUENCE_SUBSTEP];
    const c = e.clone();
    armNewGameThenStepSequence(c);
    assert.equal(c.mem8[SEQUENCE_SUBSTEP], (before + 1) & 0xff, "the sequence sub-step did not advance");
  }
  console.log("  THE TAIL LANDS: SEQUENCE_SUBSTEP advanced on every entry");
});

test("SCRATCH: the push window sits above the data on every entry", { skip }, () => {
  for (const e of allEntries()) {
    const { low, seat } = windowFloor(e);
    assert.ok(low > DATA_TOP, `the push window ${hex4(low)} reached into game data`);
    assert.ok(low < seat, "the frozen side pushed nothing, so the mask hides an untested divergence");
  }
  const r = windowFloor(midGameEntries()[0]);
  console.log(`  SCRATCH: window [${hex4(r.low)}, ${hex4(r.seat)}) clears data top ${hex4(DATA_TOP)}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing, so none of the seats or clears land. */
function brokenNoOp() {}

/** BUG: the player position seed is wrong. */
function brokenWrongPosition(m) {
  armNewGameThenStepSequence(m);
  m.mem8[POSITION_SEED] = 0x00;
}

/** BUG: seats everything but never hands to the tail, so the sequence never steps on. */
function brokenDroppedTail(m) {
  armNewGameThenStepSequence(m);
  m.mem8[SEQUENCE_SUBSTEP] = (m.mem8[SEQUENCE_SUBSTEP] - 1) & 0xff;
}

/** BUG: ignores PLAY_ACTIVE and always runs the mid-game arm. */
function brokenAlwaysMidGame(m) {
  const flag = m.mem8[PLAY_ACTIVE];
  m.mem8[PLAY_ACTIVE] = 0xff;
  armNewGameThenStepSequence(m);
  m.mem8[PLAY_ACTIVE] = flag;
}

const TWINS = [
  ["no-op", brokenNoOp, allEntries],
  ["wrong-position", brokenWrongPosition, allEntries],
  ["dropped-tail", brokenDroppedTail, allEntries],
  // ★ only visible where the arm it forces is the wrong one — the fresh-round entries.
  ["always-mid-game", brokenAlwaysMidGame, () => [...freshRoundEntries(), pokedFreshRound()]],
];

for (const [label, twin, pool] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT in memory`, { skip }, () => {
    let caught = 0;
    let first = null;
    for (const e of pool()) {
      const d = unitDiff(twin, e);
      if (d) {
        caught++;
        first ??= d;
      }
    }
    assert.ok(caught > 0, `every entry PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught on ${caught}/${pool().length} — first ${show(first)}`);
  });
}
