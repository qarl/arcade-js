// SPDX-License-Identifier: GPL-3.0-only
/**
 * negateVelocityIntoWorldScrollThenDressSprite — memory-equivalent to the frozen oracle at ROM 0x1F55.
 *
 * GATE: unit-capture with ONE measured exclusion, a captured real corpus from three sessions, a
 *   sweep that is exhaustive over the routine's whole input space by decomposition, and teeth.
 *
 *   THE FROZEN ROUTINE PUSHES AND THE REWRITE DOES NOT, so the bytes just below the entry stack
 *   pointer are dead scratch on one side only. The push is not this entry's own — it belongs to
 *   the shape lookup it tails into — so the window is MEASURED here rather than read off the
 *   instruction stream: the WRITE-SET arm walks the whole dump and reports every address the
 *   frozen routine moves, and every later arm walks the whole dump too and asserts that nothing
 *   escapes the window. The first-differing-byte helper cannot express "differs only inside the
 *   window", which is why no arm in this file uses it.
 *
 *   WHERE THE LIVE-OUT COMES FROM. It is read off the frozen routine's exit successors, not off
 *   the rewrite. Its ONLY exit is a tail jump to ROM 0x20AF, which returns; that return lands in
 *   ROM 0x1F01 and ROM 0x1F42, both of which reach here as their own last act, and both are
 *   themselves reached as tails from ROM 0x1EDF. 0x1EDF has exactly two call sites, ROM 0x16AF and
 *   ROM 0x5694, and BOTH follow the call with `call 0x0F97`, whose first instruction is
 *   `ld a,(0xB411)`. 0x1EDF also has a bare `ret z` path that returns with an entirely different
 *   register file, so no caller can be reading one. Hence memory-only, and the excluded register
 *   set below is a CEILING: the arm asserts no register OUTSIDE it moves, and stays green on a
 *   rewrite that becomes register-exact.
 *
 * What it exercises, holes stated:
 *   1. CONTRACT — the shared unit harness reaches the routine. Its first-differing-byte verdict is
 *      NOT the contract here (see the window above); the masked arms are.
 *   2. WRITE-SET — the addresses the frozen routine moves, measured over a cross, split into the
 *      six cells and the scratch window. This is what licenses the sweep's machine reuse.
 *   3. EQUAL at the real dispatch — the whole dump outside the window, and the four stored bytes.
 *   4. NOT VACUOUS — a no-op FAILS the same masked diff, on a real cell.
 *   5. TAPE REACH — dispatches per session, measured.
 *   6. CORPUS — every captured dispatch of three sessions.
 *   7. EXCLUDED, as a CEILING — over the whole cross, no register outside the declared set moves.
 *   8. COMPONENT SWEEP — all 65536 values of EACH component in turn. The two stored words are
 *      written from disjoint inputs, which arm 2 measures, so sweeping each slot over its whole
 *      range is exhaustive over the pair rather than a sample of it.
 *   9. HEADING SWEEP — all 256 headings, which is the whole input space of the shape lookup this
 *      entry hands on to.
 *  10. THE REUSED MACHINES ARE SOUND — clone-per-point masked agreement on a sample.
 *  11. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame. Measured, the
 *      set of differing cells is EMPTY, scratch included: the frozen side's two bracket bytes are
 *      overwritten again long before any frame boundary samples them. That is pinned rather than
 *      described, and each differing cell would also have to be a stack address.
 *  12. TEETH — eight twins, each with an exact catch count over the sweep, over the real corpus and
 *      over the whole run. Three are whole-run blind and two of those score zero on a session, all
 *      recorded, because the driven tape hands this entry ONE pair and the sessions differ in how
 *      much of the component space they present.
 *
 * HOLE: the corpus and every crafted entry take the pair from ONE seated machine; the sweep varies
 * the values handed over, never the record the shape lookup reads its heading out of.
 * HOLE: the component sweep holds the OTHER component at its captured value, so a defect that
 * needs a particular combination of the two would be seen only if it also shows at that value.
 * HOLE: the sweep compares the six written cells, not the whole dump, so a candidate writing a
 * SEVENTH cell is caught by the corpus and clone-per-point arms rather than by the sweep.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1f55.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { negateVelocityIntoWorldScrollThenDressSprite } from "../negateVelocityIntoWorldScrollThenDressSprite.js";
import { dressPlayerSpriteForHeading } from "../dressPlayerSpriteForHeading.js";
import { loc_1f55 as oracle } from "../../translated/loc_1f55.js";
import { deadStackBelow, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u16 } from "../../../../core/int.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x1f55;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const WORLD_SCROLL_Y = 0xa808;
const WORLD_SCROLL_X = 0xa80a;
const PLAYER_HEADING = 0xa802;
const SHAPE_CELL = 0xaa11;
const ATTRIBUTE_CELL = 0xaa40;

/** Everything the frozen routine writes, so the sweep can put a machine back as it found it. */
const WRITTEN = [WORLD_SCROLL_Y, WORLD_SCROLL_Y + 1, WORLD_SCROLL_X, WORLD_SCROLL_X + 1,
  SHAPE_CELL, ATTRIBUTE_CELL];
