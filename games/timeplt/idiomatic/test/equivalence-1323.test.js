// SPDX-License-Identifier: GPL-3.0-only
/**
 * stepRoundWonBandAnimation — memory-equivalent to the frozen oracle at ROM 0x1323.
 * GATE: crafted-entry; no tape dispatches this phase-14 handler, so a coherent machine is captured
 *   at the reachable dispatcher and each arm is poked in. RAM compared with the dead stack scratch
 *   below the seated SP masked out (the oracle nests calls and rets, the rewrite does not), the SP
 *   re-seat and return value checked, and teeth. Registers are not compared: the dissolved callees
 *   do not reproduce the register dance and no caller of this computed-dispatch arm consumes one.
 *   Run: node --test games/timeplt/idiomatic/test/equivalence-1323.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { stepRoundWonBandAnimation as candidate } from "../stepRoundWonBandAnimation.js";
import { loc_1323 as oracle } from "../../translated/loc_1323.js";
import { flashPlayerWhiteOnAlternateCalls } from "../flashPlayerWhiteOnAlternateCalls.js";
import { hideAllSprites } from "../hideAllSprites.js";
import { advanceScriptedCharPlaneBandTo2 } from "../advanceScriptedCharPlaneBandTo2.js";
import { cyclePlayerSpriteColourThenAdvanceStepAtZero } from "../cyclePlayerSpriteColourThenAdvanceStepAtZero.js";
import { floodColourPlaneWithSavedPlayerColour } from "../floodColourPlaneWithSavedPlayerColour.js";
import { advanceScriptedCharPlaneBandTo4 } from "../advanceScriptedCharPlaneBandTo4.js";
import { loadActivePlayerContextAndPostRoundHud } from "../loadActivePlayerContextAndPostRoundHud.js";
import { FRAME_TICK, SEQUENCE_SUBSTEP, SEQUENCE_DELAY } from "../names.js";

const TARGET = 0x1323;
const DISPATCHER = 0x0f1f;
const ANIMATION_STEP = 0xa9f0;
const SUBSTEP_RELOAD = 0x2750;
const WIND_DELAY = 90;
const GATE_BIT = 2;
// Every path's data writes land at or below here; the stack seats above it, so masking the scratch
// window can never hide a game-data divergence. Asserted against the measured floor below.
const DATA_TOP = 0xaeff;
const CAPTURE_FRAME = 600;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/**
 * Oracle vs a candidate on independent clones. The oracle nests calls and leaves dead return
 * addresses in the stack scratch the rewrite never writes, so the diff excludes [low, seat) — low
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

/** Cells the oracle moves from a state, ignoring the stack scratch — an arm's footprint. */
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

// ── the captured base machine, and the crafted arm entries ────────────────────────────────

let base = null;
function baseState() {
  if (base === null) {
    const real = TRANSLATED.get(DISPATCHER);
    const m = makeMachine(new Map([[DISPATCHER, (mm) => {
      if (base === null) base = mm.clone();
      return real(mm);
    }]]));
    m.runFrames(CAPTURE_FRAME);
  }
  return base;
}

function craft(mutate) {
  const m = baseState().clone();
  mutate(m);
  return m;
}
const open = (m) => { m.mem8[FRAME_TICK] &= ~GATE_BIT; };

/** Every arm poked in on a coherent machine; the gated case keeps a writing arm so a rewrite that
 * ignores the alternate-frame gate is not silently equivalent. */
