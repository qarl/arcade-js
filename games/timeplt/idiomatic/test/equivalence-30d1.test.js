// SPDX-License-Identifier: GPL-3.0-only
/**
 * setSceneryAttributesThenRunEraScenery — memory-equivalent to the frozen oracle at ROM 0x30D1. The frogger standard
 * applies: every register the body touches is dead-after-return scratch — each returning arm hands
 * on to a callee (seedScenery / runSceneryForEra) that reseats both cursors, and the guard-fail arm
 * transfers into a fault — so RAM is the whole contract and no register is pinned (GENUINE_LIVE_OUTS
 * empty). The real coin/attract dispatch (era below four, into the dissolved seat-and-scenery chain)
 * is compared with the dead six-byte stack scratch masked and the two-byte drift asserted; crafted
 * era-four entries drive the scenery arm and the guard-fail arm that transfers into a data table and
 * faults, where equivalence is a matching fault over identical RAM; corpus over two tapes, and teeth,
 * with a scratch-not-pinned control beside the RAM measurement.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-30d1.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { setSceneryAttributesThenRunEraScenery as candidate } from "../setSceneryAttributesThenRunEraScenery.js";
import { loc_30d1 as oracle } from "../../translated/loc_30d1.js";
import { seedSceneryEntriesThenRunScenery } from "../seedSceneryEntriesThenRunScenery.js";
import { loc_315b } from "../loc_315b.js";
import { runSceneryForEra } from "../runSceneryForEra.js";

const TARGET = 0x30d1;
const G1 = 0xacc7;
const G2 = 0xacc8;
const GUARD_OK = 0x3b;
const SUB_A = 0x05;
const SUB_B = 0x10;
const ERA_FOUR = 4;
const SEAT_CELL = 0xaa30;
/** Every game cell any path writes lands at or below here; the stack seats far above it. */
const DATA_TOP = 0xadff;
const SEAT_DRIFT = 2;
const CORPUS_FRAMES = 2000;
const DISPATCHES = { coin: 3, attract: 1 };
const SCRIBBLE_CELL = 0xa5af; // a compared (non-stack) cell the teeth flip to prove the RAM measurement bites

/** The frogger standard: RAM (masked over the frozen side's stack scratch) is the contract, and only
 *  genuine named register live-outs are pinned beside it. This routine has none — every returning arm
 *  hands on to a callee that reseats both cursors, so the body's registers are dead-after-return
 *  scratch and the set is empty. */
const GENUINE_LIVE_OUTS = [];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${d.addr == null ? "reg" : hex4(d.addr)}: frozen=${d.a} rewrite=${d.b}` : "identical");

// ── the masked comparison (frogger standard) ────────────────────────────────────────────────────

/**
 * Oracle vs candidate on independent clones. Both dissolved arms drop a ROM ret and scramble the
 * scratch registers, so RAM is diffed outside [low, seat) — low measured by watching the oracle's
 * own pushes — throw-agreement is required so the fault arm counts as equal only when both faults
 * land on identical RAM, and only genuine register live-outs are pinned (none here). RAM is compared
 * even when both faulted, so a fill run that differs before the fault is still caught.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  let threwA = false;
  let threwB = false;
  try { oracle(a); } catch { threwA = true; }
  try { cand(b); } catch { threwB = true; }
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, a: da[i], b: db[i] };
  }
  const throwMismatch = threwA !== threwB ? { addr: null, a: threwA ? "threw" : "returned", b: threwB ? "threw" : "returned" } : null;
  let liveOut = null;
  if (!threwA && !threwB) {
    for (const k of GENUINE_LIVE_OUTS) {
      if (a.regs[k] !== b.regs[k]) { liveOut = { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` }; break; }
    }
  }
  return { escaped, throwMismatch, liveOut, spDiff: a.regs.sp - b.regs.sp, low, seat, threw: threwA };
}
const caught = (r) => r.escaped !== null || r.throwMismatch !== null || r.liveOut !== null;

