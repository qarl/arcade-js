// SPDX-License-Identifier: GPL-3.0-only
/**
 * stepDyingObjectState vs its frozen oracle. This entry dissolves four calls into direct imports, so the oracle
 * parks return addresses in the stack scratch the rewrite never writes and pops one it never pushed:
 * RAM is compared with the measured [low, seat) window masked, the +2 sp drift is asserted, and the
 * flag/scratch registers the dissolved callees do not reproduce are excluded — only ix and iy, the
 * bases the caller keeps, are held. Real play tops the state byte out at 0x3b plus the 0xf0 just-hit mark,
 * so the threshold and above-threshold arms are reached only by the crafted 256-state sweep.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2b93.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { stepDyingObjectState as candidate } from "../stepDyingObjectState.js";
import { loc_2b93 as oracle } from "../../translated/loc_2b93.js";
import { countTheKillAndGrantTheSharedToken as countKill } from "../countTheKillAndGrantTheSharedToken.js";
import { decrementObjectStateThenFlyAtSlowestSpeed } from "../decrementObjectStateThenFlyAtSlowestSpeed.js";
import { moveObjectByStateByteThenRunAppearance } from "../moveObjectByStateByteThenRunAppearance.js";
import { retireSlotAndSubPixel as retire } from "../retireSlotAndSubPixel.js";
import { u8 } from "../../../../core/int.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x2b93;
const STATE = 0;
const REARM = 0xf0;
const REARMED_TO = 0x3b;
const DEATH = 0x3c;

const CORPUS_FRAMES = ENTRY_FRAMES;
const SP_DRIFT = 2;
const DATA_TOP = 0xadff;

// The dissolved callees drop the flag dance and the oracle drops a ROM ret, so these move; ix and
// iy are the bases the caller keeps and must not.
const MOVED = ["a", "f", "b", "c", "d", "e", "h", "l", "sp"];
const HELD = ["ix", "iy"];

const SESSIONS = [["coin-start", {}], ["attract", { tape: [] }]];
const DISPATCHES = { "coin-start": 37, attract: 257 };

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/** Oracle vs candidate on clones: RAM outside the oracle's own [low, seat) push window, the ix/iy
 * bases, the sp drift and the return value. `low` is watched off the oracle's pushes, so a path
 * that nests deeper (the just-hit and death arms enter the kill) widens the window on its own. */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const retO = oracle(a);
  const retC = cand(b);
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, a: da[i], b: db[i] };
  }
  let held = null;
  for (const k of HELD) if (a.regs[k] !== b.regs[k]) held = { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  return { escaped, held, low, seat, spDiff: a.regs.sp - b.regs.sp, retO, retC };
}

// ── the captured entry and the crafted states ─────────────────────────────────────────────

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(ENTRY_FRAMES);
  }
  return entry;
}

function craft(state) {
  const m = entryState().clone();
  m.mem8[m.regs.ix + STATE] = state;
  return m;
}

function sweepCrafted(cand) {
  let caught = 0;
  for (let s = 0; s < 256; s++) {
    const r = compare(cand, craft(s));
    if (r.escaped || r.held) caught++;
  }
  return caught;
}

function replaySession(opts, cand) {
  let dispatches = 0;
  let caught = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    const r = compare(cand, mm);
    if (r.escaped || r.held) caught++;
    return oracle(mm);
  }]]), opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught };
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: starts the death countdown at the wrong byte. */
function brokenRearmWrongValue(m, o = m.regs.ix) {
  const s = m.mem8[o + STATE];
  if (s === REARM) { m.mem8[o + STATE] = REARMED_TO - 1; return countKill(m, o); }
  if (s === DEATH) countKill(m, o);
  if (s >= DEATH) return decrementObjectStateThenFlyAtSlowestSpeed(m, o);
  const st = u8(s - 1); m.mem8[o + STATE] = st;
  if (st === 0) return retire(m, o);
  return moveObjectByStateByteThenRunAppearance(m, o);
}

/** BUG: starts the death countdown but never counts the kill. */
function brokenRearmSkipsCount(m, o = m.regs.ix) {
  const s = m.mem8[o + STATE];
  if (s === REARM) { m.mem8[o + STATE] = REARMED_TO; return; }
  if (s === DEATH) countKill(m, o);
  if (s >= DEATH) return decrementObjectStateThenFlyAtSlowestSpeed(m, o);
  const st = u8(s - 1); m.mem8[o + STATE] = st;
  if (st === 0) return retire(m, o);
  return moveObjectByStateByteThenRunAppearance(m, o);
}

/** BUG: the threshold is exclusive, so the death-begin value falls into the countdown. */
function brokenThresholdExclusive(m, o = m.regs.ix) {
  const s = m.mem8[o + STATE];
  if (s === REARM) { m.mem8[o + STATE] = REARMED_TO; return countKill(m, o); }
  if (s === DEATH) countKill(m, o);
  if (s > DEATH) return decrementObjectStateThenFlyAtSlowestSpeed(m, o);
  const st = u8(s - 1); m.mem8[o + STATE] = st;
  if (st === 0) return retire(m, o);
  return moveObjectByStateByteThenRunAppearance(m, o);
}

