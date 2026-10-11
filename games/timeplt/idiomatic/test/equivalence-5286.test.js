// SPDX-License-Identifier: GPL-3.0-only
/**
 * drainBothDeferredCellLists — memory-equivalent to the frozen oracle at ROM 0x5286.
 *
 * WHAT IT IS. One pass of the deferred cell machinery: run the eraser, run the painter, then copy
 * the pending list wholesale onto the erase one, stamping the count with a mark, and parking the
 * pending cursor back on its first entry. The copy runs ONE WAY on every pass and never back, so
 * this is not a swap and the pair is not a double buffer. All three callees
 * ARE ALREADY DECOMPILED, so the rewrite calls them directly and dissolving those transfers
 * belongs to this caller's unit.
 *
 * ★ THE LIVE-OUT IS MEMORY, AND THAT IS DERIVED FROM THE ORACLE'S ONE CALL SITE. The frozen
 *   caller clears the accumulator on the instruction after this returns and loads every pointer
 *   it goes on to use from a literal, so nothing this routine leaves in a register is read. That
 *   is why the ceiling below is as wide as it is: the frozen block copy leaves its two pointers
 *   and its counter behind, and none of them is consumed.
 *
 * ★ THE TWO SESSIONS ARE NOT INTERCHANGEABLE, and only measurement says so. The driven tape
 *   reaches this routine 2765 times with the pending list EMPTY every single time, so on that
 *   tape the routine's whole body is the empty path and twelve of the thirteen twins below are
 *   invisible. Attract is what presents a loaded list, fifteen distinct fill levels of it. The
 *   per-session catch counts record that asymmetry rather than averaging it away.
 *
 * ★ A COUNT OF ZERO IS NOT A COUNT OF NOTHING. The count is used as a block-copy length, and a
 *   length of zero copies the whole address space. That arm cannot be reached by nudging one cell
 *   — the painter runs first and would walk a list the nudge did not build — so the WRAPPED COUNT
 *   arm builds a consistent machine for it: a full page of entries whose cells all carry the
 *   priority bit, which the eraser and the painter both pass over, leaving the copy as the only
 *   thing that runs. Both sides then walk out of memory and raise in the same place, which is
 *   what that arm asserts, and it is the only thing that separates the zero-is-empty twin from
 *   the rewrite.
 *
 * GATE: strict unit-capture with one measured exclusion, two replayed sessions, fifteen real
 *   entries and eight crafted ones. What it exercises, holes stated:
 *
 *   1. CONTRACT     — at the first real dispatch, identical outside the measured window.
 *   2. WINDOW       — the oracle's own deepest push, measured over the whole sweep and PINNED.
 *   3. BOUNDARY     — the exclusion is exactly as wide as it declares.
 *   4. FILL REACH   — measured: which fill levels each session presents, and that one of them
 *                     presents exactly one.
 *   5. CORPUS       — every dispatch of both sessions replays identically, counts pinned.
 *   6. BLIND        — on an empty list the oracle's writes are idempotent, so a no-op passes
 *                     there; the same measurement catches it on a loaded list.
 *   7. CRAFTED      — every crafted arm identical outside the measured window.
 *   8. WRAPPED COUNT— the zero-length copy, on a consistent machine, with the oracle's own raise
 *                     as the control that the arm reaches the copy at all.
 *   9. EXCLUDED     — no register outside the declared CEILING moves, with a twin that keeps a
 *                     record pointer as the in-arm control that the measurement can see one.
 *  10. CALLS, NOT DISPATCHES — the module's text: it must import and call all three callees
 *                     rather than reach them through the registry, with the oracle as control.
 *  11. TEETH        — thirteen broken twins, each with the number of arms that catches it and its
 *                     catch count in each real session, zeros kept.
 *
 * HOLE: no session presents a fill level above 60 bytes, so the crafted arms above that are the
 * only evidence for a full list, and the wrap arm is the only evidence for a zero count.
 * HOLE: the eraser, the painter and the empty-both step are gated by their own files. What this
 * file gates is the order they run in, the empty test, and the copy.
 *
 * WHERE THE STACK POINTER IS OWNED. sp sits inside the excluded ceiling here, so a rewrite that
 * leaked stack without writing memory would pass. No gate now owns that: the whole-game gate
 * idiomatic.test.js compares memory only, outside the stack window, under an engine that leaves SP
 * unused. This gate says so rather than implying a coverage it does not have.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5286.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, romsPresent } from "./_harness.js";
import { drainBothDeferredCellLists } from "../drainBothDeferredCellLists.js";
import { blankCellsPaintedLastPass } from "../blankCellsPaintedLastPass.js";
import { emptyBothDeferredCellLists } from "../emptyBothDeferredCellLists.js";
import { paintDeferredCells } from "../paintDeferredCells.js";
import { loc_5286 as oracle } from "../../translated/loc_5286.js";
import { DEFERRED_BLANK_CURSOR, DEFERRED_WRITE_CURSOR } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x5286;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const FIRST_ENTRY = 4;
const COPIED_MARK = 0x80;
const WHOLE_ADDRESS_SPACE = 0x10000;
const ENTRY_BYTES = 4;
const HALF_PAGE = 0x80;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 2;

/**
 * The ceiling on divergence, and the whole of it: the oracle takes a return the dissolved calls
 * do not, and leaves the block copy's two pointers and its counter behind. Not a set the rewrite
 * is required to fill — a rewrite diverging on fewer still passes, so this can never refuse a fix.
 */
