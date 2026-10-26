// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_58aa — memory-equivalent to the frozen oracle at ROM 0x58AA.
 *
 * WHAT IT IS. Two instructions: load a fixed table pointer, then tail-jump to the DOUBLE-velocity
 * per-object move at 0x58FE, which is already decompiled — so the rewrite calls
 * flyAlongHeadingAtDoubleVelocity directly with the table as an argument, and dissolving that
 * transfer belongs to this caller's unit. The whole content of this entry is the CHOICE OF TABLE
 * and the CHOICE OF MOVER, plus the fact that a pointer the caller was holding is discarded.
 *
 * ★ HOW THE LIVE-OUT WAS DERIVED, and it is from the ORACLE's exit successors, not from the
 *   module. The oracle transfers into 0x58FE, whose four stores are its only writes and whose
 *   `ret` carries this entry's return. Two call sites reach here.
 *   chaseOneAimPointAndRetireAtTheLine CALLS it and its very next instruction is `call 0x3FAF`,
 *   which opens `ld a,(ix+0x02)` — it reads IX, which both sides leave untouched, and overwrites A
 *   before reading it. loc_29F7 TAIL-JUMPS here, so the return lands in loc_29D5 just before `call
 *   0x2B83`, which opens `ld a,(iy+0x31)` — IY again, and A overwritten. Neither successor reads
 *   A, F, D, E, H or L, and BOTH sides leave B, C, IX and IY equal, which the EXCLUDED arm asserts
 *   as a set rather than assuming. So the live-out is the four coordinate bytes; SP and pc belong
 *   to the dispatch seam, below.
 *
 * ★ SP AND pc ARE THE SEAM'S, NOT THIS FILE'S. The oracle reaches its `ret` through the transfer,
 *   so it pops the caller's slot; the rewrite performs no return at all. `withOmittedRet` measures
 *   exactly that and supplies the missing pop, and the WHOLE-MACHINE arm is what proves the
 *   measurement lands right — a session of hundreds of dispatches with SP never drifting.
 *
 * GATE: strict unit-capture over an undriven attract session, an exhaustive heading sweep, a
 *   crafted cross, and a whole-machine replay. What it exercises, holes stated:
 *
 *   1. DISPATCHED — the session's dispatch count and its caller attribution, both measured.
 *   2. EQUAL at the real dispatch — RAM byte-identical across the WHOLE dump. Nothing is masked,
 *      not even below the stack pointer: neither side writes the stack, since the frozen chain
 *      only pops a return the caller had already pushed. The arm asserts that by masking nothing.
 *   3. NOT VACUOUS — a candidate that does nothing FAILS that same diff.
 *   4. EXCLUDED, deliberately — the registers that move are pinned to an exact set, and the four
 *      registers the successors do read are asserted to be HELD.
 *   5. CORPUS — every dispatch of the session replayed, with the heading spread asserted.
 *   6. EXHAUSTIVE — all 256 headings crafted off a real entry.
 *   7. CRAFTED CROSS — displacements x positions x headings, poked identically on both sides.
 *   8. CARRY — one fraction swept 0..255, the only arm that reaches the carry between a
 *      coordinate's halves.
 *   9. RUNG LADDER — the six tables' peak magnitudes read out of memory, and the argument that no
 *      heading lets a neighbouring table agree on BOTH samples.
 *  10. WHOLE-MACHINE — the session with the rewrite wired through the omitted-return seam. The
 *      only cells allowed to differ are the two the frame interrupt pushes and pops at the top of
 *      the stack; the arm asserts that exact pair, so a real cell cannot hide behind it.
 *  11. TEETH — one twin per named way the step could be wrong, each with an exactly declared
 *      survivor set over the heading sweep and an exact catch count over the crafted cross. The
 *      single-velocity twin is the sharpest: it picks the RIGHT table and the neighbouring mover,
 *      which is half of what this entry decides.
 *
 * HOLE: only ONE of the two call sites is exercised. The session reaches this entry entirely
 * through chaseOneAimPointAndRetireAtTheLine; loc_29F7's tail transfer is dispatched zero times,
 * so nothing here speaks for the object population that path would bring.
 * HOLE: the session presents one object slot, so the record and sprite bases are never varied —
 * the crafted arms vary the values read, never the addresses they are read from.
 * HOLE: the carry twin is invisible on the heading sweep and at the real dispatch because both
 * fractions are zero there; only the crafted cross catches it, and its counts say so.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-58aa.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { loc_58aa } from "../loc_58aa.js";