/** BUG: the countdown never writes the stepped byte back. */
function brokenSkipDecrement(m, o = m.regs.ix) {
  const s = m.mem8[o + STATE];
  if (s === REARM) { m.mem8[o + STATE] = REARMED_TO; return countKill(m, o); }
  if (s === DEATH) countKill(m, o);
  if (s >= DEATH) return decrementObjectStateThenFlyAtSlowestSpeed(m, o);
  if (u8(s - 1) === 0) return retire(m, o);
  return moveObjectByStateByteThenRunAppearance(m, o);
}

/** BUG: everything below the threshold is flown on instead of counted down. */
function brokenFliesBelow(m, o = m.regs.ix) {
  const s = m.mem8[o + STATE];
  if (s === REARM) { m.mem8[o + STATE] = REARMED_TO; return countKill(m, o); }
  if (s === DEATH) countKill(m, o);
  return decrementObjectStateThenFlyAtSlowestSpeed(m, o);
}

const TWINS = [
  ["no-op", brokenNoOp, 256, { "coin-start": 37, attract: 257 }],
  ["just-hit-wrong-value", brokenRearmWrongValue, 1, { "coin-start": 1, attract: 7 }],
  ["just-hit-skips-count", brokenRearmSkipsCount, 1, { "coin-start": 1, attract: 7 }],
  ["threshold-exclusive", brokenThresholdExclusive, 1, { "coin-start": 0, attract: 0 }],
  ["skip-decrement", brokenSkipDecrement, 51, { "coin-start": 36, attract: 250 }],
  ["flies-below", brokenFliesBelow, 60, { "coin-start": 36, attract: 250 }],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: RAM identical outside the masked scratch, ix/iy held", { skip }, () => {
  const e = entryState();
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const r = compare(candidate, e);
  assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${show(r.escaped)}`);
  assert.equal(r.held, null, r.held && `a held base moved: ${show(r.held)}`);
  // ★ The mask is safe only if it never covers a data cell: its floor must sit above them all.
  assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached into game data`);
  console.log(`  EQUAL: state ${hex4(e.mem8[e.regs.ix])}, window [${hex4(r.low)},${hex4(r.seat)}) masked, spDiff ${r.spDiff}`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const r = compare(brokenNoOp, entryState());
  assert.notEqual(r.escaped, null, "the masked diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(r.escaped)}`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return the same", { skip }, () => {
  for (const s of [0x0a, 0x01, REARMED_TO, DEATH, 0x40, REARM]) {
    const r = compare(candidate, craft(s));
    assert.equal(r.spDiff, SP_DRIFT, `state ${hex4(s)}: sp drift moved`);
    assert.equal(r.retO, r.retC, `state ${hex4(s)}: the return value diverged`);
  }
  console.log(`  SP: +${SP_DRIFT} on every arm; return values identical`);
});

test("EXCLUDED, deliberately: only the flag/scratch registers move, ix/iy held", { skip }, () => {
  const moved = new Set();
  for (let s = 0; s < 256; s++) {
    const a = craft(s);
    const b = a.clone();
    oracle(a);
    candidate(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register diverged outside the excluded set");
  for (const k of HELD) assert.ok(!moved.has(k), `a base the caller keeps moved (${k})`);
});

test("CORPUS: every dispatch of two real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const [label, opts] of SESSIONS) {
    const r = replaySession(opts, candidate);
    assert.equal(r.dispatches, DISPATCHES[label], `${label} dispatch count moved`);
    assert.equal(r.caught, 0, `the rewrite diverged on ${r.caught} ${label} dispatches`);
    total += r.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("EXHAUSTIVE: all 256 state bytes crafted onto a real object are equivalent", { skip }, () => {
  assert.equal(sweepCrafted(candidate), 0, "a crafted state byte diverged");
  console.log("  EXHAUSTIVE: 256 state bytes identical outside the window");
});

for (const [label, twin, crafted, perSession] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count`, { skip }, () => {
    const c = sweepCrafted(twin);
    const real = SESSIONS.map(([lbl, opts]) => [lbl, replaySession(opts, twin).caught]);
    console.log(`  TEETH/${label}: ${c}/256 crafted, real ${real.map(([l, n]) => `${l} ${n}`).join(", ")}`);
    assert.ok(c + real.reduce((n, [, v]) => n + v, 0) > 0, `every sweep PASSED the ${label} twin`);
    assert.equal(c, crafted, `the ${label} twin's crafted catch count moved`);
    for (const [lbl, n] of real) assert.equal(n, perSession[lbl], `the ${label} twin's ${lbl} count moved`);
  });
}
