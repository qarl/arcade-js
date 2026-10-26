// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_32bd (ROM 0x32BD) — a three-way object-walker dispatch keyed on the
 * current board: BOARD == 1 -> loc_342c, BOARD == 2 -> loc_3478, anything else -> loc_34b9.
 *
 * loc_32bd's own logic is JUST the dispatch — it reads BOARD once and picks one of three arms
 * with no range check. All memory effect is whatever the chosen callee writes to the object
 * record the caller points at (IX). The three callees are ALREADY idiomatic and each proven
 * memory-equivalent to its own frozen oracle, so this gate is a COMPOSITION check: loc_32bd's
 * selector, wired to the real idiomatic callees, must reproduce the frozen oracle sub_32bd
 * (whose per-arm `push16`/`call`/`ret` bracket dispatches to the translated callees).
 *
 * STACK-SCRATCH EXCLUSION (required). The oracle brackets each arm with `push16` + `ret`, so it
 * WRITES the stack; loc_32bd models no stack (three direct JS calls). With SP pointed into the
 * stack region the oracle's churn lands entirely in the dead STACK_SCRATCH [0x6be0,0x6c00), so
 * the memory-equivalence contract is RAM − the stack scratch below the entry SP. pc/SP are NOT compared: live-out is
 * memory-only (the oracle's residual registers/flags and its per-arm terminal ret are dead ABI
 * — the callees' own tests establish their register live-out is dead, and this routine only
 * passes it through).
 *
 * The dispatch is the only logic, so the whole input space is BOARD (0..255). The two factored
 * sweeps run every board value against the oracle on bases where the three arms leave DISTINCT
 * record footprints, so a wrong-arm dispatch necessarily diverges:
 *   FRESH  — saved walk pointer 0 (each walker initialises), MARIO_X bit7 clear, SPIN_COUNT 0.
 *   RESUME — saved walk pointer into work RAM (walkers resume), MARIO_X bit7 set, SPIN_COUNT 6
 *            (drives loc_34b9's other table-select and a non-zero entry index through the arm).
 * Output record cells are sentinel-preloaded so an arm that SKIPS a write the oracle makes
 * (e.g. a dropped default arm) diverges too, not only one that writes a wrong value.
 *
 * TEETH — three broken twins, each of which the sweep MUST catch:
 *   (a) swapped 1<->2 arms.
 *   (b) dropped default arm (returns instead of calling loc_34b9).
 *   (c) off-by-one selector (matches boards 2 and 3 instead of 1 and 2).
 *
 * CAPTURED — 0x32BD IS dispatched during boot/attract (the object-walker subtree runs there),
 *   but only ever on the 25m board, so real captures exercise the BOARD == 1 -> loc_342c arm;
 *   every one is confirmed identical to the oracle (RAM − the stack scratch below the entry SP).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-32bd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_32bd as oracle } from "../../translated/loc_32bd.js";
