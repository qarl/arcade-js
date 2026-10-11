// SPDX-License-Identifier: GPL-3.0-only
/**
 * seatEraSceneryRowThenClearAndRunScenery — memory-equivalent to the frozen oracle at ROM 0x30A5. The real coin dispatch is
 * compared with the dead stack scratch masked and the two-byte tail drift asserted; a crafted era-
 * four entry drives the other branch; the seated stride-two run is read back; and teeth, with a
 * scratch-not-pinned control beside the RAM measurement. The frogger standard: the dropped tail chain
 * scrambles the scratch registers and reseats its own cursors, so RAM (masked over the stack) is the
 * whole contract and no register is pinned (GENUINE_LIVE_OUTS empty).
 * Run: node --test games/timeplt/idiomatic/test/equivalence-30a5.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { seatEraSceneryRowThenClearAndRunScenery as candidate } from "../seatEraSceneryRowThenClearAndRunScenery.js";
import { loc_30a5 as oracle } from "../../translated/loc_30a5.js";
import { sumByteRunAndCompareToExpected } from "../sumByteRunAndCompareToExpected.js";
import { offsetAddress } from "../offsetAddress.js";
import { seatFinalEraSceneryFillThenClearEraScenery } from "../seatFinalEraSceneryFillThenClearEraScenery.js";
import { clearSceneryEntriesThenRunEraScenery } from "../clearSceneryEntriesThenRunEraScenery.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x30a5;
const ERA_INDEX = 0xad04;
const ROW_TABLE = 0x3176;
const ROW_STRIDE = 8;
const SEAT_BASE = 0xaa31;
const SEAT_STRIDE = 2;
const SEAT_COUNT = 8;
const ERA_FOUR = 4;
const FILL_BYTE = 0xcc;
const GUARD = 0xacc7;
const SUBGUARD = 0xacc8;
const GUARD_OK = 0x3b;
const SUBGUARD_OK = 0x10;
/** Every game cell any path writes lands at or below here; the stack seats far above it. */
const DATA_TOP = 0xadff;
const TAIL_DRIFT = 2;
const SCRIBBLE_CELL = 0xa5af; // a compared (non-stack) cell the teeth flip to prove the RAM measurement bites

/** The frogger standard: RAM (masked over the frozen side's stack scratch) is the contract, and only
 *  genuine named register live-outs are pinned beside it. This routine has none — it tail-transfers
 *  into the scenery chain and never returns to its own caller, which reseats A and HL fresh right
 *  after the call; the era rides into the chain seated in C as a callee input, not a live-out. */
const GENUINE_LIVE_OUTS = [];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${d.addr == null ? "reg" : hex4(d.addr)}: frozen=${d.a} rewrite=${d.b}` : "identical");

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/**
 * Oracle vs candidate on independent clones. Both drop the ROM's tail return and its two internal
 * call frames, so RAM is diffed outside [low, seat) — low watched off the oracle's own pushes —
 * throw-agreement is required, only genuine register live-outs are pinned (none here), and the
 * two-byte pointer drift is returned.
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
  const throwMismatch = threwA !== threwB ? { addr: null, a: threwA ? "threw" : "ret", b: threwB ? "threw" : "ret" } : null;
  let liveOut = null;
  if (!threwA && !threwB) {
    for (const k of GENUINE_LIVE_OUTS) {
      if (a.regs[k] !== b.regs[k]) { liveOut = { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` }; break; }
    }
  }
  return { escaped, throwMismatch, liveOut, spDiff: a.regs.sp - b.regs.sp, low, seat };
}
const caught = (r) => r.escaped !== null || r.throwMismatch !== null || r.liveOut !== null;

/** Addr=value pairs of every game cell the oracle moves from this entry. */
function footprint(machine) {
  const a = machine.clone();
  const before = a.dumpState().slice();
  try { oracle(a); } catch { /* keep what a fault arm wrote */ }
  const now = a.dumpState();
  const cells = [];
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && addr <= DATA_TOP) cells.push(`${addr}=${now[i]}`);
  }
  return cells;
}

// ── the captured entry and the crafted era-four entry ─────────────────────────────────────

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

/** The natural dispatch carries era below four; the other branch is reached by poking the era and
 * the two guards the deeper arm reads so it seats and runs the scenery rather than faulting. */
