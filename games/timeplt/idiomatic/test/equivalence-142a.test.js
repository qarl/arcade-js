// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceScriptedCharPlaneBandTo2 — memory-equivalent to the frozen oracle at ROM 0x142A.
 * GATE: crafted-entry. No tape dispatches this address, nor its whole inter-round band subsystem, so
 *   entries are a real attract machine with the countdown, the script pointer and a written script
 *   poked identically on both arms; a live control proves the tap can see a dispatch. Live-out is
 *   memory-only -- the sole caller returns the instant this does -- so the contract is RAM minus
 *   the stack scratch below the entry SP, scanned in full so a stack-scratch diff cannot mask a real one, and
 *   the omitted ret is witnessed as SP left unmoved while the oracle rets for itself.
 * HOLE: the script and its pointer are fabricated; which script the game feeds this, at which step,
 *   is not observed here.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-142a.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { advanceScriptedCharPlaneBandTo2 } from "../advanceScriptedCharPlaneBandTo2.js";
import { loc_142a as oracle } from "../../translated/loc_142a.js";
import manifest from "../../manifest.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { u8 } from "../../../../core/int.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x142a;
const CONTROL = 0x00d8;
const PASS_COUNTDOWN = 0xa9f2;
const SCRIPT_POINTER = 0xa9f7;
const NEXT_STEP_CELL = 0xa9f0;
const SCRIPT_AT = 0xa960;
const RUN = 0xa400;
const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;
const STACK_WINDOW = { lo: STACK_LO, hi: STACK_HI };
/** Stack scratch below the entry SP `floor` is dead; every cell from the floor up is compared. */
const deadStack = (floor) => deadStackBelow(STACK_WINDOW, floor);