import { loc_32bd } from "../loc_32bd.js";
import { loc_342c } from "../loc_342c.js";
import { loc_3478 } from "../loc_3478.js";
import { loc_34b9 } from "../loc_34b9.js";
import { Machine } from "../../machine.js";
import {
  BOARD,
  MARIO_X,
  SPIN_COUNT,
  OBJ_WALK_PTR_LO,
  OBJ_WALK_PTR_HI,
  STACK_SCRATCH,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x32bd;

// The object record the caller points at (IX) — 0x6400 is OBJ_ARRAY_64's first record, exactly
// the base observed in real captures, so every touched record cell lands in work RAM.
const IX_BASE = 0x6400;
const CELL = (off) => (IX_BASE + off) & 0xffff;

// SP inside the stack region: the oracle's push16 lands at SP-2, inside STACK_SCRATCH, and every
// pop reads valid work RAM. loc_32bd models no stack, so it never touches this.
const SAFE_SP = 0x6bf8;

// Where a RESUME walk pointer points — controllable work RAM, disjoint from the record and stack.
const WORK_PTR = 0x6800;

// Distinctive value preloaded into every record cell an arm writes, so a twin that SKIPS a write
// (rather than writing a wrong value) still diverges from the oracle.
const SENTINEL = 0x87;

// Record cells any arm writes as pure output (NOT the walk-pointer bytes, which are INPUT here):
// +0x03 OBJ_X, +0x05 OBJ_Y, +0x0d OBJ_STATE, +0x0e/+0x0f/+0x18/+0x1c (loc_34b9's paired/cleared).
const OUTPUT_OFFSETS = [0x03, 0x05, 0x0d, 0x0e, 0x0f, 0x18, 0x1c];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * A synthetic 0x32BD entry: a clone of `base` with the object record in IX, SP in the stack
 * region, the dispatch selector (BOARD) and callee inputs (MARIO_X, SPIN_COUNT) set, the saved
 * walk pointer written into the record, every output record cell sentinel-filled, and — for a
 * RESUME (non-zero pointer into work RAM) — the byte the walkers' tail will read placed there.
 * Frame machinery is neutralised so the oracle's step machinery cannot fire an NMI in isolation.
 */
function makeEntry(base, { board, saved = 0, mx = 0x00, spin = 0x00, tableByte = 0x00 }) {
  const e = base.clone();
  e.regs.ix = IX_BASE;
  e.regs.sp = SAFE_SP;
  e.mem.write8(BOARD, board);
  e.mem.write8(MARIO_X, mx);
  e.mem.write8(SPIN_COUNT, spin);
  for (const off of OUTPUT_OFFSETS) e.mem.write8(CELL(off), SENTINEL);
  e.mem.write8(CELL(OBJ_WALK_PTR_LO), saved & 0xff);
  e.mem.write8(CELL(OBJ_WALK_PTR_HI), (saved >> 8) & 0xff);
  if (saved !== 0) e.mem.write8(saved, tableByte); // the byte a resume walk reads
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

/**
 * Run the oracle and the candidate on two FRESH, byte-identical entries and diff the
 * memory-equivalence contract (RAM − the stack scratch below the entry SP). Fresh entry per side because the routine
 * WRITES memory — a reused machine would carry the previous run forward.
 */
function runPair(base, opts, candidate) {
  const a = makeEntry(base, opts);
  const aFloor = a.regs.sp;
  const b = makeEntry(base, opts);
  oracle(a);
  candidate(b);
  return { ram: firstRamDiff(a, b, aFloor) };
}

/**
 * The two factored sweeps: every board value 0..255 in FRESH state, then again in RESUME state.
 * Returns the first mismatch (or null) and the total combos compared. These together cover
 * loc_32bd's whole input space (the board selector) with each arm producing a distinct footprint.
 */
function fullSweep(base, candidate) {
  let count = 0;

  // FRESH — saved pointer 0, MARIO_X bit7 clear, SPIN_COUNT 0. Each walker initialises.
  for (let board = 0; board < 256; board++) {
    const { ram } = runPair(base, { board, saved: 0, mx: 0x00, spin: 0x00 }, candidate);
    count++;
    if (ram) return { mismatch: { where: `FRESH board=${hb(board)}`, ram }, count };
  }

  // RESUME — saved pointer into work RAM, MARIO_X bit7 set, SPIN_COUNT 6. Walkers resume; loc_34b9
  // takes its other table-select and a non-zero entry index.
  for (let board = 0; board < 256; board++) {
    const { ram } = runPair(base, { board, saved: WORK_PTR, mx: 0x80, spin: 0x06, tableByte: 0x00 }, candidate);
    count++;
    if (ram) return { mismatch: { where: `RESUME board=${hb(board)}`, ram }, count };
  }

  return { mismatch: null, count };
}

const describe = (mm) => mm && `${mm.where}: RAM diverges at ${hx(mm.ram.addr ?? 0)} (${mm.ram.a}->${mm.ram.b})`;
const SWEEP_COUNT = 256 + 256; // FRESH + RESUME over all board values

// -- 1. EQUAL (factored-exhaustive) -------------------------------------------

test("EQUAL (exhaustive): loc_32bd == oracle across every board value (fresh + resume)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = fullSweep(base, loc_32bd);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, SWEEP_COUNT, "must have compared the full board selector twice (fresh + resume)");
  console.log(`  EQUAL/exhaustive: ${count} board dispatches (fresh + resume) — RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted edges) -------------------------------------------------

test("EQUAL (crafted): each arm matches the oracle across its own sub-arms", () => {
  const base = new Machine(ROM).clone();
  const cases = [
    { name: "board 1 fresh (loc_342c init)", opts: { board: 0x01, saved: 0 } },
    { name: "board 1 resume (loc_342c resume)", opts: { board: 0x01, saved: WORK_PTR, tableByte: 0x11 } },
    { name: "board 2 fresh forward (loc_3478, MARIO_X bit7 set)", opts: { board: 0x02, saved: 0, mx: 0x80 } },
    { name: "board 2 fresh backward (loc_3478, MARIO_X bit7 clear)", opts: { board: 0x02, saved: 0, mx: 0x00 } },
    { name: "board 0 default (loc_34b9 seed, table clear)", opts: { board: 0x00, mx: 0x00, spin: 0x02 } },
    { name: "board 4 default (loc_34b9 seed, table set)", opts: { board: 0x04, mx: 0x80, spin: 0x04 } },
    { name: "board 3 default (loc_34b9 early-out)", opts: { board: 0x03, mx: 0x80, spin: 0x06 } },
    { name: "board 255 default", opts: { board: 0xff, mx: 0x00, spin: 0x00 } },
  ];
  for (const { name, opts } of cases) {
    const { ram } = runPair(base, opts, loc_32bd);
    assert.equal(ram, null, ram && `${name}: ${describe({ where: name, ram })}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arm sub-cases identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------
// Each twin breaks ONLY the dispatch selector and keeps the real idiomatic callees.

/** BUG (a): swaps the board 1 and board 2 arms. */
function brokenSwap12(m) {
  const board = m.mem.read8(BOARD);
  if (board === 0x01) { loc_3478(m); return; } // BUG: swapped
  if (board === 0x02) { loc_342c(m); return; } // BUG: swapped
  loc_34b9(m);
}

/** BUG (b): drops the default arm — boards other than 1/2 do nothing. */
function brokenDropDefault(m) {
  const board = m.mem.read8(BOARD);
  if (board === 0x01) { loc_342c(m); return; }
  if (board === 0x02) { loc_3478(m); return; }
  // BUG: no default loc_34b9 call
}

/** BUG (c): off-by-one selector — matches boards 2 and 3 instead of 1 and 2. */
function brokenOffByOne(m) {
  const board = m.mem.read8(BOARD);
  if (board === 0x02) { loc_342c(m); return; } // BUG: should be 1
  if (board === 0x03) { loc_3478(m); return; } // BUG: should be 2
  loc_34b9(m);
}

test("TEETH: the swapped-1<->2-arms twin is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenSwap12);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a swapped 1<->2 dispatch — worthless");
  console.log(`  TEETH/swap-1-2: caught — ${describe(mismatch)}`);
});

test("TEETH: the dropped-default-arm twin is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenDropDefault);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped default arm — worthless");
  console.log(`  TEETH/drop-default: caught — ${describe(mismatch)}`);
});