function scenarios() {
  return [
    ["step0", craft((m) => { open(m); m.mem8[ANIMATION_STEP] = 0; })],
    ["step1", craft((m) => { open(m); m.mem8[ANIMATION_STEP] = 1; })],
    ["step2", craft((m) => { open(m); m.mem8[ANIMATION_STEP] = 2; })],
    ["step3", craft((m) => { open(m); m.mem8[ANIMATION_STEP] = 3; })],
    ["step4", craft((m) => { open(m); m.mem8[ANIMATION_STEP] = 4; })],
    ["wind", craft((m) => { open(m); m.mem8[ANIMATION_STEP] = 5; })],
    ["gated", craft((m) => { m.mem8[FRAME_TICK] |= GATE_BIT; m.mem8[ANIMATION_STEP] = 5; })],
  ];
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every knob matches stepRoundWonBandAnimation by default. */
function twin({ gate = true, arm1Tail = true, windDelay = WIND_DELAY, reload = true, step3Extra = false }) {
  return (m) => {
    const { mem8 } = m;
    if (gate && (mem8[FRAME_TICK] & GATE_BIT)) return;
    switch (mem8[ANIMATION_STEP]) {
      case 0: flashPlayerWhiteOnAlternateCalls(m); return;
      case 1: flashPlayerWhiteOnAlternateCalls(m); if (arm1Tail) advanceScriptedCharPlaneBandTo2(m); return;
      case 2: cyclePlayerSpriteColourThenAdvanceStepAtZero(m); advanceScriptedCharPlaneBandTo4(m); return;
      case 3: if (step3Extra) cyclePlayerSpriteColourThenAdvanceStepAtZero(m); advanceScriptedCharPlaneBandTo4(m); return;
      case 4: floodColourPlaneWithSavedPlayerColour(m); return;
      default:
        mem8[SEQUENCE_DELAY] = windDelay;
        hideAllSprites(m);
        loadActivePlayerContextAndPostRoundHud(m);
        mem8[SEQUENCE_SUBSTEP] = reload ? mem8[SUBSTEP_RELOAD] : 0;
    }
  };
}

const TWINS = [
  ["no-op", () => {}, 6],
  ["forget-gate", twin({ gate: false }), 1],
  ["drop-arm1-tail", twin({ arm1Tail: false }), 1],
  ["wrong-wind-delay", twin({ windDelay: WIND_DELAY + 1 }), 1],
  ["wrong-reload", twin({ reload: false }), 1],
  ["step3-mis-dispatch", twin({ step3Extra: true }), 1],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: no tape dispatches this phase, with a live control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    const seen = { [TARGET]: 0, [DISPATCHER]: 0 };
    const realDisp = TRANSLATED.get(DISPATCHER);
    const realTgt = TRANSLATED.get(TARGET);
    const m = makeMachine(new Map([
      [TARGET, (mm) => { seen[TARGET]++; return realTgt(mm); }],
      [DISPATCHER, (mm) => { seen[DISPATCHER]++; return realDisp(mm); }],
    ]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // ★ The zero is evidence ONLY because the same taps, in the same run, counted the dispatcher
    // that would reach it. A tap that could never fire looks like an address nothing reaches.
    assert.ok(seen[DISPATCHER] > 0,
      `the ${label} run counted nothing at the dispatcher either, so the instrument is broken`);
    assert.equal(seen[TARGET], 0,
      `${label} now dispatches this phase, so a captured entry beats the crafted ones below`);
    console.log(`  UNREACHED: ${label} — ${hex4(TARGET)} ${seen[TARGET]}, control ` +
      `${hex4(DISPATCHER)} ${seen[DISPATCHER]}`);
  }
});

test("EQUAL on every arm: RAM identical outside the masked stack scratch", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null,
      r.escaped && `${label} escaped the mask at ${hex4(r.escaped.addr)}`);
    // ★ The mask is safe only if it never covers a data cell: prove its floor sits above them all.
    assert.ok(r.low > DATA_TOP, `${label}: the stack window ${hex4(r.low)} reached into game data`);
  }
  console.log(`  EQUAL: ${scenarios().length} arms identical outside the scratch window`);
});

test("PATHS: the arms move different cells, and the gate really gates", { skip }, () => {
  const prints = {};
  for (const [label, m] of scenarios()) prints[label] = footprint(m).join(",");
  // ★ Vacuity guard: distinct arms must leave DIFFERENT cells, and the gated frame nothing at all,
  // or the pokes changed nothing and the arm would pass a rewrite that ignored the dispatch.
  assert.notEqual(prints.step0, prints.wind, "the flash arm and the wind arm move the same cells");
  assert.equal(prints.gated, "", "the gated frame wrote game data; the alternate-frame gate is dead");
  assert.ok(footprint(scenarios()[5][1]).includes(SEQUENCE_SUBSTEP),
    "the wind arm never reloaded the outer sub-step");
  console.log(`  PATHS: wind moves ${prints.wind.split(",").length} cells, gated moves 0`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return the same", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.spDiff, 2, `${label}: the oracle pops a return address and the rewrite does not`);
    assert.equal(r.retOracle, r.retCand, `${label}: the return value diverged`);
  }
  console.log("  SP: +2 on every arm; return values identical");
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of arms`, { skip }, () => {
    let caught = 0;
    for (const [, m] of scenarios()) if (compare(brokenTwin, m).escaped) caught++;
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${scenarios().length} arms`);
  });
}