import { flyAlongHeading } from "../flyAlongHeading.js";
import { flyAlongHeadingAtDoubleVelocity } from "../flyAlongHeadingAtDoubleVelocity.js";
import { loc_58aa as oracle } from "../../translated/loc_58aa.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "../names.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x58aa;

/** The two call sites in the image; the session reaches this entry through the first only. */
const CALLING_SITE = 0x4117;
const TAIL_SITE = 0x29f7;

const VELOCITY_TABLE = 0x59d7;
const LADDER = [0x59d7, 0x5c00, 0x5e00, 0x2530, 0x2e3e, 0x08fa];
const RUNG = LADDER.indexOf(VELOCITY_TABLE);
const RUNG_ABOVE = LADDER[RUNG + 1];
const TOP_RUNG = LADDER[LADDER.length - 1];
const OFF_BY_ONE_ENTRY = VELOCITY_TABLE + 2;
const MISALIGNED = VELOCITY_TABLE + 1;
const PEAKS = [206, 231, 256, 281, 306, 331];

const HEADING_CELL = 2;
const HEADINGS = 256;
const QUARTER = HEADINGS / 4;
const WHOLE_FIRST = 49;
const FRACTION_FIRST = 3;
const WHOLE_SECOND = 0;
const FRACTION_SECOND = 5;

const MOVED = ["a", "f", "d", "e", "h", "l", "sp"];
const HELD = ["b", "c", "ix", "iy"];

/** Measured over the session below; a move in any of these is a finding, not a tolerance. */
const FRAMES = 6000;
const DISPATCHES = 391;
const CALLING_SITE_DISPATCHES = 391;
const TAIL_SITE_DISPATCHES = 0;
const DISTINCT_HEADINGS = 219;

/**
 * The only bytes a whole session leaves differing: the two at the top of the stack where the frame
 * interrupt pushes the program counter it pops again. They move because the rewrite charges no
 * T-states, so the interrupt lands on a different instruction; nothing reads them. Measured.
 */
const SESSION_SCRATCH = [0xaffd, 0xaffe];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");
const everyHeading = Array.from({ length: HEADINGS }, (_unused, h) => h);

const attract = (overrides) => makeMachine(overrides, { tape: [] });

const wholeFirst = (m) => (m.regs.iy + WHOLE_FIRST) & 0xffff;
const fractionFirst = (m) => (m.regs.ix + FRACTION_FIRST) & 0xffff;
const wholeSecond = (m) => (m.regs.iy + WHOLE_SECOND) & 0xffff;
const fractionSecond = (m) => (m.regs.ix + FRACTION_SECOND) & 0xffff;
const WRITTEN = [wholeFirst, fractionFirst, wholeSecond, fractionSecond];

const headingOf = (m) => m.mem8[(m.regs.ix + HEADING_CELL) & 0xffff];
const sampleAt = (m, table, index) => m.mem16[table + 2 * (index & (HEADINGS - 1))];
const signedAt = (m, table, index) => {
  const v = sampleAt(m, table, index);
  return v & 0x8000 ? v - 0x10000 : v;
};

// ── the session ─────────────────────────────────────────────────────────────────────────

let entry = null;
let cache = null;

/** Replay every dispatch of the undriven attract session, comparing both sides at each. */
function replaySession(candidate) {
  let dispatches = 0;
  let caught = 0;
  const headings = new Set();
  const m = attract(new Map([[TARGET, (mm) => {
    dispatches++;
    headings.add(headingOf(mm));
    if (entry === null) entry = mm.clone();
    if (unitDiff(candidate, mm)) caught++;
    return oracle(mm);
  }]]));
  const frames = m.runFrames(FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, FRAMES, "session ran short");
  return { dispatches, caught, headings };
}

