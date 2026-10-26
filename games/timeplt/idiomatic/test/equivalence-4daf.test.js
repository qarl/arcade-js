// SPDX-License-Identifier: GPL-3.0-only
/**
 * stampTwoByTwoTileBlock — memory-equivalent to the frozen oracle at ROM 0x4DAF.
 *
 * WHAT IT IS. Eight writes: four consecutive shape codes into a two-cell square of the character
 * plane, then one colour into the same four cells of the plane beside it, walking back across the
 * square. The cursor is stepped once per line, so it comes out two places along. The two cursor
 * steps are restarts into 0x0020, which is ALREADY decompiled, so the rewrite calls
 * advanceCharCursor directly and dissolving them belongs to this caller's unit.
 *
 * GATE: strict unit-capture over three real dispatches, a crafted sweep of the shape base, the
 *   colour and the cursor, and a whole-machine replay. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM identical outside the dead stack bytes, and the stepped
 *      cursor identical too; it is a live-out and is compared explicitly.
 *   2. NOT VACUOUS — a candidate that does nothing FAILS the same masked comparison.
 *   3. LIVE-OUTS PINNED, SCRATCH NOT (frogger standard) — the stepped cursor is the one genuine
 *      register live-out and is pinned to the frozen side; the accumulator, the flags and the
 *      colour-plane pointer the ROM scribbles are dead after return and localized to JS scratch, so
 *      a twin that only scribbles a dead register passes while a RAM or pinned-cursor scribble is
 *      caught.
 *   4. CORPUS — all three real dispatches replayed, with the count asserted.
 *   5. CRAFTED — 256 shape bases x three colours x five cursors. Two of those cursors are chosen
 *      so the colour walk's step CARRIES out of the low half of the address, which is the one
 *      piece of arithmetic in this entry that a real cursor never exercises.
 *   6. WHOLE-MACHINE — the shared session with the rewrite wired through the omitted-return seam.
 *   7. TEETH — six twins, with exact catch counts over the crafted space and the real session.
 *
 * HOLE: three real dispatches, all in one frame and all from one caller, so the corpus says
 * nothing about a cursor anywhere else on the screen. The crafted cursors stand in for that and
 * they are chosen rather than observed.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4daf.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { stampTwoByTwoTileBlock } from "../stampTwoByTwoTileBlock.js";
import { advanceCharCursor } from "../advanceCharCursor.js";
import { loc_4daf as oracle } from "../../translated/loc_4daf.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x4daf;

const COLOUR_PLANE_GAP = 0x0400;
const NEXT_LINE = 32;

const SCRATCH_BYTES = 2;
const SCRATCH_OFFSETS = [-2, -1];

/** The frogger standard: RAM (masked over the frozen side's stack scratch) is the contract, and
 * only genuine named register live-outs are pinned beside it. This routine leaves exactly one —
 * the stepped cursor, read back by the frozen translated caller — so it alone is pinned. The
 * accumulator, the flags and the colour-plane pointer the ROM also scribbles are dead after return
 * and localized to JS scratch, so they are NOT pinned; a rewrite that drops them still passes. */
const GENUINE_LIVE_OUTS = ["de"];
const SCRIBBLE_CELL = 0xa400; // a compared (non-stack) cell the control flips to prove RAM bites

const CORPUS_FRAMES = 2000;
const DISPATCHES = 3;

/** The dead bytes a whole session leaves differing. Measured. */
const SESSION_SCRATCH = [0xaff4, 0xaff5, 0xaffd, 0xaffe];

const skip = romsPresent() ? false : "ROM images are not assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