const MOVED = ["a", "f", "b", "c", "d", "e", "h", "l", "sp"];

const SESSION_FRAMES = 3000;
/** Dispatches and distinct fill levels each session presents. Measured; a move here is a finding. */
const DISPATCHES = {
  attract: { total: 2765, fills: 15 },
  driven: { total: 2765, fills: 1 },
};

const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const drivenMachine = (overrides) => makeMachine(overrides);
const SESSIONS = [["attract", attractMachine], ["driven", drivenMachine]];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => {
  if (!d) return "identical";
  return d.addr === null || d.addr === undefined
    ? `${d.reg}: oracle=${d.a} candidate=${d.b}`
    : `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}`;
};

// ── the real corpus, keyed by fill level ────────────────────────────────────────────────

let realCache = null;

/** One captured entry per distinct fill level the attract session presents. */
function realEntries() {
  if (realCache) return realCache;
  const byFill = new Map();
  const m = attractMachine(new Map([[TARGET, (mm) => {
    const fill = mm.mem8[DEFERRED_WRITE_CURSOR];
    if (!byFill.has(fill)) byFill.set(fill, mm.clone());
    return oracle(mm);
  }]]));
  m.runFrames(SESSION_FRAMES);
  realCache = [...byFill.entries()].sort((a, b) => a[0] - b[0])
    .map(([fill, mm]) => [`real-fill-${fill}`, mm]);
  return realCache;
}

const emptyEntry = () => realEntries().find(([label]) => label === `real-fill-${FIRST_ENTRY}`)[1];
const loadedEntry = () => realEntries().find(([label]) => label !== `real-fill-${FIRST_ENTRY}`)[1];

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** The masked window, and nothing else: the bytes the oracle's own push reaches and no others. */
function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/**
 * Oracle vs candidate on clones of `machine`: the whole dump masked to the measured window, then
 * every register outside the ceiling. A candidate that raises counts as caught; only the
 * candidate's side is wrapped, because a raise from the oracle is a harness fault.
 */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, reg: "raised", a: "returned", b: String(e).slice(0, 40) };
  }
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** How far below its seat the oracle's own pushes take the stack pointer, on one entry state. */
function oracleDepth(machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  oracle(c);
  return seat - deepest;
}

// ── the crafted arms ────────────────────────────────────────────────────────────────────
// A real EMPTY entry with a consistent list written into it: whole four-byte entries whose first
// two bytes name a cell in the colour plane, so the painter that runs first has something valid
// to walk. Fill levels above the half page would run into the erase list, so they stop below it.

const CRAFTED_FILLS = [8, 16, 40, 80, 124];
const DIRTY = [0x5a, 0x5b];
const ALREADY_THERE = [0xa5, 0xa6];