const session = () => (cache ??= replaySession(loc_58aa));

function entryState() {
  if (entry === null) session();
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  return entry;
}

/** Oracle vs candidate on clones of one machine. No mask: nothing is excluded from RAM here. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

function selector(heading) {
  const m = entryState().clone();
  m.mem8[(m.regs.ix + HEADING_CELL) & 0xffff] = heading;
  return m;
}

function craft(heading, prior) {
  const m = selector(heading);
  m.mem16[WORLD_SCROLL_Y] = prior.dA;
  m.mem16[WORLD_SCROLL_X] = prior.dB;
  m.mem8[wholeFirst(m)] = prior.wA;
  m.mem8[fractionFirst(m)] = prior.fA;
  m.mem8[wholeSecond(m)] = prior.wB;
  m.mem8[fractionSecond(m)] = prior.fB;
  return m;
}

const SCROLLS = [0x0000, 0x0001, 0x00ff, 0x0100, 0x0180, 0x7fff, 0x8000, 0xfe80, 0xffff];
const POSITIONS = [
  { wA: 0, fA: 0, wB: 0, fB: 0 },
  { wA: 0, fA: 255, wB: 255, fB: 0 },
  { wA: 255, fA: 255, wB: 255, fB: 255 },
  { wA: 138, fA: 203, wB: 129, fB: 88 },
];
const CRAFT_HEADINGS = [0, QUARTER, 137, HEADINGS - 1];

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const heading of CRAFT_HEADINGS) {
    for (const dA of SCROLLS) {
      for (const dB of SCROLLS) for (const p of POSITIONS) out.push([heading, { ...p, dA, dB }]);
    }
  }
  crossCache = out;
  return out;
}

function carryPriors() {
  const out = [];
  for (let f = 0; f < HEADINGS; f++) out.push({ wA: 200, fA: f, wB: 7, fB: f, dA: 1, dB: 0xffff });
  return out;
}

function wholeRunCells(candidate) {
  const base = attract();
  const baseFrames = base.runFrames(FRAMES);
  let fired = 0;
  const host = attract(
    new Map([[TARGET, withOmittedRet((mm) => (fired++, candidate(mm)), TARGET)]]),
  );
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 90);
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

function store(m, wholeAddr, fractionAddr, displacement) {
  const moved = (m.mem8[wholeAddr] << 8) + m.mem8[fractionAddr] + displacement;
  m.mem8[wholeAddr] = moved >> 8;
  m.mem8[fractionAddr] = moved;
}

const componentsOf = (m) => [
  sampleAt(m, VELOCITY_TABLE, headingOf(m)),
  sampleAt(m, VELOCITY_TABLE, headingOf(m) - QUARTER),
];

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the right table, the neighbouring mover — a single step where the entry doubles it. */
function brokenSingleVelocity(m) {
  flyAlongHeading(m, VELOCITY_TABLE);
}

/** BUG: uses the pointer the caller happened to be holding instead of choosing a table. */
function brokenForwardsPointer(m) {
  flyAlongHeadingAtDoubleVelocity(m, m.regs.hl);
}

/** BUG: carries the object with the world but never along the heading it points. */
function brokenScrollOnly(m) {
  store(m, wholeFirst(m), fractionFirst(m), m.mem16[WORLD_SCROLL_Y]);
  store(m, wholeSecond(m), fractionSecond(m), m.mem16[WORLD_SCROLL_X]);
}

/** BUG: flies the object but pins it to the world instead of letting the world stream past. */
function brokenHeadingOnly(m) {
  const [first, second] = componentsOf(m);
  store(m, wholeFirst(m), fractionFirst(m), 2 * first);
  store(m, wholeSecond(m), fractionSecond(m), 2 * second);
}

/** BUG: each coordinate gets the other coordinate's component. */
function brokenAxesSwapped(m) {
  const [first, second] = componentsOf(m);
  store(m, wholeFirst(m), fractionFirst(m), m.mem16[WORLD_SCROLL_Y] + 2 * second);
  store(m, wholeSecond(m), fractionSecond(m), m.mem16[WORLD_SCROLL_X] + 2 * first);
}

