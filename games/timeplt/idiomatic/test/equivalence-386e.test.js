// SPDX-License-Identifier: GPL-3.0-only
/**
 * spawnEnemyWaveIntoFreeSlots — memory-equivalent to the frozen oracle at ROM 0x386E.
 * GATE: crafted-entry; states captured at the caller (real in-distribution), plus an exhaustive
 *   sweep of the bank's free/busy occupancy and crafted count/armed entries. RAM compared with the
 *   dead stack scratch below the seated SP masked out (the dissolved callees push/pop where the
 *   rewrite does not) and the SP re-seat asserted; registers are not compared, as the dissolved
 *   callees do not reproduce the register dance and the exit stores its product to memory. Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-386e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { spawnEnemyWaveIntoFreeSlots as candidate } from "../spawnEnemyWaveIntoFreeSlots.js";
import { loc_386e as oracle } from "../../translated/loc_386e.js";
import { loc_36af as caller } from "../../translated/loc_36af.js";
import { drawRandomByte } from "../drawRandomByte.js";
import { fetchTableByte } from "../fetchTableByte.js";
import { stepCraftFlightScript } from "../stepCraftFlightScript.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x386e;
const CALLER = 0x36af;
const SLOT_BANK = 0xa850;
const ENTRY_BANK = 0xaa1a;
const CONFIGURED_COUNT = 0xacc1;
const MOTHER_SHIP_ARMED = 0xad0d;
const SLOT_STRIDE = 0x10;
const DEFAULT_COUNT = 5;
const SHAPE_TABLE = 0x3a3b;
const ORDINAL_TABLE = 0x38d2;
const STATUS_CELL = 0xa812;
const STATUS_VALUE = 0xe4;

// Every write lands at or below here; the stack seats far above it, so masking the scratch window
// can never hide a game-data divergence. Asserted against the measured floor in CAPTURED.
const DATA_TOP = 0xadff;
const OCCUPANCY_PATTERNS = 1 << DEFAULT_COUNT;
const CAP_LIMIT = 150;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

/**
 * Oracle vs a candidate on independent clones. The oracle brackets its dissolved calls with
 * pushes the rewrite never makes, so the diff excludes [low, seat) — low measured by watching the
 * oracle's own pushes. Anything outside that window has escaped.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
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

/** Cells the oracle moves from a state, ignoring the stack scratch — the pass's footprint. */
function footprint(machine) {
  const a = machine.clone();
  const before = a.dumpState().slice();
  oracle(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) {
    if (now[i] !== before[i] && a.stateOffsetToAddr(i) <= DATA_TOP) n++;
  }
  return n;
}

// ── captured states, from the caller ──────────────────────────────────────────────────────