function craftedList(fill) {
  const mm = emptyEntry().clone();
  for (let off = FIRST_ENTRY, i = 0; off < fill; off += ENTRY_BYTES, i++) {
    const cell = 0xa000 + ((i * 37) & 0x3ff);
    mm.mem8[DEFERRED_WRITE_CURSOR + off] = cell & 0xff;
    mm.mem8[DEFERRED_WRITE_CURSOR + off + 1] = (cell >> 8) & 0xff;
    mm.mem8[DEFERRED_WRITE_CURSOR + off + 2] = 0x30 + (i & 0x0f);
    mm.mem8[DEFERRED_WRITE_CURSOR + off + 3] = i & 0x07;
  }
  mm.mem8[DEFERRED_WRITE_CURSOR] = fill;
  mm.mem8[DEFERRED_WRITE_CURSOR + 1] = DEFERRED_WRITE_CURSOR >> 8;
  return mm;
}

/** The two bytes beside the cursor made to DIFFER across the lists, so copying them shows. */
function dirtyHeader(fill) {
  const mm = craftedList(fill);
  mm.mem8[DEFERRED_WRITE_CURSOR + 2] = DIRTY[0];
  mm.mem8[DEFERRED_WRITE_CURSOR + 3] = DIRTY[1];
  mm.mem8[DEFERRED_BLANK_CURSOR + 2] = ALREADY_THERE[0];
  mm.mem8[DEFERRED_BLANK_CURSOR + 3] = ALREADY_THERE[1];
  return mm;
}

/** The byte one PAST the list made to differ, so copying one too many shows. */
function poisonedTail(fill) {
  const mm = craftedList(fill);
  mm.mem8[DEFERRED_WRITE_CURSOR + fill] = DIRTY[0];
  mm.mem8[DEFERRED_BLANK_CURSOR + fill] = ALREADY_THERE[0];
  return mm;
}

function craftedArms() {
  return [
    ...CRAFTED_FILLS.map((fill) => [`crafted-fill-${fill}`, craftedList(fill)]),
    ["crafted-dirty-header-empty", dirtyHeader(FIRST_ENTRY)],
    ["crafted-dirty-header-loaded", dirtyHeader(40)],
    ["crafted-poisoned-tail", poisonedTail(40)],
  ];
}

const arms = () => [...realEntries(), ...craftedArms()];
const ARM_COUNT = 15 + CRAFTED_FILLS.length + 3;

/** Every machine this file compares on. What the WINDOW arm measures the oracle over. */
const sweep = () => arms().map(([, mm]) => mm);

// ── the wrap arm ────────────────────────────────────────────────────────────────────────

/** A cell whose priority bit is set, which both walkers pass over untouched. */
const PARKED_CELL = 0xa000;
const ABOVE_SPRITES = 0x10;

/**
 * A consistent machine whose pending cursor reads zero: a whole half page of entries all naming
 * one cell that carries the priority bit, so neither walker writes anything, and an erase cursor
 * parked on its own first entry so the eraser leaves at once. What remains is the copy.
 */
function wrapArm() {
  const mm = emptyEntry().clone();
  mm.mem8[PARKED_CELL] |= ABOVE_SPRITES;
  for (let off = FIRST_ENTRY; off < HALF_PAGE; off += ENTRY_BYTES) {
    mm.mem8[DEFERRED_WRITE_CURSOR + off] = PARKED_CELL & 0xff;
    mm.mem8[DEFERRED_WRITE_CURSOR + off + 1] = (PARKED_CELL >> 8) & 0xff;
    mm.mem8[DEFERRED_WRITE_CURSOR + off + 2] = 0x30;
    mm.mem8[DEFERRED_WRITE_CURSOR + off + 3] = 1;
  }
  mm.mem16[DEFERRED_BLANK_CURSOR] = DEFERRED_BLANK_CURSOR + FIRST_ENTRY;
  mm.mem8[DEFERRED_WRITE_CURSOR] = 0;
  mm.mem8[DEFERRED_WRITE_CURSOR + 1] = DEFERRED_WRITE_CURSOR >> 8;
  return mm;
}