/** BUG: doubles the whole step, so the world displacement is applied twice as well. */
function brokenScrollDoubled(m) {
  const [first, second] = componentsOf(m);
  store(m, wholeFirst(m), fractionFirst(m), 2 * (m.mem16[WORLD_SCROLL_Y] + first));
  store(m, wholeSecond(m), fractionSecond(m), 2 * (m.mem16[WORLD_SCROLL_X] + second));
}

/** BUG: adds each half of a displacement to its own byte, so a fraction overflow never banks. */
function brokenNoCarry(m) {
  const [first, second] = componentsOf(m);
  const dA = (m.mem16[WORLD_SCROLL_Y] + 2 * first) & 0xffff;
  const dB = (m.mem16[WORLD_SCROLL_X] + 2 * second) & 0xffff;
  m.mem8[wholeFirst(m)] = m.mem8[wholeFirst(m)] + (dA >> 8);
  m.mem8[fractionFirst(m)] = m.mem8[fractionFirst(m)] + (dA & 0xff);
  m.mem8[wholeSecond(m)] = m.mem8[wholeSecond(m)] + (dB >> 8);
  m.mem8[fractionSecond(m)] = m.mem8[fractionSecond(m)] + (dB & 0xff);
}

const atTable = (table) => (m) => flyAlongHeadingAtDoubleVelocity(m, table);

/** Per twin: the headings it survives over the sweep, and its catch count over the cross. */
const TWINS = [
  ["no-op", brokenNoOp, [], 1296],
  ["single-velocity", brokenSingleVelocity, [], 1296],
  ["rung-above", atTable(RUNG_ABOVE), [], 1296],
  ["top-rung", atTable(TOP_RUNG), [], 1296],
  ["off-by-one-entry", atTable(OFF_BY_ONE_ENTRY), [127, 191], 1296],
  ["misaligned-by-a-byte", atTable(MISALIGNED), [], 1296],
  ["forwards-the-pointer", brokenForwardsPointer, [], 1296],
  ["scroll-only", brokenScrollOnly, [], 1296],
  ["heading-only", brokenHeadingOnly, [], 1280],
  ["axes-swapped", brokenAxesSwapped, [], 1296],
  ["scroll-doubled", brokenScrollDoubled, [], 1280],
  ["no-carry", brokenNoCarry, everyHeading, 885],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: the session reaches this entry, through one of its two call sites", { skip }, () => {
  let here = 0;
  let calling = 0;
  let tail = 0;
  const registry = makeMachine().routines;
  const callingFn = registry.get(CALLING_SITE);
  const tailFn = registry.get(TAIL_SITE);
  const m = attract(new Map([
    [TARGET, (mm) => (here++, oracle(mm))],
    [CALLING_SITE, (mm, ...a) => (calling++, callingFn(mm, ...a))],
    [TAIL_SITE, (mm, ...a) => (tail++, tailFn(mm, ...a))],
  ]));
  const ran = m.runFrames(FRAMES);
  assert.equal(m.stoppedBy, null, `the session stopped early: ${m.stoppedBy}`);
  assert.equal(ran.length, FRAMES, "the session ran short");
  assert.equal(here, DISPATCHES, "the dispatch count moved");
  assert.equal(calling, CALLING_SITE_DISPATCHES, "the calling site's count moved");
  assert.equal(tail, TAIL_SITE_DISPATCHES, "the tail site is now reached, so the hole has closed");
  console.log(`  DISPATCHED: ${here} times; call site ${calling}, tail site ${tail}`);
});