const DRAW_SCRIPT = [0x01, 0x01, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

// ── crafted entries ─────────────────────────────────────────────────────────────────────
let base = null;
function baseMachine() {
  if (!base) {
    const m = makeMachine(null, { tape: [] });
    m.runFrames(200);
    base = m.clone();
  }
  return base.clone();
}
function withScript(m) {
  m.mem8[PASS_COUNTDOWN] = 0x07;
  m.mem8[SCRIPT_POINTER] = SCRIPT_AT & 0xff;
  m.mem8[SCRIPT_POINTER + 1] = (SCRIPT_AT >> 8) & 0xff;
  return m;
}
function craftBlanking(countdown) {
  const m = baseMachine();
  m.mem8[PASS_COUNTDOWN] = countdown;
  return m;
}
function craftDrawing() {
  const m = withScript(baseMachine());
  for (let i = 0; i < DRAW_SCRIPT.length; i++) m.mem8[SCRIPT_AT + i] = DRAW_SCRIPT[i];
  return m;
}
function craftTerminator() {
  const m = withScript(baseMachine());
  m.mem8[SCRIPT_AT] = 0xff;
  return m;
}
function scenarios() {
  return [
    ["blanking-8", craftBlanking(0x08)],
    ["blanking-0", craftBlanking(0x00)],
    ["drawing", craftDrawing()],
    ["terminator", craftTerminator()],
  ];
}

/** First byte that differs outside the stack scratch below the entry SP; full scan, so a scratch diff cannot mask it. */
function diffOutsideStack(machine, candidate) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: String(e).slice(0, 50) };
  }
  const da = a.dumpState();
  const db = b.dumpState();
  const dead = deadStack(machine.regs.sp);
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) {
      const addr = machine.stateOffsetToAddr(i);
      if (!dead(addr)) return { addr, a: da[i], b: db[i] };
    }
  }
  return null;
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
function caughtCount(candidate) {
  let n = 0;
  for (const [, m] of scenarios()) if (diffOutsideStack(m, candidate)) n++;
  return n;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────
function brokenNoUpdate(m) {
  const x = m.mem8[PASS_COUNTDOWN];
  advanceScriptedCharPlaneBandTo2(m);
  m.mem8[PASS_COUNTDOWN] = x;
}
function brokenTerminatorNoArm(m) {
  const x = m.mem8[NEXT_STEP_CELL];
  advanceScriptedCharPlaneBandTo2(m);
  m.mem8[NEXT_STEP_CELL] = x;
}
function brokenWrongFill(m) {
  const blank = (m.mem8[PASS_COUNTDOWN] & 1) === 0;
  advanceScriptedCharPlaneBandTo2(m);
  if (blank) m.mem8[0xa7b1] = 0xf0;
}
function brokenNoGather(m) {
  const draw = (m.mem8[PASS_COUNTDOWN] & 1) === 1 && m.mem8[m.mem16[SCRIPT_POINTER]] !== 0xff;
  const saved = [];
  if (draw) for (let i = 0; i < 32; i++) saved.push(m.mem8[RUN + i]);
  advanceScriptedCharPlaneBandTo2(m);
  if (draw) for (let i = 0; i < 32; i++) m.mem8[RUN + i] = saved[i];
}
function brokenNoPointerAdvance(m) {
  const x = m.mem16[SCRIPT_POINTER];
  advanceScriptedCharPlaneBandTo2(m);
  m.mem16[SCRIPT_POINTER] = x;
}
function brokenNoBandStep(m) {
  const draw = (m.mem8[PASS_COUNTDOWN] & 1) === 1 && m.mem8[m.mem16[SCRIPT_POINTER]] !== 0xff;
  advanceScriptedCharPlaneBandTo2(m);
  if (draw) m.mem8[0xa631] = u8(m.mem8[0xa631] + 1);
}
const TWINS = [
  ["no-update", brokenNoUpdate, 4],
  ["terminator-no-arm", brokenTerminatorNoArm, 1],
  ["wrong-fill", brokenWrongFill, 2],
  ["no-gather", brokenNoGather, 1],
  ["no-pointer-advance", brokenNoPointerAdvance, 2],
  ["no-band-step", brokenNoBandStep, 1],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────
test("UNREACHED: no tape dispatches this address, with a live control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    let target = 0;
    let control = 0;
    const realControl = TRANSLATED.get(CONTROL);
    const m = makeMachine(new Map([
      [TARGET, (mm) => { target++; return oracle(mm); }],
      [CONTROL, (mm) => { control++; return realControl(mm); }],
    ]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `${label} stopped early: ${m.stoppedBy}`);
    assert.ok(control > 0, `${label}: the control fired nothing, so the zero beside it is meaningless`);
    assert.equal(target, 0, `${label} now dispatches this address; capture plain entries instead`);
    console.log(`  UNREACHED: ${label} — ${hex4(TARGET)} ${target}, control ${hex4(CONTROL)} ${control}`);
  }
});

test("EQUIVALENT: every crafted pass, RAM minus stack scratch below the entry SP", { skip }, () => {
  for (const [label, m] of scenarios()) {
    assert.equal(show(diffOutsideStack(m, advanceScriptedCharPlaneBandTo2)), "identical", label);
  }
});

test("NON-VACUOUS: the oracle moves memory on every crafted pass", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const moved = footprint(m);
    assert.ok(moved > 0, `${label} moved nothing, so its equivalence check is vacuous`);
    console.log(`  NON-VACUOUS: ${label} moves ${moved} bytes`);
  }
});

test("OMITTED RET: the rewrite leaves SP put, the oracle rets for itself", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const b = m.clone();
    const spBefore = b.regs.sp;
    advanceScriptedCharPlaneBandTo2(b);
    assert.equal((b.regs.sp - spBefore) & 0xffff, 0, `${label}: the rewrite moved SP`);
    const a = m.clone();
    const spOracle = a.regs.sp;
    oracle(a);
    assert.equal((a.regs.sp - spOracle) & 0xffff, 2, `${label}: the oracle did not ret`);
  }
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on ${expected} of the crafted passes`, { skip }, () => {
    assert.equal(caughtCount(twin), expected, `${label} caught on the wrong number of passes`);
  });
}
