// SPDX-License-Identifier: GPL-3.0-only
/**
 * dressSpriteForCoarseHeading — memory-equivalent to the frozen oracle at ROM 0x2AFC.
 *
 * WHAT IT IS. A heading byte rounded to one of sixteen sectors, then two bytes copied out of two
 * parallel tables into an object's sprite entry. The table step is a restart into 0x0018, which is
 * ALREADY decompiled, so the rewrite calls offsetAddress directly and that dissolve belongs here.
 *
 * ★ NO PLAIN TAPE REACHES THIS ENTRY, and the UNREACHED arm asserts it: the shared coin-then-start
 *   tape and undriven attract both dispatch it ZERO times in the corpus budget. Its caller is a
 *   per-slot handler the era-keyed dispatcher only reaches in a later era, so the corpus session is
 *   DRIVEN PLAY WITH THE ERA INDEX PINNED — one cell poked, after which the game dispatches this
 *   entry itself, thousands of times, off a stick that is turning. The pin is the A/B's one
 *   variable: the same tape without it reaches nothing.
 *
 * GATE: strict unit-capture over every dispatch of that session, an EXHAUSTIVE heading sweep, and
 *   a whole-machine replay. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM identical outside the dead stack bytes.
 *   2. NOT VACUOUS — a candidate that does nothing FAILS that same diff, so RAM really is the gate.
 *   3. EXCLUDED, DELIBERATELY — the register file may differ only inside {a, f, d, e, l, sp}, and
 *      pc. The set is a BOUND, not a measurement: nothing outside it may move, and a rewrite that
 *      moves fewer of them still passes. Those are dead: this entry's one caller loads its own
 *      values into every one of them before reading any of them again, and the whole-machine arm
 *      is what holds it.
 *   4. CORPUS — every dispatch replayed, with the dispatch count and the sector spread asserted.
 *   5. EXHAUSTIVE — all 256 headings on a real entry, which covers every sector and both sides of
 *      the rounding step, including the wrap that closes the circle.
 *   6. WHOLE-MACHINE — the pinned session with the rewrite wired through the omitted-return seam.
 *   7. TEETH — six twins at six distinct behaviours, with exact catch counts. The no-op twin is
 *      caught on every crafted heading but on only 99 of the real dispatches, because a sprite
 *      entry usually already holds the bytes this entry would write; that is why the crafted
 *      sweep and not the corpus is what pins the shape of the lookup.
 *
 * HOLE: the corpus is one era, because that is the only era this entry's caller runs in, and the
 * pin holds it there. Whether a natural progression into that era presents different objects is
 * not covered.
 * HOLE: the crafted sweep varies the HEADING and holds the record and entry bases at the real
 * ones, so nothing here speaks for an entry addressed off a different slot.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2afc.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { dressSpriteForCoarseHeading } from "../dressSpriteForCoarseHeading.js";
import { ERA_INDEX } from "../names.js";
import { loc_2afc as oracle } from "../../translated/loc_2afc.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x2afc;

const HEADING_IN_RECORD = 2;
const SHAPE_TABLE = 0x2b18;
const SECOND_TABLE_GAP = 16;
const SHAPE_IN_ENTRY = 1;
const SECOND_BYTE_IN_ENTRY = 48;
const HALF_SECTOR = 8;
const SECTORS = 16;

const SCRATCH_BYTES = 2;
const SCRATCH_OFFSETS = [-2, -1];
const EXCLUDED = ["a", "f", "d", "e", "l", "sp"];

const CORPUS_FRAMES = 2000;
const DISPATCHES = 2473;

/** The era this entry's caller belongs to, pinned from a frame inside the first round. */
const PINNED_ERA = 3;
const PIN_FROM_FRAME = 700;

/** The dead bytes a whole pinned session leaves differing. Measured. */
const SESSION_SCRATCH = [0xaffd, 0xaffe];

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;