/** Oracle and candidate on the wrap arm: what each raised, and the dump masked to the window. */
function wrapDiff(candidate) {
  const base = wrapArm();
  const sp = base.regs.sp;
  const a = base.clone();
  const b = base.clone();
  let fromOracle = null;
  let fromCandidate = null;
  try {
    oracle(a);
  } catch (e) {
    fromOracle = e;
  }
  try {
    candidate(b);
  } catch (e) {
    fromCandidate = e;
  }
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  return { fromOracle, fromCandidate, strays };
}

const raiseMatches = (r) =>
  r.fromCandidate !== null && r.fromOracle !== null
  && r.fromCandidate.name === r.fromOracle.name && r.fromCandidate.addr === r.fromOracle.addr;

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let total = 0;
  let caught = 0;
  const fills = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      total++;
      fills.add(mm.mem8[DEFERRED_WRITE_CURSOR]);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(SESSION_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, SESSION_FRAMES, "session ran short");
  return { total, caught, fills: fills.size };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, f]) => ({ label, ...replaySession(f, drainBothDeferredCellLists) }));
  return sessionCache;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────
// Each is the module with one step wrong, calling its callees the way the module calls them. A
// twin going through the registry would match the oracle's stack traffic exactly and so would
// never be masked, which would let the teeth pass without exercising the exclusion.

function copyBytes(m, from, to, bytes) {
  for (let i = 0; i < bytes; i++) m.mem8[u16(to + i)] = m.mem8[u16(from + i)];
}
const lengthOf = (fill) => (fill === 0 ? WHOLE_ADDRESS_SPACE : fill);
function park(m, fill) {
  m.mem8[DEFERRED_BLANK_CURSOR] = u8(fill + COPIED_MARK);
  m.mem16[DEFERRED_WRITE_CURSOR] = DEFERRED_WRITE_CURSOR + FIRST_ENTRY;
}
function drain(m) {
  blankCellsPaintedLastPass(m);
  paintDeferredCells(m);
  return m.mem8[DEFERRED_WRITE_CURSOR];
}

/** BUG: does nothing — the twin that proves the comparison sees a real dispatch. */
function brokenNoOp() {}

/** BUG: never blanks what the last pass painted. */
function brokenSkipsTheBlank(m) {
  paintDeferredCells(m);
  const fill = m.mem8[DEFERRED_WRITE_CURSOR];
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR, DEFERRED_BLANK_CURSOR, lengthOf(fill));
  return park(m, fill);
}

/** BUG: never paints what is pending. */
function brokenSkipsThePaint(m) {
  blankCellsPaintedLastPass(m);
  const fill = m.mem8[DEFERRED_WRITE_CURSOR];
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR, DEFERRED_BLANK_CURSOR, lengthOf(fill));
  return park(m, fill);
}

/** BUG: paints first and blanks second, so this pass's cells are wiped as they are laid down. */
function brokenReversedOrder(m) {
  paintDeferredCells(m);
  blankCellsPaintedLastPass(m);
  const fill = m.mem8[DEFERRED_WRITE_CURSOR];
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR, DEFERRED_BLANK_CURSOR, lengthOf(fill));
  return park(m, fill);
}

/** BUG: calls a cursor of ZERO empty rather than a cursor on the first entry. */
function brokenEmptyTestOnZero(m) {
  const fill = drain(m);
  if (fill === 0) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR, DEFERRED_BLANK_CURSOR, fill);
  return park(m, fill);
}

/** BUG: copies one byte too few, dropping the last entry's colour. */
function brokenCopiesOneShort(m) {
  const fill = drain(m);
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR, DEFERRED_BLANK_CURSOR, lengthOf(fill) - 1);
  return park(m, fill);
}

/** BUG: copies one byte too many, dragging in what lies past the list. */
function brokenCopiesOneLong(m) {
  const fill = drain(m);
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR, DEFERRED_BLANK_CURSOR, lengthOf(fill) + 1);
  return park(m, fill);
}

/** BUG: starts the copy at the first entry, leaving the four header bytes behind. */
function brokenSkipsTheHeader(m) {
  const fill = drain(m);
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR + FIRST_ENTRY, DEFERRED_BLANK_CURSOR + FIRST_ENTRY,
    lengthOf(fill) - FIRST_ENTRY);
  return park(m, fill);
}