test("EQUAL at the real dispatch: loc_58aa == oracle on the WHOLE dump", { skip }, () => {
  const d = unitDiff(loc_58aa, entryState());
  assert.equal(d, null, `RAM diverged — ${show(d)}`);
  const e = entryState();
  console.log(
    `  EQUAL: heading ${headingOf(e)} bases ${hex4(e.regs.ix)}/${hex4(e.regs.iy)} holding ` +
      `${hex4(e.regs.hl)}; identical with nothing masked, stack bytes included`,
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the same RAM diff", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the RAM diff passed a candidate that does nothing, so RAM is NOT " +
    "this gate and the whole file must be re-derived");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole sweep", { skip }, () => {
  const moved = new Set();
  for (const heading of everyHeading) {
    const a = selector(heading);
    const b = a.clone();
    oracle(a);
    loc_58aa(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    for (const at of WRITTEN) assert.equal(a.mem8[at(a)], b.mem8[at(b)], `live-out ${hex4(at(a))}`);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  // MOVED is a CEILING, not a set the rewrite is required to fill. deepEqual against it
  // would demand the divergence and go RED on a rewrite that became register-exact.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared cap diverged");
  for (const k of HELD) assert.ok(!moved.has(k), `a register the successors read moved (${k})`);
});

test("CORPUS: every dispatch of the session replays identically", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(s.caught, 0, "the rewrite diverged on a real dispatch");
  assert.equal(s.headings.size, DISTINCT_HEADINGS, "the heading spread moved");
  console.log(`  CORPUS: ${s.dispatches} real dispatches over ${s.headings.size} distinct headings`);
});

test("EXHAUSTIVE: all 256 headings crafted off the real entry are identical", { skip }, () => {
  for (const heading of everyHeading) {
    const d = unitDiff(loc_58aa, selector(heading));
    assert.equal(d, null, `heading ${heading}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${HEADINGS} headings identical`);
});

test("CRAFTED: every displacement x position x heading combination is identical", { skip }, () => {
  for (const [heading, p] of cross()) {
    const d = unitDiff(loc_58aa, craft(heading, p));
    assert.equal(d, null, `heading ${heading} ${JSON.stringify(p)}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${cross().length} entries identical`);
});

test("CARRY: a fraction swept 0..255 carries into the whole byte as the oracle does", { skip }, () => {
  const priors = carryPriors();
  for (const p of priors) {
    const d = unitDiff(loc_58aa, craft(0, p));
    assert.equal(d, null, `fraction=${p.fA}: ${show(d)}`);
  }
  const caught = priors.filter((p) => unitDiff(brokenNoCarry, craft(0, p)) !== null).length;
  console.log(`  CARRY (measured): the lost-carry twin dies on ${caught} of ${priors.length}`);
  assert.ok(caught > 0, "the carry sweep stopped discriminating the lost-carry twin");
});

test("RUNG LADDER: no heading makes a neighbouring table indistinguishable", { skip }, () => {
  const m = entryState();
  const peaks = LADDER.map((t) => Math.max(...everyHeading.map((h) => Math.abs(signedAt(m, t, h)))));
  console.log(`  RUNG LADDER (measured): peaks ${peaks.join("/")}`);
  assert.deepEqual(peaks, PEAKS, "the ladder of peak magnitudes moved");
  const oneAgrees = everyHeading.filter(
    (h) => sampleAt(m, VELOCITY_TABLE, h) === sampleAt(m, RUNG_ABOVE, h),
  );
  const bothAgree = oneAgrees.filter(
    (h) => sampleAt(m, VELOCITY_TABLE, h - QUARTER) === sampleAt(m, RUNG_ABOVE, h - QUARTER),
  );
  assert.deepEqual(bothAgree, [], `${hex4(RUNG_ABOVE)} matches on BOTH samples somewhere`);
});

test("WHOLE-MACHINE: the session differs only where the interrupt pushes", { skip }, () => {
  const r = wholeRunCells(loc_58aa);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, FRAMES, `compared ${r.frames} of ${FRAMES} frames`);
  assert.equal(r.fired, DISPATCHES, "the override's dispatch count moved");
  assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the interrupt's own push");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, survives, crossCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on EXACTLY the declared entries`, { skip }, () => {
    const missed = everyHeading.filter((h) => unitDiff(twin, selector(h)) === null);
    const caught = cross().filter(([h, p]) => unitDiff(twin, craft(h, p)) !== null).length;
    console.log(
      `  TEETH/${label}: ${HEADINGS - missed.length} of ${HEADINGS} headings, ${caught} of ` +
        `${cross().length} crafted`,
    );
    assert.deepEqual(missed, survives, `${label}: wrong survivor set over the heading sweep`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(caught > 0, `the ${label} twin is caught by nothing`);
  });
}