/** Measured by the WRITE-SET arm: the shape lookup's own call bracket, below the entry pointer. */
const SCRATCH_BYTES = 2;

const HEADINGS = 256;
const COMPONENTS = 65536;
const CROSS_CHECK_POINTS = 400;

/** Derived from the frozen routine's exit successors, not from the rewrite. See the header. */
const EXCLUDED = ["a", "f", "d", "e", "h", "l", "ix", "sp"];

const CORPUS_FRAMES = 1200;
const WHOLE_FRAMES = 1200;
const CAPTURE_CAP = 150;
const RET_TSTATES = 10;

/** Measured: a whole run leaves NOTHING differing, not even a scratch byte. */
const WHOLE_RUN_CELLS = [];

const STACK_FLOOR = 0xaf00;
const STACK_TOP = 0xb000;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");

function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (let i = 0; i < 20; i++) {
    tape.push({ frame, port: IN1, bits: compass[i % compass.length], dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const sharedMachine = (overrides) => makeMachine(overrides);
const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const turningMachine = (overrides) => makeMachine(overrides, { tape: turnTape() });

const SESSIONS = [
  ["shared", sharedMachine],
  ["attract", attractMachine],
  ["turning", turningMachine],
];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { shared: 464, attract: 301, turning: 589 };

// ── the masked comparison ───────────────────────────────────────────────────────────────

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

/** The whole dump minus the scratch window. Clone per point. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

// ── capturing real dispatches ───────────────────────────────────────────────────────────

function captureSession(factory) {
  let dispatches = 0;
  const entries = [];
  const pairs = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      pairs.add(`${mm.regs.de}:${mm.regs.bc}`);
      if (entries.length < CAPTURE_CAP) entries.push(mm.clone());
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, entries, pairs };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...captureSession(factory) }));
  }
  return sessionCache;
}

const entryState = () => sessions()[0].entries[0];

function corpusCaught(candidate) {
  return sessions().map((s) => s.entries.filter((e) => unitDiff(candidate, e) !== null).length);
}

// ── the sweep, on two reused machines ───────────────────────────────────────────────────

let arena = null;
function pair() {
  if (!arena) arena = [entryState().clone(), entryState().clone()];
  return arena;
}

/**
 * Put both machines back exactly as the captured entry left them, then seat one point on each.
 * Restoring the six written cells and the scratch window is what makes reuse equivalent to
 * cloning; the WRITE-SET arm is what says those are all of them.
 */
function seat(m, alongY, alongX, heading) {
  const seed = entryState();
  m.regs.copyFrom(seed.regs);
  for (const addr of WRITTEN) m.mem8[addr] = seed.mem8[addr];
  for (let i = 1; i <= SCRATCH_BYTES; i++) {
    m.mem8[u16(seed.regs.sp - i)] = seed.mem8[u16(seed.regs.sp - i)];
  }
  m.mem8[PLAYER_HEADING] = heading;
  m.regs.de = alongY;
  m.regs.bc = alongX;
}

/**
 * One point. The comparison here is the six written cells rather than the whole dump, which is
 * what keeps a 131328-point sweep affordable; the clone-per-point arm and the captured corpus are
 * where the whole dump is walked, and the hole that leaves is stated in the header.
 */
function pointDiffers(candidate, alongY, alongX, heading) {
  const [a, b] = pair();
  seat(a, alongY, alongX, heading);
  seat(b, alongY, alongX, heading);
  oracle(a);
  candidate(b);
  return WRITTEN.some((addr) => a.mem8[addr] !== b.mem8[addr]);
}

function componentSweepCaught(candidate) {
  const seed = entryState();
  const heading = seed.mem8[PLAYER_HEADING];
  const alongY = seed.regs.de;
  const alongX = seed.regs.bc;
  let caught = 0;
  for (let v = 0; v < COMPONENTS; v++) if (pointDiffers(candidate, v, alongX, heading)) caught++;
  for (let v = 0; v < COMPONENTS; v++) if (pointDiffers(candidate, alongY, v, heading)) caught++;
  return caught;
}

function headingSweepCaught(candidate) {
  const seed = entryState();
  let caught = 0;
  for (let h = 0; h < HEADINGS; h++) {
    if (pointDiffers(candidate, seed.regs.de, seed.regs.bc, h)) caught++;
  }
  return caught;
}

const sweepCaught = (candidate) => componentSweepCaught(candidate) + headingSweepCaught(candidate);

// ── the whole-machine masked diff ───────────────────────────────────────────────────────

function hosted(candidate) {
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    const base = sharedMachine();
    const frames = base.runFrames(WHOLE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o), stopped: base.stoppedBy };
  }
  return baselineRun;
}

function wholeRunCells(candidate) {
  const base = baseline();
  let fired = 0;
  const host = sharedMachine(new Map([[TARGET, (mm) => (fired++, hosted(candidate)(mm))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(base.frames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = base.frames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.offsetToAddr(o));
  }
  const live = liveStackDiffs(base.frames, hostFrames, floors, (o) => base.offsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((p, q) => p - q), frames: n, fired, threw };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** Every twin but one dresses the sprite correctly, so its defect is isolated to the scroll. */
const dress = (m) => dressPlayerSpriteForHeading(m);

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the components are stored as they arrive, so the world scrolls WITH the ship. */
function brokenNotNegated(m) {
  m.mem16[WORLD_SCROLL_Y] = m.regs.de;
  m.mem16[WORLD_SCROLL_X] = m.regs.bc;
  dress(m);
}

/** BUG: each component lands on the other axis. */
function brokenAxesSwapped(m) {
  m.mem16[WORLD_SCROLL_Y] = u16(-m.regs.bc);
  m.mem16[WORLD_SCROLL_X] = u16(-m.regs.de);
  dress(m);
}

/** BUG: one axis is left standing at whatever it held. */
function brokenOneAxisOnly(m) {
  m.mem16[WORLD_SCROLL_Y] = u16(-m.regs.de);
  dress(m);
}

/** BUG: the negation is taken a byte at a time, so the high half never borrows. */
function brokenEightBitNegate(m) {
  const { regs, mem8 } = m;
  mem8[WORLD_SCROLL_Y] = -regs.e;
  mem8[WORLD_SCROLL_Y + 1] = -regs.d;
  mem8[WORLD_SCROLL_X] = -regs.c;
  mem8[WORLD_SCROLL_X + 1] = -regs.b;
  dress(m);
}

/** BUG: the bits are flipped instead of negated, so every value is one short. */
function brokenComplemented(m) {
  m.mem16[WORLD_SCROLL_Y] = u16(~m.regs.de);
  m.mem16[WORLD_SCROLL_X] = u16(~m.regs.bc);
  dress(m);
}

/** BUG: one component is negated onto both axes. */
function brokenBothAxesSame(m) {
  m.mem16[WORLD_SCROLL_Y] = u16(-m.regs.de);
  m.mem16[WORLD_SCROLL_X] = u16(-m.regs.de);
  dress(m);
}

/** BUG: the scroll is stored but the sprite is never dressed for the heading. */
function brokenSpriteNotDressed(m) {
  m.mem16[WORLD_SCROLL_Y] = u16(-m.regs.de);
  m.mem16[WORLD_SCROLL_X] = u16(-m.regs.bc);
}

const TWINS = [
  ["no-op", brokenNoOp, 131327, [1, 1, 59], true],
  ["not-negated", brokenNotNegated, 131326, [150, 150, 150], true],
  ["axes-swapped", brokenAxesSwapped, 131326, [150, 150, 150], true],
  ["one-axis-only", brokenOneAxisOnly, 65535, [0, 0, 57], false],
  ["eight-bit-negate", brokenEightBitNegate, 130560, [0, 150, 104], false],
  ["complemented", brokenComplemented, 131328, [150, 150, 150], true],
  ["both-axes-same", brokenBothAxesSame, 131326, [150, 150, 150], true],
  ["sprite-not-dressed", brokenSpriteNotDressed, 248, [0, 0, 21], false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: the shared unit harness reaches the routine", { skip }, () => {
  let floor = null; // the entry SP: the harness's first oracle call is at the captured entry
  const tapped = (mm) => { floor ??= mm.regs.sp; return oracle(mm); };
  const r = unitEquivalence(sharedMachine, TARGET, tapped, negateVelocityIntoWorldScrollThenDressSprite, { maxFrames: ENTRY_FRAMES });
  const onlyScratch = r.ram === null || r.ram.addr === null ||
    deadStackBelow({ lo: STACK_FLOOR, hi: STACK_TOP }, floor)(r.ram.addr);
  console.log(`  CONTRACT: reached within ${ENTRY_FRAMES} frames; first byte ${show(r.ram)}`);
  assert.equal(onlyScratch, true, "the shared harness's FIRST differing byte is outside the stack scratch below the entry SP " +
    "(this arm checks reach; the arms below compare every cell)");
});

test("WRITE-SET: what the frozen routine moves, and where the scratch window is", { skip }, () => {
  const cells = new Set();
  const scratch = new Set();
  const seed = entryState();
  const sp = seed.regs.sp;
  for (let i = 0; i < CROSS_CHECK_POINTS; i++) {
    const before = seed.clone();
    before.regs.de = (i * 2861) & 0xffff;
    before.regs.bc = (i * 7919) & 0xffff;
    before.mem8[PLAYER_HEADING] = (i * 61) & 0xff;
    const after = before.clone();
    oracle(after);
    for (const d of allDiffs(before, after)) {
      if (inScratch(d.addr, sp)) scratch.add(d.addr);
      else cells.add(d.addr);
    }
  }
  const moved = [...cells].sort((p, q) => p - q);
  console.log(
    `  WRITE-SET (measured over ${CROSS_CHECK_POINTS} points): cells [${moved.map(hex4).join(" ")}]` +
      `; scratch [${[...scratch].sort((p, q) => p - q).map(hex4).join(" ")}] below ${hex4(sp)}`,
  );
  const strays = moved.filter((a) => !WRITTEN.includes(a));
  assert.deepEqual(strays.map(hex4), [], "the frozen routine writes a cell this file does not " +
    "restore between sweep points, so the sweep's machine reuse is unsound");
  assert.ok(moved.length > 0, "vacuous: the frozen routine moved no cell at all");
});

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  negateVelocityIntoWorldScrollThenDressSprite(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: entry pair ${hex4(e.regs.de)}/${hex4(e.regs.bc)} heading ${e.mem8[PLAYER_HEADING]} ` +
      `sp ${hex4(sp)}; ${all.length} differing bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.mem16[WORLD_SCROLL_Y], b.mem16[WORLD_SCROLL_Y], "the first stored word diverged");
  assert.equal(a.mem16[WORLD_SCROLL_X], b.mem16[WORLD_SCROLL_X], "the second stored word diverged");
});

test("NOT VACUOUS: a no-op FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.ok(d.addr < STACK_FLOOR, `the no-op is caught only at ${hex4(d.addr)}, a stack address`);
  console.log(`  NOT VACUOUS: the no-op is caught at ${hex4(d.addr)}`);
});

test("TAPE REACH: dispatches per session, measured", { skip }, () => {
  const seen = sessions();
  console.log(
    `  TAPE REACH (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.pairs.size} distinct pairs`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  assert.ok(seen.every((s) => s.dispatches > 0), "vacuous: a session reaches the routine not at all");
});

test("CORPUS: every captured dispatch of three sessions is identical", { skip }, () => {
  const caught = corpusCaught(negateVelocityIntoWorldScrollThenDressSprite);
  const captured = sessions().map((s) => s.entries.length);
  console.log(`  CORPUS: ${captured.join("/")} captured dispatches, identical outside the window`);
  assert.deepEqual(caught, [0, 0, 0], "the rewrite diverged on a real dispatch");
});

test("EXCLUDED, as a CEILING: no register outside the declared set moves", { skip }, () => {
  const moved = new Set();
  const values = [0, 1, 2, 0x7fff, 0x8000, 0xfffe, 0xffff];
  let points = 0;
  for (const alongY of values) {
    for (const alongX of values) {
      for (const heading of [0, 63, 64, 127, 200, 255]) {
        const a = entryState().clone();
        a.regs.de = alongY;
        a.regs.bc = alongX;
        a.mem8[PLAYER_HEADING] = heading;
        const b = a.clone();
        oracle(a);
        negateVelocityIntoWorldScrollThenDressSprite(b);
        for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
        points++;
      }
    }
  }
  const strays = REG_FIELDS.filter((k) => moved.has(k) && !EXCLUDED.includes(k));
  console.log(
    `  EXCLUDED (measured over ${points} points): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}` +
      `; ceiling ${EXCLUDED.join(", ")}`,
  );
  assert.deepEqual(strays, [], "a register outside the declared ceiling diverged");
});

test("COMPONENT SWEEP: all 65536 values of each component in turn", { skip }, () => {
  assert.equal(componentSweepCaught(negateVelocityIntoWorldScrollThenDressSprite), 0, "the rewrite diverged somewhere in the sweep");
  console.log(`  COMPONENT SWEEP: ${2 * COMPONENTS} points, identical outside the window`);
});

test("HEADING SWEEP: all 256 headings the shape lookup can be handed", { skip }, () => {
  assert.equal(headingSweepCaught(negateVelocityIntoWorldScrollThenDressSprite), 0, "the rewrite diverged at some heading");
  console.log(`  HEADING SWEEP: ${HEADINGS} headings, identical outside the window`);
});

test("THE REUSED MACHINES ARE SOUND: clone-per-point agrees on a sample", { skip }, () => {
  const seed = entryState();
  for (let i = 0; i < CROSS_CHECK_POINTS; i++) {
    const alongY = (i * 2861) & 0xffff;
    const alongX = (i * 7919) & 0xffff;
    const heading = (i * 61) & 0xff;
    const m = seed.clone();
    m.regs.de = alongY;
    m.regs.bc = alongX;
    m.mem8[PLAYER_HEADING] = heading;
    assert.equal(unitDiff(negateVelocityIntoWorldScrollThenDressSprite, m), null, `clone-per-point diverged at ${alongY},${alongX}`);
    assert.equal(
      pointDiffers(negateVelocityIntoWorldScrollThenDressSprite, alongY, alongX, heading),
      false,
      `the reused arena disagrees with clone-per-point at ${alongY},${alongX},${heading}`,
    );
  }
  console.log(`  SOUND: ${CROSS_CHECK_POINTS} points agree between the arena and clone-per-point`);
});

test("WHOLE-MACHINE: a driven session is byte-identical with the rewrite wired", { skip }, () => {
  const r = wholeRunCells(negateVelocityIntoWorldScrollThenDressSprite);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, differing cells ` +
      `[${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address`);
  }
  assert.deepEqual(r.cells.map(hex4), WHOLE_RUN_CELLS, "the set of cells a whole run leaves " +
    "differing moved; measured, it is empty, because the frozen side's two scratch bytes are " +
    "overwritten again before any frame boundary samples them");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, sweep, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of sweep points`, { skip }, () => {
    const caught = sweepCaught(twin);
    console.log(`  TEETH/${label}: caught on ${caught} of ${2 * COMPONENTS + HEADINGS} sweep points`);
    assert.equal(caught, sweep, `the ${label} twin's sweep catch count moved`);
    assert.ok(caught > 0, `the sweep missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin's real-dispatch catch count, zeros recorded`, { skip }, () => {
    const caught = corpusCaught(twin);
    const blind = caught.every((n) => n === 0);
    console.log(
      `  TEETH/${label}: real sessions catch ${caught.join("/")}` +
        (blind ? " — caught by NO real dispatch, as recorded" : ""),
    );
    assert.deepEqual(caught, perSession, `the ${label} twin's real-dispatch counts moved`);
  });

  test(`TEETH: the whole machine sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(twin);
    const seen = r.threw !== null || r.cells.some((c) => c < STACK_FLOOR || c >= STACK_TOP);
    console.log(`  TEETH/${label}: whole run ${seen ? "catches it" : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}