/** BUG: stamps the count without the mark the eraser masks away. */
function brokenNoMark(m) {
  const fill = drain(m);
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR, DEFERRED_BLANK_CURSOR, lengthOf(fill));
  m.mem8[DEFERRED_BLANK_CURSOR] = fill;
  m.mem16[DEFERRED_WRITE_CURSOR] = DEFERRED_WRITE_CURSOR + FIRST_ENTRY;
}

/** BUG: parks the pending cursor on the OTHER list's first entry. */
function brokenWrongPark(m) {
  const fill = drain(m);
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR, DEFERRED_BLANK_CURSOR, lengthOf(fill));
  m.mem8[DEFERRED_BLANK_CURSOR] = u8(fill + COPIED_MARK);
  m.mem16[DEFERRED_WRITE_CURSOR] = DEFERRED_BLANK_CURSOR + FIRST_ENTRY;
}

/** BUG: copies the erase list onto the pending one instead of the other way round. */
function brokenReversedCopy(m) {
  const fill = drain(m);
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_BLANK_CURSOR, DEFERRED_WRITE_CURSOR, lengthOf(fill));
  return park(m, fill);
}

/** BUG: stamps and parks without copying anything, so the eraser walks a stale list. */
function brokenParkOnly(m) {
  const fill = drain(m);
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  return park(m, fill);
}

/** BUG: reads a count of zero as a copy of nothing rather than of everything. */
function brokenZeroIsEmpty(m) {
  const fill = drain(m);
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR, DEFERRED_BLANK_CURSOR, fill);
  return park(m, fill);
}

const TWINS = [
  ["no-op", brokenNoOp, 21, { attract: 1920, driven: 0 }],
  ["skips-the-blank", brokenSkipsTheBlank, 10, { attract: 1841, driven: 0 }],
  ["skips-the-paint", brokenSkipsThePaint, 14, { attract: 1920, driven: 0 }],
  ["reversed-order", brokenReversedOrder, 13, { attract: 1868, driven: 0 }],
  ["empty-test-on-zero", brokenEmptyTestOnZero, 1, { attract: 0, driven: 0 }],
  ["copies-one-short", brokenCopiesOneShort, 16, { attract: 1469, driven: 0 }],
  ["copies-one-long", brokenCopiesOneLong, 1, { attract: 0, driven: 0 }],
  ["skips-the-header", brokenSkipsTheHeader, 1, { attract: 0, driven: 0 }],
  ["no-mark", brokenNoMark, 21, { attract: 1920, driven: 0 }],
  ["wrong-park", brokenWrongPark, 21, { attract: 1920, driven: 0 }],
  ["reversed-copy", brokenReversedCopy, 21, { attract: 1920, driven: 0 }],
  ["park-only", brokenParkOnly, 21, { attract: 1920, driven: 0 }],
];

/**
 * NOT A TOOTH — the EXCLUDED arm's positive control. It writes exactly the right bytes; what it
 * does is keep the pending list's head in an index register outside the declared ceiling, which
 * is the one thing the register measurement must be able to report or its clean readings prove
 * nothing.
 */
function keepsThePointer(m) {
  const fill = drain(m);
  m.regs.ix = DEFERRED_WRITE_CURSOR;
  if (fill === FIRST_ENTRY) return emptyBothDeferredCellLists(m);
  copyBytes(m, DEFERRED_WRITE_CURSOR, DEFERRED_BLANK_CURSOR, lengthOf(fill));
  return park(m, fill);
}

/**
 * The BOUNDARY arm's probe: the ORACLE ITSELF plus one byte flipped at `sp + offset`. Built on the
 * oracle so what the arm reports is a property of the MASK alone.
 */