/** What the oracle leaves in every game cell it moves — addr=value pairs, so two arms that touch
 * the same cells with different bytes still read as different footprints. */
function footprint(machine) {
  const a = machine.clone();
  const before = a.dumpState().slice();
  try { oracle(a); } catch { /* the fault arm still wrote its fill run before faulting */ }
  const now = a.dumpState();
  const cells = [];
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && addr <= DATA_TOP) cells.push(`${addr}=${now[i]}`);
  }
  return cells;
}

// ── the captured entry, and the crafted era-four entries ──────────────────────────────────

let entry = null;
function seatEntry() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(ENTRY_FRAMES);
  }
  return entry;
}

/** The natural dispatch always carries era below four, so the era-four arms are reached by poking
 * the era register the routine branches on and the two work-RAM guards the deeper arm reads. */
function craft(mutate) {
  const m = seatEntry().clone();
  mutate(m);
  return m;
}
const scenarios = () => [
  { tag: "A-captured", m: seatEntry(), faults: false },
  { tag: "B-scenery-10", m: craft((m) => { m.regs.c = ERA_FOUR; m.mem8[G1] = GUARD_OK; m.mem8[G2] = SUB_B; }), faults: false },
  { tag: "B-scenery-05", m: craft((m) => { m.regs.c = ERA_FOUR; m.mem8[G1] = GUARD_OK; m.mem8[G2] = SUB_A; }), faults: false },
  { tag: "C-fault-g1", m: craft((m) => { m.regs.c = ERA_FOUR; m.mem8[G1] = 0x00; }), faults: true },
  { tag: "C-fault-g2", m: craft((m) => { m.regs.c = ERA_FOUR; m.mem8[G1] = GUARD_OK; m.mem8[G2] = 0x99; }), faults: true },
];

// ── twins ─────────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every parameter matches setSceneryAttributesThenRunEraScenery by default, and
 * each twin dissolves to the same callees so only the named defect can move the comparison. */
function variant({ fillStride = 2, fillCount = 8, eraFloor = 4, guardOk = 0x3b, subA = 0x05, subB = 0x10, seatTable = 0x315e, seatCount = 8, seatStride = 2, transfer = true } = {}) {
  return (m) => {
    const { regs, mem8 } = m;
    regs.hl = 0xaa60;
    regs.de = fillStride;
    regs.b = fillCount;
    do { mem8[regs.hl] = regs.a; regs.hl = (regs.hl + regs.de) & 0xffff; regs.b = (regs.b - 1) & 0xff; } while (regs.b !== 0);
    regs.a = regs.c;
    regs.cp(eraFloor);
    if (regs.fC) return seedSceneryEntriesThenRunScenery(m);
    regs.hl = G1;
    regs.a = mem8[regs.hl];
    regs.cp(guardOk);
    if (regs.fNZ) return loc_315b(m);
    regs.hl = (regs.hl + 1) & 0xffff;
    regs.a = mem8[regs.hl];
    regs.cp(subA);
    if (regs.fNZ) { regs.cp(subB); if (regs.fNZ) return loc_315b(m); }
    regs.b = seatCount;
    regs.iy = SEAT_CELL;
    regs.hl = seatTable;
    do {
      regs.a = mem8[regs.hl];
      mem8[(regs.iy + 0x31) & 0xffff] = regs.a;
      regs.hl = (regs.hl + 1) & 0xffff;
      regs.a = mem8[regs.hl];
      mem8[regs.iy & 0xffff] = regs.a;
      regs.hl = (regs.hl + 1) & 0xffff;
      regs.iy = (regs.iy + seatStride) & 0xffff;
      regs.b = (regs.b - 1) & 0xff;
    } while (regs.b !== 0);
    if (transfer) return runSceneryForEra(m);
  };
}