/** Oracle vs candidate on clones: masked RAM first, then the stepped cursor. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const stray = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (stray) return stray;
  for (const k of GENUINE_LIVE_OUTS) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

function replaySession(candidate) {
  let dispatches = 0;
  let caught = 0;
  const dirty = new Set();
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    const sp = mm.regs.sp;
    const a = mm.clone();
    const b = mm.clone();
    oracle(a);
    candidate(b);
    for (const d of allDiffs(a, b)) if (inScratch(d.addr, sp)) dirty.add(d.addr - sp);
    if (unitDiff(candidate, mm)) caught++;
    return oracle(mm);
  }]]));
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, dirty };
}

let cache = null;
const session = () => (cache ??= replaySession(stampTwoByTwoTileBlock));

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  return entry;
}

/** A real captured machine with the shape base, the colour and the cursor forced. */
function craft(base, colour, cursor) {
  const m = entryState().clone();
  m.regs.b = base;
  m.regs.c = colour;
  m.regs.de = cursor;
  return m;
}

const BASES = Array.from({ length: 256 }, (_unused, b) => b);
const COLOURS = [0, 0x18, 0xff];
/** Two of these put the colour walk's step across the low half of the address. */
const CURSORS = [0xa783, 0xa7f0, 0xa7ef, 0xa620, 0xa4e5];
const SWEEP_SIZE = BASES.length * COLOURS.length * CURSORS.length;

function overSweep(fn) {
  for (const cursor of CURSORS) {
    for (const colour of COLOURS) for (const base of BASES) fn(craft(base, colour, cursor));
  }
}

function sweepCaught(candidate) {
  let caught = 0;
  overSweep((machine) => {
    if (unitDiff(candidate, machine)) caught++;
  });
  return caught;
}