const skip = romsPresent() ? false : "ROM images are not assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** Coin, start, trigger held, and the stick walked round the compass for the whole session. */
function playTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: START_FRAME + 100, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09];
  let frame = START_FRAME + 140;
  let i = 0;
  while (frame < CORPUS_FRAMES) {
    tape.push({ frame, port: IN1, bits: compass[i++ % compass.length], dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const TAPE = playTape();

function pinnedMachine(overrides) {
  const m = makeMachine(overrides, { tape: TAPE });
  m.pokes = [{ addr: ERA_INDEX, val: PINNED_ERA, frame: PIN_FROM_FRAME, dur: null }];
  return m;
}

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

/** Oracle vs candidate on clones of one machine, masked to everything above the scratch window. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

function replaySession(candidate) {
  let dispatches = 0;
  let caught = 0;
  const sectors = new Set();
  const dirty = new Set();
  const m = pinnedMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    const heading = mm.mem8[(mm.regs.ix + HEADING_IN_RECORD) & 0xffff];
    sectors.add(((heading + HALF_SECTOR) & 0xff) >> 4);
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
  return { dispatches, caught, sectors, dirty };
}

let cache = null;
const session = () => (cache ??= replaySession(dressSpriteForCoarseHeading));

let entry = null;
function entryState() {
  if (entry === null) {
    const m = pinnedMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the pinned session never reached the routine");
  return entry;
}

/** A real captured machine with the one byte this entry reads out of the record forced. */
function craft(heading) {
  const m = entryState().clone();
  m.mem8[(m.regs.ix + HEADING_IN_RECORD) & 0xffff] = heading;
  return m;
}

const HEADINGS = Array.from({ length: 256 }, (_unused, h) => h);

function sweepCaught(candidate) {
  let caught = 0;
  for (const heading of HEADINGS) if (unitDiff(candidate, craft(heading))) caught++;
  return caught;
}

function wholeRunCells(candidate) {
  const base = pinnedMachine();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = pinnedMachine(new Map([[TARGET, withOmittedRet((mm) => (fired++, candidate(mm)))]]));
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

const write = (m, shapeAddr, secondAddr) => {
  m.mem8[(m.regs.iy + SHAPE_IN_ENTRY) & 0xffff] = m.mem8[shapeAddr];
  m.mem8[(m.regs.iy + SECOND_BYTE_IN_ENTRY) & 0xffff] = m.mem8[secondAddr];
};
const headingOf = (m) => m.mem8[(m.regs.ix + HEADING_IN_RECORD) & 0xffff];
const sectorOf = (m) => ((headingOf(m) + HALF_SECTOR) & 0xff) >> 4;

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the heading is truncated to a sector instead of rounded to the nearest one. */
function brokenTruncates(m) {
  const at = SHAPE_TABLE + (headingOf(m) >> 4);
  write(m, at, at + SECOND_TABLE_GAP);
}

/** BUG: the table starts one entry on, so every sector shows its neighbour. */
function brokenTableOffByOne(m) {
  const at = SHAPE_TABLE + 1 + sectorOf(m);
  write(m, at, at + SECOND_TABLE_GAP);
}

/** BUG: the second table is taken one short of where it starts. */
function brokenGapOffByOne(m) {
  const at = SHAPE_TABLE + sectorOf(m);
  write(m, at, at + SECOND_TABLE_GAP - 1);
}

/** BUG: the two bytes go into each other's slots. */
function brokenSwapsWrites(m) {
  const at = SHAPE_TABLE + sectorOf(m);
  write(m, at + SECOND_TABLE_GAP, at);
}

/** BUG: the sector is masked to eight, so half the circle is folded onto the other half. */
function brokenHalfCircle(m) {
  const at = SHAPE_TABLE + (sectorOf(m) & (SECTORS / 2 - 1));
  write(m, at, at + SECOND_TABLE_GAP);
}

const TWINS = [
  ["no-op", brokenNoOp, 256, 99],
  ["truncates", brokenTruncates, 128, 1313],
  ["table-off-by-one", brokenTableOffByOne, 256, 2473],
  ["gap-off-by-one", brokenGapOffByOne, 64, 643],
  ["swaps-writes", brokenSwapsWrites, 256, 2473],
  ["half-circle", brokenHalfCircle, 128, 1645],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: no plain tape dispatches this entry, which is why the era is pinned", { skip }, () => {
  for (const [label, opts] of [["shared", {}], ["attract", { tape: [] }], ["turning", { tape: TAPE }]]) {
    let hits = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => (hits++, oracle(mm))]]), opts);
    m.runFrames(CORPUS_FRAMES);
    assert.equal(hits, 0, `the ${label} tape now reaches this entry, so the pin is no longer the variable`);
  }
  console.log("  UNREACHED: shared, attract and the same turning tape unpinned all reach it 0 times");
});

test("EQUAL at the real dispatch: dressSpriteForCoarseHeading == oracle outside the scratch window", { skip }, () => {
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  dressSpriteForCoarseHeading(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  console.log(`  EQUAL: heading=${headingOf(entryState())} sector=${sectorOf(entryState())}; identical`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers and pc, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  dressSpriteForCoarseHeading(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("CORPUS: every dispatch of the pinned session replays identically", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(s.caught, 0, "the rewrite diverged on a real dispatch");
  assert.deepEqual(
    [...s.dirty].sort((x, y) => x - y),
    SCRATCH_OFFSETS,
    "the session dirtied a different window under the stack pointer",
  );
  console.log(`  CORPUS: ${s.dispatches} real dispatches, ${s.sectors.size} of ${SECTORS} sectors`);
});

test("EXHAUSTIVE: all 256 headings behave as the oracle", { skip }, () => {
  assert.equal(sweepCaught(dressSpriteForCoarseHeading), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${HEADINGS.length} headings identical, every sector covered`);
});

test("WHOLE-MACHINE: the pinned session differs only in the dead stack bytes", { skip }, () => {
  const r = wholeRunCells(dressSpriteForCoarseHeading);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the dead stack bytes");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, realCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted headings`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${HEADINGS.length} headings`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const r = replaySession(twin);
    assert.equal(r.dispatches, DISPATCHES, "the session's dispatch count moved");
    assert.equal(r.caught, realCaught, `the ${label} twin's real catch count moved`);
    console.log(`  TEETH/${label}: the real session catches ${r.caught} of ${r.dispatches}`);
  });
}
