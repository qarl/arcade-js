// SPDX-License-Identifier: GPL-3.0-only
/**
 * armBomberSlotWhenTimerFires — memory-equivalent to the frozen oracle at ROM 0x3C25.
 * GATE: crafted-entry, one branch per exit plus the full arm, replayed at every real dispatch. The
 *   dissolved callees drop their ROM rets, so the oracle leaves two dead return-address bytes below
 *   its seated SP that the rewrite never writes; the diff masks [lowestSP, seat) — lowestSP watched
 *   off the oracle's own pushes — and asserts the +2 SP re-seat. Registers are not compared: the
 *   callees do not reproduce the register dance and the four heterogeneous exits mean no caller
 *   consumes one. Only attract reaches this entry; the driven tape never does.
 *   Run: node --test games/timeplt/idiomatic/test/equivalence-3c25.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { armBomberSlotWhenTimerFires as candidate } from "../armBomberSlotWhenTimerFires.js";
import { loc_3c25 as oracle } from "../../translated/loc_3c25.js";
import { fetchTableByte } from "../fetchTableByte.js";
import { velocityForHeadingAtSlowestSpeed } from "../velocityForHeadingAtSlowestSpeed.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x3c25;
const FRAME_TICK = 0xa980;
const PLAYER_HEADING = 0xa802;
const MOTHER_SHIP_ARMED = 0xad0d;
const BOMBER_HITS_TO_ABSORB = 0xa8dc;
const EDGE_POSITION_TABLE = 0x3c84;
const COUNTDOWN = 0x0e;

// Every game cell this routine touches sits at or below here; the stack seats well above it, so
// masking the scratch window can never hide a data divergence. Asserted against measured writes.
const DATA_TOP = 0xadff;
const CORPUS_DISPATCHES = 255;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/**
 * Oracle vs candidate on independent clones, diffing RAM outside [lowestSP, seat) — lowestSP
 * measured by watching the oracle's own pushes. Anything outside that window has escaped.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const retOracle = oracle(a);
  let retCand, threw = null;
  try { retCand = cand(b); } catch (e) { threw = String(e).slice(0, 40); }
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = threw ? { addr: null, a: "returned", b: threw } : null;
  for (let i = 0; i < da.length && !escaped; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, a: da[i], b: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, retOracle, retCand };
}

/** Game cells (at or below DATA_TOP) the oracle moves from a state — a path's footprint. */
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

// ── the captured entry and the crafted branch entries ─────────────────────────────────────

let entry = null;
function entryState() {
  if (entry === null) {
    const m = attractMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(ENTRY_FRAMES);
  }
  return entry;
}

function craft(mutate) {
  const m = entryState().clone();
  mutate(m);
  return m;
}