function craftEraFour() {
  const m = seatEntry().clone();
  m.mem8[ERA_INDEX] = ERA_FOUR;
  m.mem8[GUARD] = GUARD_OK;
  m.mem8[SUBGUARD] = SUBGUARD_OK;
  return m;
}

// ── twins ───────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every twin dissolves to the same callees so only
 * the named defect can move the comparison. */
function variant({ rowTable = ROW_TABLE, rowStride = ROW_STRIDE, seatBase = SEAT_BASE, seatStride = SEAT_STRIDE, seatCount = SEAT_COUNT, honourEraFour = true, fillByte = FILL_BYTE, transfer = true } = {}) {
  return (m) => {
    const { regs, mem8 } = m;
    regs.hl = 0x086b;
    regs.c = 0x22;
    regs.b = 0x10;
    sumByteRunAndCompareToExpected(m);
    regs.a = u8(mem8[ERA_INDEX] * rowStride);
    regs.c = regs.a;
    regs.hl = rowTable;
    offsetAddress(m);
    regs.de = seatBase;
    regs.b = seatCount;
    do {
      regs.a = mem8[regs.hl];
      mem8[regs.de] = regs.a;
      regs.hl = u16(regs.hl + 1);
      regs.de = u16(regs.de + seatStride);
      regs.b = u8(regs.b - 1);
    } while (regs.b !== 0);
    regs.a = mem8[ERA_INDEX];
    regs.cp(ERA_FOUR);
    regs.c = regs.a;
    if (honourEraFour && regs.fZ) return seatFinalEraSceneryFillThenClearEraScenery(m);
    regs.a = fillByte;
    if (transfer) return clearSceneryEntriesThenRunEraScenery(m);
  };
}

const NATURAL_TWINS = [
  ["no-op", () => {}],
  ["seat-base-off", variant({ seatBase: 0xaa30 })],
  ["seat-stride-1", variant({ seatStride: 1 })],
  ["row-table-off", variant({ rowTable: ROW_TABLE + 1 })],
  ["fill-byte-cd", variant({ fillByte: 0xcd })],
  ["no-transfer", variant({ transfer: false })],
];
const ERAFOUR_TWINS = [
  ["era-four-byte", variant({ honourEraFour: false })],
];

// ── the gate ──────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the stack scratch, drift asserted", { skip }, () => {
  assert.notEqual(seatEntry(), null, "vacuous: the tape never reached the routine");
  const r = compare(candidate, seatEntry());
  assert.equal(r.escaped, null, `a divergence escaped the scratch window — ${show(r.escaped)}`);
  assert.equal(r.throwMismatch, null, `one side faulted and the other did not — ${show(r.throwMismatch)}`);
  assert.equal(r.liveOut, null, `a pinned live-out diverged — ${show(r.liveOut)}`);
  assert.equal(r.spDiff, TAIL_DRIFT, "the dropped tail return no longer moves the pointer by two");
  // ★ The mask is safe only because its floor sits above every game cell any path writes.
  assert.ok(r.low > DATA_TOP, `the scratch floor ${hex4(r.low)} reached into game data`);
  console.log(`  EQUAL: sp=${hex4(r.seat)} window=[${hex4(r.low)},${hex4(r.seat)}) spDiff ${r.spDiff}`);
});

test("PATHS: the natural branch and the era-four branch are each equivalent and really differ", { skip }, () => {
  for (const [tag, m] of [["natural", seatEntry()], ["era-four", craftEraFour()]]) {
    const r = compare(candidate, m);
    assert.ok(!caught(r), `${tag} diverged — ${show(r.escaped ?? r.throwMismatch ?? r.liveOut)}`);
    assert.equal(r.spDiff, TAIL_DRIFT, `${tag}: the dropped tail return no longer drifts by two`);
  }
  assert.notEqual(footprint(seatEntry()).join(","), footprint(craftEraFour()).join(","),
    "the two branches move the same cells, so the era-four arm is not exercised");
  console.log(`  PATHS: natural moves ${footprint(seatEntry()).length} cells, era-four ${footprint(craftEraFour()).length}`);
});