function scribbler(offset) {
  return (m) => {
    const at = (m.regs.sp + offset) & 0xffff;
    oracle(m);
    m.mem8[at] ^= 0xff;
  };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: at the first real dispatch, identical outside the window", { skip }, () => {
  const e = realEntries()[0][1];
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  drainBothDeferredCellLists(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  CONTRACT: fill ${e.mem8[DEFERRED_WRITE_CURSOR]}, seat ${hex4(sp)}; ${all.length} differing bytes, ` +
      `${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.ok(all.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
});

test("WINDOW: the oracle's own deepest push, measured over the whole sweep", { skip }, () => {
  let deepest = 0;
  for (const m of sweep()) deepest = Math.max(deepest, oracleDepth(m));
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm below is masking the wrong bytes");
});

test("BOUNDARY: the exclusion is exactly as wide as it declares", { skip }, () => {
  const e = loadedEntry();
  const sp = e.regs.sp;
  const below = unitDiff(scribbler(-SCRATCH_BYTES - 1), e);
  const seat = unitDiff(scribbler(0), e);
  const inside = unitDiff(scribbler(-1), e);
  console.log(
    `  BOUNDARY: ${hex4(sp - SCRATCH_BYTES - 1)} caught, ${hex4(sp)} caught, ${hex4(sp - 1)} masked`,
  );
  assert.notEqual(below, null, "a divergence one byte BELOW the window was swallowed, so the " +
    "exclusion is wider than it declares and a leaking stack pointer would walk out of sight");
  assert.notEqual(seat, null, "a divergence AT the entry seat was swallowed: the window must lie " +
    "strictly below the seat, and live stack above it must still fail");
  assert.equal(inside, null, "a divergence INSIDE the window was caught, so the two catches above " +
    "are the instrument catching everything rather than the boundary being where it says");
});

test("FILL REACH: what each session presents, and that one presents only an empty list", { skip },
  () => {
    for (const s of sessions()) {
      console.log(`  FILL REACH (measured) ${s.label}: ${s.fills} distinct fill levels over ` +
        `${s.total} dispatches`);
      assert.equal(s.fills, DISPATCHES[s.label].fills, `${s.label}: the fill levels it presents moved`);
    }
    const levels = realEntries().map(([label]) => label);
    assert.ok(levels.length > 1, "the attract corpus no longer presents a loaded list, so every " +
      "twin below that needs one has stopped being exercised by real play");
    console.log(`  FILL REACH: attract entries — ${levels.join(", ")}`);
  });

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    assert.equal(s.total, DISPATCHES[s.label].total, `${s.label}: the dispatch count moved`);
    total += s.total;
  }
  assert.ok(total > 0, "vacuous: no session reached the routine at all");
  console.log(`  CORPUS: ${total} real dispatches, identical outside the measured window`);
});

test("BLIND: on an empty list the writes are idempotent, so a no-op passes there", { skip }, () => {
  assert.equal(unitDiff(brokenNoOp, emptyEntry()), null, "the empty entry now catches a candidate " +
    "that does nothing, so the empty path is no longer idempotent and this file's account of why " +
    "the driven session catches nothing is wrong");
  assert.notEqual(unitDiff(brokenNoOp, loadedEntry()), null, "the same measurement passes the " +
    "no-op on a LOADED list too, so the reading above is the instrument seeing nothing anywhere");
  console.log("  BLIND: the no-op passes on the empty list and is caught on a loaded one");
});