// ── scratch-not-pinned controls: a register-only twin passes by design; RAM still bites ──────────
const scribbleScratchReg = (m) => { candidate(m); m.regs.b = (m.regs.b + 1) & 0xff; };
const scribbleData = (m) => { candidate(m); m.mem8[SCRIBBLE_CELL] ^= 0xff; };

const TWINS = [
  ["no-op", () => {}, 5],
  ["fill-stride-1", variant({ fillStride: 1 }), 5],
  ["era-floor-5", variant({ eraFloor: 5 }), 4],
  ["guard-ok-3a", variant({ guardOk: 0x3a }), 2],
  ["sub-a-06", variant({ subA: 0x06 }), 1],
  ["seat-stride-1", variant({ seatStride: 1 }), 2],
  ["no-transfer", variant({ transfer: false }), 2],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the six-byte scratch window", { skip }, () => {
  assert.notEqual(seatEntry(), null, "vacuous: the tape never reached the routine");
  const r = compare(candidate, seatEntry());
  assert.equal(r.escaped, null, `a divergence escaped the scratch window — ${show(r.escaped)}`);
  assert.equal(r.throwMismatch, null, `one side faulted and the other did not — ${show(r.throwMismatch)}`);
  assert.equal(r.liveOut, null, `a pinned live-out diverged — ${show(r.liveOut)}`);
  assert.equal(r.spDiff, SEAT_DRIFT, "the dropped chain return no longer moves the pointer");
  // ★ The mask is safe only because its floor sits above every game cell any path writes.
  assert.ok(r.low > DATA_TOP, `the scratch floor ${hex4(r.low)} reached into game data`);
  console.log(`  EQUAL: sp=${hex4(r.seat)} window=[${hex4(r.low)},${hex4(r.seat)}) spDiff ${r.spDiff}`);
});

test("PATHS: the scenery arm and the fault arm are each equivalent, and really differ", { skip }, () => {
  const prints = {};
  for (const { tag, m, faults } of scenarios()) {
    const r = compare(candidate, m);
    assert.ok(!caught(r), `${tag} diverged — ${show(r.escaped ?? r.throwMismatch ?? r.liveOut)}`);
    if (!faults) assert.equal(r.spDiff, SEAT_DRIFT, `${tag}: the dropped chain return no longer drifts by two`);
    // ★ Vacuity: the crafted era-four arms really fault (or seat) as their tag claims, not silently
    //   fall back to the captured arm's path.
    let threw = false;
    const probe = m.clone();
    try { oracle(probe); } catch { threw = true; }
    assert.equal(threw, faults, `${tag}: the oracle ${threw ? "faulted" : "returned"}, against the tag`);
    prints[tag] = footprint(m).join(",");
  }
  assert.notEqual(prints["A-captured"], prints["B-scenery-10"], "the seat arm and the scenery arm move the same cells");
  console.log(`  PATHS: 5 scenarios equivalent; scenery moves ${prints["B-scenery-10"].split(",").length} cells`);
});