let caps = null;
function captureCaller() {
  if (caps) return caps;
  const entries = [];
  const m = makeMachine(new Map([[CALLER, (mm) => {
    if (entries.length < CAP_LIMIT) entries.push(mm.clone());
    return caller(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
  assert.ok(entries.length > 0, "vacuous: the caller was never dispatched, so nothing to craft from");
  caps = entries;
  return caps;
}

function base() {
  return captureCaller()[0];
}

/** A captured state with the five slot heads set free or busy by the mask. */
function craftOccupancy(mask) {
  const m = base().clone();
  for (let i = 0; i < DEFAULT_COUNT; i++) {
    m.mem8[SLOT_BANK + i * SLOT_STRIDE] = (mask >> i) & 1 ? 0xff : 0;
  }
  return m;
}

/** A captured state with a chosen count and armed, and the bank forced all-free. */
function craftCount(configured, armed) {
  const m = base().clone();
  m.mem8[CONFIGURED_COUNT] = configured;
  m.mem8[MOTHER_SHIP_ARMED] = armed;
  for (let i = 0; i < 8; i++) m.mem8[SLOT_BANK + i * SLOT_STRIDE] = 0;
  return m;
}

function sweepOccupancy(cand) {
  let caught = 0;
  for (let mask = 0; mask < OCCUPANCY_PATTERNS; mask++) {
    if (compare(cand, craftOccupancy(mask)).escaped) caught++;
  }
  return caught;
}

// ── twins ───────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every knob matches spawnEnemyWaveIntoFreeSlots by default. */
function twin({ status = true, shapeTable = SHAPE_TABLE, ordinalTable = ORDINAL_TABLE,
  isFree = (h) => h === 0, step = true } = {}) {
  return (m) => {
    const { regs, mem8 } = m;
    const configured = mem8[CONFIGURED_COUNT];
    const count = mem8[MOTHER_SHIP_ARMED] === 0 ? configured : DEFAULT_COUNT;
    let slot = SLOT_BANK, entry = ENTRY_BANK, remaining = count;
    do {
      if (isFree(mem8[slot])) {
        regs.a = drawRandomByte(m) & 0xfc;
        regs.hl = shapeTable;
        const shapeIndex = fetchTableByte(m);
        const record = regs.hl;
        mem8[entry + 0x31] = shapeIndex;
        mem8[entry] = mem8[record + 1];
        const slotField = mem8[record + 2];
        mem8[slot + 0x01] = slotField;
        mem8[slot + 0x02] = slotField;
        regs.a = u8(configured - remaining);
        regs.hl = ordinalTable;
        mem8[slot + 0x0a] = fetchTableByte(m);
        mem8[slot + 0x09] = 0x20;
        regs.ix = slot;
        if (step) stepCraftFlightScript(m);
        mem8[slot + 0x04] = 0x01;
        mem8[slot + 0x0e] = 0x00;
        mem8[slot] = mem8[slot] - 1;
      }
      slot = u16(slot + SLOT_STRIDE);
      entry = u16(entry + 2);
      remaining = u8(remaining - 1);
    } while (remaining !== 0);
    if (status) mem8[STATUS_CELL] = STATUS_VALUE;
  };
}

const TWINS = [
  ["no-op", () => {}, OCCUPANCY_PATTERNS],
  ["skip-status", twin({ status: false }), OCCUPANCY_PATTERNS],
  ["wrong-shape", twin({ shapeTable: SHAPE_TABLE + 1 }), OCCUPANCY_PATTERNS - 1],
  ["wrong-ordinal", twin({ ordinalTable: ORDINAL_TABLE + 1 }), OCCUPANCY_PATTERNS - 1],
  ["spawn-busy", twin({ isFree: (h) => h !== 0 }), OCCUPANCY_PATTERNS],
  ["skip-step", twin({ step: false }), OCCUPANCY_PATTERNS - 1],
];

// ── the gate ──────────────────────────────────────────────────────────────────────────────

test("UNREACHED: neither tape dispatches this address, with the caller as a live control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    const seen = { [TARGET]: 0, [CALLER]: 0 };
    const m = makeMachine(new Map([
      [TARGET, (mm) => { seen[TARGET]++; return oracle(mm); }],
      [CALLER, (mm) => { seen[CALLER]++; return caller(mm); }],
    ]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // The zero counts only because the same tap counted the caller in the same run.
    assert.ok(seen[CALLER] > 0, `the ${label} run counted nothing at the caller, so the tap is blind`);
    assert.equal(seen[TARGET], 0, `${label} now dispatches this address; capture plain entries instead`);
    console.log(`  UNREACHED: ${label} — ${hex4(TARGET)} ${seen[TARGET]}, caller ${seen[CALLER]}`);
  }
});

test("CAPTURED: every state captured at the caller is equivalent, and the mask sits above data",
  { skip }, () => {
    let low = 0xffff;
    for (const e of captureCaller()) {
      const r = compare(candidate, e);
      assert.equal(r.escaped, null, r.escaped && `escaped at ${hex4(r.escaped.addr)}`);
      assert.equal(r.spDiff, 2, "the oracle pops a return address and the rewrite does not");
      assert.equal(r.retOracle, r.retCand, "the return value diverged");
      if (r.low < low) low = r.low;
    }
    assert.ok(low > DATA_TOP, `the stack window ${hex4(low)} reached down into game data`);
    console.log(`  CAPTURED: ${captureCaller().length} states equivalent; window floor ${hex4(low)}`);
  });

test("OCCUPANCY: all 32 free/busy patterns of the bank are equivalent", { skip }, () => {
  assert.equal(sweepOccupancy(candidate), 0, "an occupancy pattern diverged");
  const allFree = footprint(craftOccupancy(0));
  const allBusy = footprint(craftOccupancy(OCCUPANCY_PATTERNS - 1));
  assert.notEqual(allFree, allBusy, "a full and an empty bank move the same cells; the sweep is blind");
  console.log(`  OCCUPANCY: 32 patterns equivalent; all-free ${allFree} cells, all-busy ${allBusy}`);
});

test("COUNT: crafted count/armed entries are equivalent, and the count really drives the pass",
  { skip }, () => {
    for (const [c, armed] of [[3, 0], [5, 0], [7, 0], [3, 1]]) {
      assert.equal(compare(candidate, craftCount(c, armed)).escaped, null, `count ${c} armed ${armed} diverged`);
    }
    const short = footprint(craftCount(3, 0));
    const full = footprint(craftCount(5, 0));
    const forced = footprint(craftCount(3, 1));
    assert.notEqual(short, full, "a 3-count and a 5-count pass move the same cells; count is not read");
    assert.notEqual(short, forced, "the armed cell does not override the count to five");
    console.log(`  COUNT: equivalent; count-3 ${short} cells, count-5 ${full}, armed-forced ${forced}`);
  });

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of patterns`, { skip }, () => {
    const caught = sweepOccupancy(brokenTwin);
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught}/${OCCUPANCY_PATTERNS} patterns`);
  });
}