test("TEETH: the off-by-one-selector twin is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenOffByOne);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an off-by-one selector — worthless");
  console.log(`  TEETH/off-by-one: caught — ${describe(mismatch)}`);
});

// -- 4. CAPTURED realism ------------------------------------------------------

/** Hook 0x32BD in a real boot/attract run and clone the machine at up to K real dispatches. */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

test("CAPTURED: loc_32bd == oracle on every real 0x32BD dispatch", () => {
  const caps = captureDispatches(64, 2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x32BD dispatch during boot/attract");

  const boards = {};
  for (const cap of caps) {
    const b = cap.mem.read8(BOARD);
    boards[b] = (boards[b] || 0) + 1;
    const a = cap.clone(); a.nextNmi = Infinity; a.nextBoundary = Infinity;
    const c = cap.clone(); c.nextNmi = Infinity; c.nextBoundary = Infinity;
    oracle(a);
    loc_32bd(c);
    const ram = firstRamDiff(a, c, cap.regs.sp);
    assert.equal(ram, null, ram && `real dispatch diverges at ${hx(ram.addr ?? 0)} (${ram.a}->${ram.b})`);
  }
  const hist = Object.entries(boards).map(([b, n]) => `board ${b}:${n}`).join(", ");
  console.log(`  CAPTURED: ${caps.length} real 0x32BD dispatches — RAM == oracle (${hist})`);
});