test("SEAT LANDS: the era row is copied into the stride-two run and survives the tail", { skip }, () => {
  const m = seatEntry().clone();
  const era = m.mem8[ERA_INDEX];
  const rowBase = u16(ROW_TABLE + era * ROW_STRIDE);
  const wanted = [];
  for (let i = 0; i < SEAT_COUNT; i++) wanted.push(m.mem8[u16(rowBase + i)]);
  candidate(m);
  const got = [];
  for (let i = 0; i < SEAT_COUNT; i++) got.push(m.mem8[u16(SEAT_BASE + i * SEAT_STRIDE)]);
  assert.deepEqual(got, wanted, "the seated run does not hold the era's table row");
  console.log(`  SEAT LANDS: era ${era} row ${wanted.join(",")} at ${hex4(SEAT_BASE)} stride ${SEAT_STRIDE}`);
});

for (const [label, twin] of NATURAL_TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT at the natural dispatch`, { skip }, () => {
    const r = compare(twin, seatEntry());
    assert.ok(caught(r), `the gate PASSED the ${label} twin — it has no teeth outside the mask`);
    console.log(`  TEETH/${label}: caught — ${show(r.escaped ?? r.throwMismatch ?? r.liveOut)}`);
  });
}

for (const [label, twin] of ERAFOUR_TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT at the era-four branch`, { skip }, () => {
    const r = compare(twin, craftEraFour());
    assert.ok(caught(r), `the gate PASSED the ${label} twin — the era-four branch has no teeth`);
    console.log(`  TEETH/${label}: caught — ${show(r.escaped ?? r.throwMismatch ?? r.liveOut)}`);
  });
}

// ── scratch-not-pinned control: a register-only twin passes by design; RAM still bites ──────
const scribbleScratchReg = (m) => { candidate(m); m.regs.b = (m.regs.b + 1) & 0xff; };
const scribbleData = (m) => { candidate(m); m.mem8[SCRIBBLE_CELL] ^= 0xff; };

test("SCRATCH NOT PINNED: a register-only twin passes; a RAM scribble is caught", { skip }, () => {
  // No genuine register live-outs, so a twin that only scribbles a scratch register after the routine
  // is DELIBERATELY not flagged — and the same measurement must still catch a scribbled RAM cell, or
  // the clean read on the register twin would be worthless. Runs on both returning arms.
  for (const m of [seatEntry(), craftEraFour()]) {
    assert.ok(!caught(compare(scribbleScratchReg, m)),
      "a scratch-register scribble was flagged, but this routine has no genuine register live-outs to pin");
    const r = compare(scribbleData, m);
    assert.ok(caught(r), "the RAM measurement missed a scribbled cell, so it has no teeth");
    assert.notEqual(r.escaped, null, "the RAM scribble must be caught on a cell, not a register");
  }
  console.log("  SCRATCH NOT PINNED: register twin ignored; RAM twin caught on both arms");
});

// ── the guard-fail divert, through the entry cursor the caller leaves ──────────────────────────
// Below era four the seed step's guard (TAMPER_WITNESS 0xAD39, then 0xAD3A) diverts into 0x307F,
// which places one tile through IY -- a register this routine never sets, left standing by its one
// caller (0x19F0 loads IY = 0xAA28, ERA_OBJECT_ENTRY_SLOT0, at 0x1A77 and clears through it just
// before the call; MAME at 0x3117: IY = 0xAA28 at every fetch). The rewrite takes it as an argument
// defaulting to that cursor.

const WITNESS = 0xad39;
const CALLER_CURSOR = 0xaa28;

test("DIVERT: a failed seed guard diverts identically through the caller's entry cursor", { skip }, () => {
  assert.equal(seatEntry().regs.iy, CALLER_CURSOR, "the real dispatch does not arrive with the caller's cursor in IY");
  for (const [tag, poke] of [["witness-byte0", (m) => { m.mem8[WITNESS] = 0x00; }], ["witness-byte1", (m) => { m.mem8[WITNESS + 1] = 0x07; }]]) {
    const m = seatEntry().clone();
    poke(m);
    const r = compare(candidate, m);
    assert.ok(!caught(r), `${tag} diverged — ${show(r.escaped ?? r.throwMismatch ?? r.liveOut)}`);
    assert.notEqual(footprint(m).join(","), footprint(seatEntry()).join(","), `${tag}: the divert moved the same cells as the seat`);
    // Teeth: a divert through a cursor one entry on is caught.
    assert.ok(caught(compare((mm) => candidate(mm, CALLER_CURSOR + 2), m)), `${tag}: a wrong cursor passed`);
  }
  console.log("  DIVERT: both witness cells divert identically through 0xaa28; a wrong cursor is caught");
});
