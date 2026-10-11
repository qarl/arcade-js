// SPDX-License-Identifier: GPL-3.0-only
/**
 * reaimEnemyCraftByFlightScriptOnPhaseTick — memory-equivalent to the frozen oracle at ROM 0x31b4.
 * GATE: natural dispatches under the coin-start tape plus every decision branch crafted, each masked
 * for the dead stack scratch the dissolved tails leave; spDiff pinned at two, returns compared.
 * The cursors it passed into its callees became explicit arguments, so nothing pins ix/iy any more.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-31b4.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { reaimEnemyCraftByFlightScriptOnPhaseTick as candidate } from "../reaimEnemyCraftByFlightScriptOnPhaseTick.js";
import { loc_31b4 as oracle } from "../../translated/loc_31b4.js";
import { layOutEnemyAimPointsFromPlayerHeading } from "../layOutEnemyAimPointsFromPlayerHeading.js";
import { stepCraftFlightScript } from "../stepCraftFlightScript.js";
import { headingToward } from "../headingToward.js";
import { offsetAddress } from "../offsetAddress.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x31b4;
const PHASE = 0xad05;
const RECORD_BASE = 0xa850;
const OCCUPIED = 0xff;
const CAP = 120;

// Every data write lands at or below here; the seat sits far above it, so masking the scratch can
// never hide a real byte. Asserted against the watched floor below.
const DATA_TOP = 0xadff;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── the masked comparison ─────────────────────────────────────────────────────────────────────

function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const rO = oracle(a);
  let rC, threw = null;
  try { rC = cand(b); } catch (e) { threw = String(e).slice(0, 60); }
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (threw || da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, threw, low, seat, spDiff: a.regs.sp - b.regs.sp, rO, rC };
}
const diverges = (cand, m) => { const r = compare(cand, m); return !!(r.escaped || r.threw); };

// Cells the oracle moves at or below the data top from a state — a turn's footprint.
function footprint(machine) {
  const before = machine.dumpState().slice();
  const a = machine.clone();
  oracle(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) {
    if (now[i] !== before[i] && a.stateOffsetToAddr(i) <= DATA_TOP) n++;
  }
  return n;
}

// ── real dispatches ───────────────────────────────────────────────────────────────────────────

let cache = null;
function captured() {
  if (cache) return cache;
  const entries = [];
  let collecting = true;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (collecting && entries.length < CAP) entries.push(mm.clone());
    return oracle(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  collecting = false;
  assert.equal(m.stoppedBy, null, `the run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the run ran short");
  cache = entries;
  return entries;
}
const base = () => captured()[0];

// ── crafted branch states ─────────────────────────────────────────────────────────────────────

// A captured machine with the phase byte and one record's head/state/timer forced. A zero timer
// stops the animation from touching the state byte, so the branch it selects is the crafted one.
function craft({ phase, head, state, timer = 0 }) {
  const m = base().clone();
  m.mem8[PHASE] = phase;
  const slot = phase & 0x0f;
  if (slot < 7) {
    const rec = RECORD_BASE + slot * 16;
    if (head !== undefined) m.mem8[rec] = head;
    if (state !== undefined) m.mem8[rec + 8] = state;
    m.mem8[rec + 9] = timer;
  }
  return m;
}

const branches = () => ({
  drawObject: craft({ phase: 0x17 }),
  drawObjectNoop: craft({ phase: 0x11 }),
  slotHigh: craft({ phase: 0x08 }),
  notOccupied: craft({ phase: 0x00, head: 0x00 }),
  reaim: craft({ phase: 0x00, head: OCCUPIED, state: 0x05 }),
  reaimHold: craft({ phase: 0x00, head: OCCUPIED, state: 0x11 }),
  held: craft({ phase: 0x00, head: OCCUPIED, state: 0x10 }),
  reaimSlot6: craft({ phase: 0x06, head: OCCUPIED, state: 0x05 }),
});
const corpus = () => Object.values(branches());

// ── broken twins ──────────────────────────────────────────────────────────────────────────────

// The rewrite with one deliberate defect; reimplemented so the defect governs the whole body.
function twin({ noop = false, slotCount = 7, halfTurn = true, call326c = true, holdReset = true }) {
  return function body(m) {
    if (noop) return;
    const { regs, mem8 } = m;
    const phase = mem8[PHASE];
    regs.c = phase;
    const tens = phase & 0xf0;
    if (tens !== 0x00 && tens !== 0x30) { if (call326c) return layOutEnemyAimPointsFromPlayerHeading(m); return; }
    const slot = phase & 0x0f;
    if (slot >= slotCount) return;
    const record = RECORD_BASE + slot * 16;
    const entry = 0xaa1a + slot * 2;
    regs.ix = record;
    regs.iy = entry;
    if (mem8[record] !== OCCUPIED) return;
    stepCraftFlightScript(m);
    const state = mem8[record + 8];
    if (state === 0x10) return;
    if (state === 0x11) {
      regs.hl = 0xac65;
      headingToward(m);
      mem8[record + 1] = u8(regs.a + (halfTurn ? 0x80 : 0));
      if (holdReset) { mem8[record + 8] = 0x10; mem8[record + 9] = 0x00; }
      return;
    }
    regs.a = u8(state + state);
    regs.hl = 0xac65;
    offsetAddress(m);
    headingToward(m);
    mem8[record + 1] = regs.a;
  };
}

const TWINS = [
  ["no-op", twin({ noop: true }), "reaim"],
  ["slot-count-6", twin({ slotCount: 6 }), "reaimSlot6"],
  ["no-half-turn", twin({ halfTurn: false }), "reaimHold"],
  ["skip-object", twin({ call326c: false }), "drawObject"],
  ["no-hold-reset", twin({ holdReset: false }), "reaimHold"],
];

function sweep(cand, states) {
  let caught = 0;
  for (const e of states) if (diverges(cand, e)) caught++;
  return caught;
}

// ── the gate ──────────────────────────────────────────────────────────────────────────────────

test("REAL: every natural dispatch replays identically, and some write", { skip }, () => {
  const entries = captured();
  assert.ok(entries.length > 0, "vacuous: nothing dispatched this address under the tape");
  for (const e of entries) {
    const r = compare(candidate, e);
    assert.equal(r.threw, null, r.threw && `the candidate threw: ${r.threw}`);
    assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
  }
  const wrote = entries.filter((e) => footprint(e) > 0).length;
  assert.ok(wrote > 0, "no natural dispatch makes the oracle write, so this arm would pass a no-op");
  console.log(`  REAL: ${entries.length} dispatches identical, ${wrote} of them write`);
});

test("PATHS: every decision branch replays, and the branch really branches", { skip }, () => {
  const b = branches();
  for (const [name, m] of Object.entries(b)) {
    const r = compare(candidate, m);
    assert.equal(r.threw, null, `${name}: ${r.threw}`);
    assert.equal(r.escaped, null, `${name}: escaped at ${r.escaped && hex4(r.escaped.addr)}`);
  }
  // ★ Vacuity guard: the write-nothing branches move nothing while the four writers do, so a rewrite
  // that ignored the phase, the slot, the occupancy or the state could not pass all of them.
  for (const name of ["drawObjectNoop", "slotHigh", "notOccupied", "held"]) {
    assert.equal(footprint(b[name]), 0, `the ${name} branch wrote something`);
  }
  for (const name of ["drawObject", "reaim", "reaimHold", "reaimSlot6"]) {
    assert.ok(footprint(b[name]) > 0, `the ${name} branch wrote nothing`);
  }
  console.log("  PATHS: eight branches identical; the four writers write, the four returns do not");
});

test("SP AND RETURN: +2 re-seat on every branch, mask floor over the data, returns equal",
  { skip }, () => {
    for (const [name, m] of Object.entries(branches())) {
      const r = compare(candidate, m);
      assert.equal(r.spDiff, 2, `${name}: the oracle no longer pops exactly one return the rewrite leaves`);
      assert.ok(r.low > DATA_TOP, `${name}: the stack window ${hex4(r.low)} reached into game data`);
      assert.equal(r.rO, r.rC, `${name}: the return value diverged`);
    }
    console.log("  SP: +2 on every branch; window over the data; returns identical");
  });

for (const [label, brokenTwin, catchOn] of TWINS) {
  test(`TEETH: the ${label} twin is caught in memory on its branch`, { skip }, () => {
    const states = corpus();
    const b = branches();
    const r = compare(brokenTwin, b[catchOn]);
    assert.notEqual(r.escaped, null, `the ${label} twin left ${catchOn}'s memory identical`);
    const caught = sweep(brokenTwin, states);
    assert.ok(caught > 0, `the ${label} twin is not caught at all`);
    console.log(`  TEETH/${label}: caught in memory on ${catchOn}, ${caught}/${states.length} branches`);
  });
}