test("CORPUS: every dispatch of two tapes replays, and all carry era below four", { skip }, () => {
  const run = (opts) => {
    let dispatched = 0;
    let missed = 0;
    let eraFour = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => {
      dispatched++;
      if (mm.regs.c >= ERA_FOUR) eraFour++;
      if (caught(compare(candidate, mm))) missed++;
      return oracle(mm);
    }]]), opts);
    const frames = m.runFrames(CORPUS_FRAMES);
    assert.equal(m.stoppedBy, null, `the run stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, CORPUS_FRAMES, "the run ran short");
    return { dispatched, missed, eraFour };
  };
  const coin = run({});
  const attract = run({ tape: [] });
  assert.equal(coin.dispatched, DISPATCHES.coin, "the coin-start dispatch count moved");
  assert.equal(attract.dispatched, DISPATCHES.attract, "the attract dispatch count moved");
  assert.ok(attract.dispatched > 0, "vacuous: attract never reached the routine");
  assert.equal(coin.missed + attract.missed, 0, "the rewrite diverged on a real dispatch");
  assert.equal(coin.eraFour + attract.eraFour, 0, "a natural dispatch now carries era four, so the era-four arms are no longer crafted-only");
  console.log(`  CORPUS: coin ${coin.dispatched}, attract ${attract.dispatched}, all era below four, identical`);
});

test("SCRATCH NOT PINNED: a register-only twin passes; a RAM scribble is caught", { skip }, () => {
  // No genuine register live-outs, so a twin that only scribbles a scratch register after the routine
  // is DELIBERATELY not flagged — and the same measurement must still catch a scribbled RAM cell, or
  // the clean read on the register twin would be worthless. Runs on the returning (non-fault) arms.
  const states = scenarios().filter((s) => !s.faults).map((s) => s.m);
  for (const s of states) {
    assert.ok(!caught(compare(scribbleScratchReg, s)),
      "a scratch-register scribble was flagged, but this routine has no genuine register live-outs to pin");
    const r = compare(scribbleData, s);
    assert.ok(caught(r), "the RAM measurement missed a scribbled cell, so it has no teeth");
    assert.notEqual(r.escaped, null, "the RAM scribble must be caught on a cell, not a register");
  }
  console.log(`  SCRATCH NOT PINNED: register twin ignored; RAM twin caught on all ${states.length}`);
});

for (const [label, twin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT on an exact count of scenarios`, { skip }, () => {
    let n = 0;
    for (const { m } of scenarios()) if (caught(compare(twin, m))) n++;
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(n, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${n} of ${scenarios().length} scenarios`);
  });
}

// ── the guard-fail divert below era four ────────────────────────────────────────────────────
// Below era four the seed step's own guard (TAMPER_WITNESS 0xAD39, then 0xAD3A) diverts through
// 0x3114 into 0x307F, which stores E through the witness pointer, counts B down and places one tile
// through IY offset by C. This routine is what leaves E (its clear stride, low byte of DE = 2) and B
// (its spent clear count, 0) standing for that divert -- the rewrite hands both on as arguments,
// with the era and cursor it was given. MAME at 0x3117: DE = 0x0002, B = 0 at every fetch.

const WITNESS = 0xad39;
const divertEntries = () => [
  ["witness-byte0", craft((m) => { m.mem8[WITNESS] = 0x00; })],
  ["witness-byte1", craft((m) => { m.mem8[WITNESS + 1] = 0x07; })],
];

/** BUG: hands the divert a stride of 1, not the clear loop's 2. */
function brokenDivertStride(m, fillByte = m.regs.a, era = m.regs.c, entryCursor = m.regs.iy) {
  let clearAddr = 0xaa60;
  for (let n = 8; n !== 0; n--) {
    m.mem8[clearAddr] = fillByte;
    clearAddr = (clearAddr + 2) & 0xffff;
  }
  if (era < ERA_FOUR) return seedSceneryEntriesThenRunScenery(m, era, entryCursor, 1, 0);
  return candidate(m, fillByte, era, entryCursor);
}

test("DIVERT: a failed seed guard below era four diverts identically, with the clear loop's stride and count", { skip }, () => {
  for (const [tag, m] of divertEntries()) {
    assert.ok(m.regs.c < ERA_FOUR, `${tag}: the captured entry is not below era four`);
    const r = compare(candidate, m);
    assert.ok(!caught(r), `${tag} diverged — ${show(r.escaped ?? r.throwMismatch ?? r.liveOut)}`);
    // Vacuity: the divert really ran -- the witness cell took the stride (2), the seat never happened.
    const probe = m.clone();
    oracle(probe);
    assert.equal(probe.mem8[tag === "witness-byte0" ? WITNESS : WITNESS + 1], 2, `${tag}: the oracle did not divert`);
    // Teeth: the wrong stride is caught on the same entry.
    assert.ok(caught(compare(brokenDivertStride, m)), `${tag}: a divert handed the wrong stride passed`);
  }
  console.log("  DIVERT: both witness cells divert identically; a wrong-stride hand-on is caught");
});