test("CRAFTED: every arm identical outside the measured window", { skip }, () => {
  const all = arms();
  assert.equal(all.length, ARM_COUNT, "the arm set changed size");
  for (const [label, mm] of all) {
    const d = unitDiff(drainBothDeferredCellLists, mm);
    assert.equal(d, null, `${label}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${all.length} arms identical`);
});

test("WRAPPED COUNT: a cursor of zero copies the whole address space", { skip }, () => {
  const r = wrapDiff(drainBothDeferredCellLists);
  assert.notEqual(r.fromOracle, null, "the ORACLE returned on the wrap arm, so this machine never " +
    "reaches the copy at all and the arm proves nothing about a zero count");
  assert.ok(raiseMatches(r), `the rewrite did not walk out of memory where the oracle did: oracle ` +
    `${r.fromOracle?.name} at ${hex4(r.fromOracle?.addr ?? 0)}, candidate ` +
    `${r.fromCandidate === null ? "returned" : `${r.fromCandidate.name} at ${hex4(r.fromCandidate.addr ?? 0)}`}`);
  assert.deepEqual(r.strays, [], `the two sides wrote different bytes before stopping: ` +
    `${show(r.strays[0])}`);
  console.log(
    `  WRAPPED COUNT: both sides raise ${r.fromOracle.name} at ${hex4(r.fromOracle.addr)} with ` +
      "identical memory behind them",
  );
});

test("TEETH: the zero-is-empty twin is caught ONLY by the wrap arm", { skip }, () => {
  const survived = arms().filter(([, mm]) => unitDiff(brokenZeroIsEmpty, mm) === null).length;
  const r = wrapDiff(brokenZeroIsEmpty);
  console.log(
    `  TEETH/zero-is-empty: survives all ${survived} ordinary arms; on the wrap arm it ` +
      `${r.fromCandidate === null ? "returns where the oracle raises" : "raises"} with ` +
      `${r.strays.length} bytes differing`,
  );
  assert.equal(survived, arms().length, "an ordinary arm now catches this twin, so the wrap arm is " +
    "no longer the only evidence for the zero-length rule and this file's holes must be rewritten");
  assert.ok(!raiseMatches(r) || r.strays.length > 0, "the wrap arm passed the zero-is-empty twin, " +
    "so nothing in this gate holds the rewrite to treating a zero count as the whole address space");
});

/** Which registers a candidate parts company with the oracle on, over the whole sweep. */
function movedOver(candidate) {
  const moved = new Set();
  for (const m of sweep()) {
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    try {
      candidate(b);
    } catch {
      continue;
    }
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const moved = movedOver(drainBothDeferredCellLists);
  const control = movedOver(keepsThePointer);
  const controlStrays = REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k));
  assert.ok(controlStrays.length > 0, "the measurement reports nothing outside the ceiling even " +
    "for a twin that keeps a pointer in one, so a clean reading below proves nothing");
  console.log(
    `  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ceiling ` +
      `${MOVED.join(", ")}; the control also moves ${controlStrays.join(", ")}`,
  );
  // MOVED is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
});

const CALLEES = [
  ["blankCellsPaintedLastPass", "./blankCellsPaintedLastPass.js"],
  ["paintDeferredCells", "./paintDeferredCells.js"],
  ["emptyBothDeferredCellLists", "./emptyBothDeferredCellLists.js"],
];

function callsRatherThanDispatches(text) {
  return CALLEES.every(([name, file]) =>
    text.includes(`from "${file}"`) && text.includes(`${name}(m)`)) && !text.includes("m.call(");
}

test("CALLS, NOT DISPATCHES: the module's text, with the oracle as the control", () => {
  const module = readFileSync(new URL("../drainBothDeferredCellLists.js", import.meta.url), "utf8");
  const frozen = readFileSync(new URL("../../translated/loc_5286.js", import.meta.url), "utf8");
  assert.ok(callsRatherThanDispatches(module),
    "the module does not import and call all three callees directly");
  assert.ok(!callsRatherThanDispatches(frozen), "the check passes the frozen oracle, which reaches " +
    "every callee through the registry, so it cannot tell a call from a dispatch");
  console.log("  CALLS, NOT DISPATCHES: all three are imported and called; the oracle's text fails");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, caughtOnArms, perSession] of TWINS) {
  test(`TEETH: the ${label} twin is caught on the declared number of arms`, { skip }, () => {
    const all = arms();
    const caught = all.filter(([, mm]) => unitDiff(twin, mm) !== null).map(([l]) => l);
    const first = all.map(([l, mm]) => [l, unitDiff(twin, mm)]).find(([, d]) => d);
    console.log(`  TEETH/${label}: caught on ${caught.length} of ${all.length} arms; first at ` +
      `${first ? `${first[0]} — ${show(first[1])}` : "nowhere"}`);
    assert.ok(caught.length > 0, `${label}: no arm catches this twin, so it is not a tooth`);
    assert.equal(caught.length, caughtOnArms, `${label}: the number of arms catching it moved`);
  });

  test(`TEETH: the ${label} twin's catch count in each real session`, { skip }, () => {
    const counts = Object.fromEntries(
      SESSIONS.map(([l, f]) => [l, replaySession(f, twin).caught]),
    );
    console.log(`  TEETH/${label}: real sessions catch ${JSON.stringify(counts)}`);
    assert.deepEqual(counts, perSession, `the ${label} twin's real-session catch counts moved`);
  });
}