function wholeRunCells(candidate) {
  const base = makeMachine();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = makeMachine(new Map([[TARGET, withOmittedRet((mm) => (fired++, candidate(mm)))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(base.stateOffsetToAddr(o));
    }
  }
  const live = liveStackDiffs(baseFrames, hostFrames, floors, (o) => base.stateOffsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

const u16 = (v) => v & 0xffff;

/** The shape every twin varies, so each differs from the rewrite in exactly one decision. */
function stamp(m, { shapes = [3, 2, 0, 1], gap = COLOUR_PLANE_GAP, steps = 2, narrowWalk = false }) {
  const { regs, mem8 } = m;
  const base = regs.b;
  const colour = regs.c;
  mem8[regs.de] = base + shapes[0];
  regs.de = u16(regs.de - 1);
  mem8[regs.de] = base + shapes[1];
  advanceCharCursor(m);
  mem8[regs.de] = base + shapes[2];
  regs.de = u16(regs.de + 1);
  mem8[regs.de] = base + shapes[3];
  let cell = u16(regs.de - gap);
  for (let i = 1; i < steps; i++) advanceCharCursor(m);
  mem8[cell] = colour;
  cell = u16(cell - 1);
  mem8[cell] = colour;
  cell = narrowWalk ? (cell & 0xff00) | ((cell + NEXT_LINE) & 0xff) : u16(cell + NEXT_LINE);
  mem8[cell] = colour;
  mem8[u16(cell + 1)] = colour;
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the four shape codes are laid out upside down. */
const brokenShapesFlipped = (m) => stamp(m, { shapes: [0, 1, 3, 2] });

/** BUG: the cursor is stepped once, so the next emblem lands on top of this one. */
const brokenOneStep = (m) => stamp(m, { steps: 1 });

/** BUG: the colour goes to a plane twice as far away. */
const brokenWrongPlane = (m) => stamp(m, { gap: COLOUR_PLANE_GAP * 2 });

/** BUG: the walk back across the square is stepped in the low half of the address only. */
const brokenNarrowWalk = (m) => stamp(m, { narrowWalk: true });

/** BUG: the shapes are laid out but no colour is given to any of the four cells. */
function brokenNoColour(m) {
  const { regs, mem8 } = m;
  const base = regs.b;
  mem8[regs.de] = base + 3;
  regs.de = u16(regs.de - 1);
  mem8[regs.de] = base + 2;
  advanceCharCursor(m);
  mem8[regs.de] = base;
  regs.de = u16(regs.de + 1);
  mem8[regs.de] = base + 1;
  advanceCharCursor(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 3840, 3],
  ["shapes-flipped", brokenShapesFlipped, 3840, 3],
  ["one-step", brokenOneStep, 3840, 3],
  ["wrong-plane", brokenWrongPlane, 3840, 2],
  ["narrow-walk", brokenNarrowWalk, 768, 0],
  ["no-colour", brokenNoColour, 3840, 2],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: stampTwoByTwoTileBlock == oracle outside the scratch window", { skip }, () => {
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  stampTwoByTwoTileBlock(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.de, b.regs.de, "the stepped cursor left behind");
  console.log(
    `  EQUAL: base=${entryState().regs.b} colour=${entryState().regs.c} ` +
      `cursor=${hex4(entryState().regs.de)}; identical`,
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("LIVE-OUTS PINNED, SCRATCH NOT: a dead-register scribble passes; RAM and the cursor bite", { skip }, () => {
  // The stepped cursor is the one genuine register live-out, pinned to the frozen side. The
  // accumulator, the flags and the colour-plane pointer the ROM scribbles are dead after return and
  // NOT pinned, so a twin that only scribbles a dead register is DELIBERATELY not flagged — and the
  // same measurement must still catch a scribbled RAM cell AND a scribbled cursor, or the clean read
  // on the dead-register twin is worthless.
  const scribbleDeadReg = (m) => { stampTwoByTwoTileBlock(m); m.regs.a = (m.regs.a + 1) & 0xff; };
  const scribbleData = (m) => { stampTwoByTwoTileBlock(m); m.mem8[SCRIBBLE_CELL] ^= 0xff; };
  const scribbleLiveOut = (m) => { stampTwoByTwoTileBlock(m); m.regs.de = (m.regs.de + 1) & 0xffff; };
  assert.equal(unitDiff(scribbleDeadReg, entryState()), null, "a dead-register scribble was flagged, but the accumulator is not a live-out");
  assert.notEqual(unitDiff(scribbleData, entryState()), null, "the RAM measurement missed a scribbled cell, so it has no teeth");
  assert.notEqual(unitDiff(scribbleLiveOut, entryState()), null, "the pinned cursor scribble went uncaught, so the live-out pin has no teeth");
  console.log(`  LIVE-OUTS: ${GENUINE_LIVE_OUTS.join(", ")} pinned; dead-reg scribble ignored, RAM + cursor scribbles caught`);
});

test("CORPUS: all three real dispatches replay identically", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(s.caught, 0, "the rewrite diverged on a real dispatch");
  assert.deepEqual(
    [...s.dirty].sort((x, y) => x - y),
    SCRATCH_OFFSETS,
    "the session dirtied a different window under the stack pointer",
  );
  console.log(`  CORPUS: ${s.dispatches} real dispatches, identical on each`);
});

test("CRAFTED: 256 bases x three colours x five cursors, two of which carry", { skip }, () => {
  assert.equal(sweepCaught(stampTwoByTwoTileBlock), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  CRAFTED: ${SWEEP_SIZE} comparisons identical`);
});

test("THE CARRY IS REACHED, MEASURED: the narrow-walk twin needs one of the crafted cursors", { skip }, () => {
  const carrying = CURSORS.filter((c) => unitDiff(brokenNarrowWalk, craft(9, 0x18, c)) !== null);
  assert.ok(carrying.length > 0, "no crafted cursor makes the walk carry, so that arm proves nothing");
  assert.equal(
    unitDiff(brokenNarrowWalk, entryState()),
    null,
    "the real cursor now makes the walk carry, so this file's reason for crafting one is stale",
  );
  console.log(`  CARRY: reached by cursors ${carrying.map(hex4).join(" ")}, and by no real one`);
});

test("WHOLE-MACHINE: the session differs only in the dead stack bytes", { skip }, () => {
  const r = wholeRunCells(stampTwoByTwoTileBlock);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the dead stack bytes");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, realCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const r = replaySession(twin);
    assert.equal(r.dispatches, DISPATCHES, "the session's dispatch count moved");
    assert.equal(r.caught, realCaught, `the ${label} twin's real catch count moved`);
    console.log(`  TEETH/${label}: the real session catches ${r.caught} of ${r.dispatches}`);
  });
}