/** One entry per exit: the captured state runs the timer-running arm; the rest are poked in. */
function scenarios() {
  const cd = (m) => (m.regs.ix + COUNTDOWN) & 0xffff;
  return [
    ["captured", craft(() => {})],
    ["odd", craft((m) => { m.mem8[FRAME_TICK] |= 1; })],
    ["timer", craft((m) => { m.mem8[FRAME_TICK] &= ~1; m.mem8[cd(m)] = 3; })],
    ["gated", craft((m) => { m.mem8[FRAME_TICK] &= ~1; m.mem8[cd(m)] = 1; m.mem8[MOTHER_SHIP_ARMED] = 1; })],
    ["arm", craft((m) => { m.mem8[FRAME_TICK] &= ~1; m.mem8[cd(m)] = 1; m.mem8[MOTHER_SHIP_ARMED] = 0; })],
  ];
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every knob matches armBomberSlotWhenTimerFires by default. */
function twin({ hits = 3, live = 0xff, table = EDGE_POSITION_TABLE, snap = true, nudge = true, velocity = true } = {}) {
  return (m) => {
    const { regs, mem8 } = m;
    if (mem8[FRAME_TICK] & 0x01) return;
    const cd = (regs.ix + COUNTDOWN) & 0xffff;
    mem8[cd] = u8(mem8[cd] - 1);
    if (mem8[cd] !== 0) return;
    if (mem8[MOTHER_SHIP_ARMED] !== 0) return;
    const heading = mem8[PLAYER_HEADING];
    let index = heading;
    if (nudge && ((heading + 8) & 0x7f) < 0x10)
      index = u8(heading + (mem8[FRAME_TICK] & 0x08 ? 0x10 : u8(-0x10)));
    regs.hl = table;
    regs.a = ((index >> 2) | (index << 6)) & 0x3e;
    mem8[(regs.iy + 0x31) & 0xffff] = fetchTableByte(m);
    mem8[(regs.iy + 0x00) & 0xffff] = mem8[u16(regs.hl + 1)];
    mem8[(regs.ix + 0x02) & 0xffff] = snap ? (u8(heading + 0xc0) & 0x80) : heading;
    if (velocity) {
      velocityForHeadingAtSlowestSpeed(m);
      mem8[(regs.ix + 0x0a) & 0xffff] = regs.e;
      mem8[(regs.ix + 0x0b) & 0xffff] = regs.d;
      mem8[(regs.ix + 0x0c) & 0xffff] = regs.c;
      mem8[(regs.ix + 0x0d) & 0xffff] = regs.b;
    }
    mem8[BOMBER_HITS_TO_ABSORB] = hits;
    mem8[(regs.ix + 0x00) & 0xffff] = live;
  };
}

const TWINS = [
  ["no-op", () => {}, ["captured", "timer", "gated", "arm"]],
  ["wrong-hits", twin({ hits: 4 }), ["arm"]],
  ["not-live", twin({ live: 0xfe }), ["arm"]],
  ["no-velocity", twin({ velocity: false }), ["arm"]],
  ["wrong-table", twin({ table: 0x3c86 }), ["arm"]],
  ["no-facing-snap", twin({ snap: false }), ["arm"]],
  ["no-quadrant-nudge", twin({ nudge: false }), ["arm"]],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: RAM identical outside the masked stack scratch", { skip }, () => {
  const r = compare(candidate, entryState());
  assert.notEqual(entry, null, "vacuous: attract never reached the routine");
  assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr ?? 0)}`);
  assert.equal(r.retOracle, r.retCand, "the return value diverged");
  console.log(`  EQUAL: window [${hex4(r.low)},${hex4(r.seat)}) masked, spDiff ${r.spDiff}`);
});

test("MASK: on the arm path the window is non-empty, safe, and covers a real oracle-only byte", { skip }, () => {
  const armMachine = scenarios().find(([l]) => l === "arm")[1];
  const r = compare(candidate, armMachine);
  assert.equal(r.escaped, null, "the arm path diverged outside the mask");
  assert.ok(r.low < r.seat, "the arm path pushed nothing, so the mask covers nothing");
  // ★ The mask is safe only if it never covers a data cell: its floor sits above them all.
  assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached into game data`);
  const a = armMachine.clone();
  const b = armMachine.clone();
  oracle(a); candidate(b);
  const da = a.dumpState(), db = b.dumpState();
  let masked = 0;
  for (let i = 0; i < da.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (da[i] !== db[i] && addr >= r.low && addr < r.seat) masked++;
  }
  assert.ok(masked > 0, "the mask covered no divergence, so it is decoration");
  console.log(`  MASK: [${hex4(r.low)},${hex4(r.seat)}) covers ${masked} oracle-only byte(s)`);
});

test("PATHS: every exit is memory-equivalent, and the paths really differ", { skip }, () => {
  const prints = {};
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${label} escaped at ${r.escaped && hex4(r.escaped.addr ?? 0)}`);
    prints[label] = footprint(m).map(hex4).join(",");
    for (const c of footprint(m)) assert.ok(c <= DATA_TOP, `${label} wrote above the mask floor`);
  }
  // ★ Vacuity guard: the arm path must move MORE cells than a bail, or the pokes changed nothing.
  assert.notEqual(prints.arm, prints.timer, "the arm and timer paths move the same cells");
  assert.equal(prints.odd, "", "the odd-frame bail wrote game data");
  console.log(`  PATHS: 5 exits equivalent; arm moves ${prints.arm.split(",").length} cells, timer 1, odd 0`);
});

test("SP: the oracle re-seats two bytes higher on every exit", { skip }, () => {
  for (const [label, m] of scenarios()) {
    assert.equal(compare(candidate, m).spDiff, 2, `${label}: the SP re-seat diverged`);
  }
  console.log("  SP: +2 on every exit");
});

test("CORPUS: every attract dispatch replays identically; the driven tape never reaches it", { skip }, () => {
  const run = (opts) => {
    let dispatched = 0, caught = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => {
      dispatched++;
      if (compare(candidate, mm).escaped) caught++;
      return oracle(mm);
    }]]), opts);
    const frames = m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the run stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, "the run ran short");
    return { dispatched, caught };
  };
  const attract = run({ tape: [] });
  const driven = run({});
  assert.equal(attract.dispatched, CORPUS_DISPATCHES, "the attract dispatch count moved");
  assert.equal(attract.caught, 0, `the rewrite diverged on ${attract.caught} attract dispatches`);
  // ★ Driven zero is a fact, not an untested tap: the SAME probe counted 255 under attract.
  assert.equal(driven.dispatched, 0, "the driven tape now reaches this entry; add a corpus for it");
  console.log(`  CORPUS: ${attract.dispatched} attract dispatches identical, driven ${driven.dispatched}`);
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on EXACTLY the declared exits`, { skip }, () => {
    const caught = scenarios().filter(([, m]) => compare(brokenTwin, m).escaped).map(([l]) => l);
    assert.ok(expected.length > 0, `the ${label} twin is caught nowhere`);
    assert.deepEqual(caught, expected, `the ${label} twin's catch set moved`);
    console.log(`  TEETH/${label}: caught on [${caught.join(",")}]`);
  });
}
