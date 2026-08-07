// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_5860 — memory-equivalent to the frozen oracle at ROM 0x5860.
 *
 * WHAT IT IS. Two instructions: load a fixed table pointer, then tail-jump to the per-object move
 * at 0x58BC, which IS ALREADY DECOMPILED — so the rewrite calls flyAlongHeading directly with the
 * table as an argument, and dissolving that transfer belongs to this caller's unit. The whole
 * content of the entry is the CHOICE OF TABLE, plus the fact that a pointer the caller was already
 * holding is discarded.
 *
 * ★ NO TAPE REACHES THIS ENTRY AT ALL, and the UNREACHED arm asserts it: the shared coin-then-start
 *   tape, the same tape with the stick walked round the compass, and undriven attract each dispatch
 *   it ZERO times in 2000 frames. Its one caller sits behind a coin-toss on a free-running cell
 *   inside a path none of those sessions takes. So this file has NO natural corpus, and says so
 *   rather than reporting a vacuous one.
 *
 * ★ WHAT REPLACES THE CORPUS IS A BORROWED ENTRY, AND THE STATE IS REAL. A sibling entry two rungs
 *   down IS dispatched hundreds of times a session, into the same move, off a record and a sprite
 *   entry of the same shape. Its first real dispatch is cloned with the game left completely
 *   undisturbed, and every arm below runs both sides on that state and on crafted variants of it.
 *   What is crafted is which velocity table the move is handed; nothing about the machine is
 *   fabricated.
 *
 * ★ THE TABLE IS THE ONLY THING THIS ENTRY DECIDES. Six velocity tables sit in the image whose peak
 *   magnitudes climb in even steps — 0x59D7, 0x5C00, 0x5E00, 0x2530, 0x2E3E, 0x08FA. The twins hand
 *   the move the rungs either side, both ends of the ladder, and pointers that are no table at all;
 *   the RUNG LADDER arm re-derives from the table bytes why a neighbour cannot hide behind a
 *   near-zero sample.
 *
 * GATE: crafted-entry, off a sibling's real dispatches. What it exercises, holes stated:
 *
 *   1. UNREACHED — the three sessions' dispatch counts for this entry, measured and asserted.
 *   2. EQUAL at the borrowed entry — RAM byte-identical.
 *   3. NOT VACUOUS — a no-op candidate FAILS that same RAM diff, so RAM really is the gate.
 *   4. EXCLUDED — over the whole heading sweep the registers that move are exactly the scratch set,
 *      and the four written bytes never differ.
 *   5. EXHAUSTIVE — all 256 headings crafted off the sibling's entry.
 *   6. CRAFTED CROSS — displacements x positions x four headings, poked identically on both sides.
 *   7. CARRY — one fraction swept 0..255, the only arm that reaches the carry between a
 *      coordinate's halves.
 *   8. RUNG LADDER — the six peaks read out of memory, and the pair-versus-sample argument.
 *   9. TEETH — eleven twins, each with an exactly declared survivor set over the heading sweep and
 *      an exact catch count over the crafted cross.
 *
 * HOLE: THERE IS NO WHOLE-MACHINE ARM, and the reason is measured rather than assumed. Putting this
 * entry into the sibling's slot does dispatch it hundreds of times, but it also changes the physics
 * of the game it is running in: that run destabilises and the foreground loop ends up writing
 * through an address outside RAM. A run that dies is not a gate, so it is not one of the arms here
 * and every tooth below is a unit tooth.
 * HOLE: the borrowed entry is not this entry's own caller. It is the object population the SIBLING
 * is dispatched with, which is the only population any session offers. Nothing here speaks for the
 * slots its real caller would hand it.
 * HOLE: object slots. The crafted arms vary the values read, never the bases they are read from.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5860.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { loc_5860 } from "../loc_5860.js";
import { flyAlongHeading } from "../flyAlongHeading.js";
import { loc_5860 as oracle } from "../../translated/loc_5860.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "../names.js";

const TARGET = 0x5860;

/** The sibling entry a session really does dispatch, and whose entry state is borrowed here. */
const BORROWED_FROM = 0x5854;

const VELOCITY_TABLE = 0x2e3e;
const LADDER = [0x59d7, 0x5c00, 0x5e00, 0x2530, 0x2e3e, 0x08fa];
const RUNG = LADDER.indexOf(VELOCITY_TABLE);
const RUNG_BELOW = LADDER[RUNG - 1];
const RUNG_ABOVE = LADDER[RUNG + 1];
const PEAKS = [206, 231, 256, 281, 306, 331];

/** The two headings at which the borrowed entry's own priors leave the move with nothing to do. */
const NO_OP_SURVIVORS = [127, 128];

const OFF_BY_ONE_ENTRY = VELOCITY_TABLE + 2;
const MISALIGNED = VELOCITY_TABLE + 1;

const HEADING_CELL = 2;
const HEADINGS = 256;
const QUARTER = HEADINGS / 4;

const MOVED = ["a", "f", "d", "e", "h", "l", "sp"];
const HELD = ["b", "c", "ix", "iy"];

const CORPUS_FRAMES = 2000;
const WHOLE_FRAMES = 1600;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");
const everyHeading = Array.from({ length: HEADINGS }, (_unused, h) => h);

/** The coin-then-start tape with the stick walked once round the compass, trigger held. */
function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (const bits of compass) {
    tape.push({ frame, port: IN1, bits, dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const TAPES = [["shared", {}], ["attract", { tape: [] }], ["turning", { tape: turnTape() }]];
const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });

const wholeFirst = (m) => (m.regs.iy + 49) & 0xffff;
const fractionFirst = (m) => (m.regs.ix + 3) & 0xffff;
const wholeSecond = (m) => m.regs.iy & 0xffff;
const fractionSecond = (m) => (m.regs.ix + 5) & 0xffff;
const WRITTEN = [wholeFirst, fractionFirst, wholeSecond, fractionSecond];

const headingOf = (m) => m.mem8[(m.regs.ix + HEADING_CELL) & 0xffff];
const sampleAt = (m, table, index) => m.mem16[table + 2 * (index & (HEADINGS - 1))];
const signedAt = (m, table, index) => {
  const v = sampleAt(m, table, index);
  return v & 0x8000 ? v - 0x10000 : v;
};

// ── the borrowed entry ──────────────────────────────────────────────────────────────────

let entry = null;
function entryState() {
  if (entry !== null) return entry;
  const registry = makeMachine().routines;
  const siblingFn = registry.get(BORROWED_FROM);
  const m = attractMachine(
    new Map([[BORROWED_FROM, (mm, ...args) => {
      if (entry === null) entry = mm.clone();
      return siblingFn(mm, ...args); // the game is left undisturbed; only the state is taken
    }]]),
  );
  m.runFrames(WHOLE_FRAMES);
  assert.notEqual(entry, null, "vacuous: the sibling entry was never dispatched either");
  return entry;
}

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

function brokenNoOp() {}
function brokenForwardsPointer(m) {
  flyAlongHeading(m, m.regs.hl);
}
function brokenOffByOneEntry(m) {
  flyAlongHeading(m, OFF_BY_ONE_ENTRY);
}
function brokenMisaligned(m) {
  flyAlongHeading(m, MISALIGNED);
}
/** BUG: carries the object with the world but never along the heading it points. */
function brokenScrollOnly(m) {
  store(m, wholeFirst(m), fractionFirst(m), m.mem16[WORLD_SCROLL_Y]);
  store(m, wholeSecond(m), fractionSecond(m), m.mem16[WORLD_SCROLL_X]);
}
/** BUG: flies the object but pins it to the world instead of letting the world stream past. */
function brokenHeadingOnly(m) {
  const [first, second] = componentsOf(m);
  store(m, wholeFirst(m), fractionFirst(m), first);
  store(m, wholeSecond(m), fractionSecond(m), second);
}
/** BUG: each coordinate gets the other coordinate's component. */
function brokenAxesSwapped(m) {
  const [first, second] = componentsOf(m);
  store(m, wholeFirst(m), fractionFirst(m), m.mem16[WORLD_SCROLL_Y] + second);
  store(m, wholeSecond(m), fractionSecond(m), m.mem16[WORLD_SCROLL_X] + first);
}
/** BUG: adds each half of a displacement to its own byte, so a fraction overflow never banks. */
function brokenNoCarry(m) {
  const [first, second] = componentsOf(m);
  const dA = (m.mem16[WORLD_SCROLL_Y] + first) & 0xffff;
  const dB = (m.mem16[WORLD_SCROLL_X] + second) & 0xffff;
  m.mem8[wholeFirst(m)] = m.mem8[wholeFirst(m)] + (dA >> 8);
  m.mem8[fractionFirst(m)] = m.mem8[fractionFirst(m)] + (dA & 0xff);
  m.mem8[wholeSecond(m)] = m.mem8[wholeSecond(m)] + (dB >> 8);
  m.mem8[fractionSecond(m)] = m.mem8[fractionSecond(m)] + (dB & 0xff);
}

/** Per twin: the headings it survives over the sweep, and its catch count over the cross. */
const TWINS = [
  ["no-op", brokenNoOp, NO_OP_SURVIVORS, 1296],
  ["forwards-the-pointer", brokenForwardsPointer, [], 1296],
  ["rung-below", (m) => flyAlongHeading(m, RUNG_BELOW), [], 1296],
  ["rung-above", (m) => flyAlongHeading(m, RUNG_ABOVE), [], 1296],
  ["bottom-rung", (m) => flyAlongHeading(m, LADDER[0]), [], 1296],
  ["off-by-one-entry", brokenOffByOneEntry, [127, 191], 1296],
  ["misaligned-by-a-byte", brokenMisaligned, [], 1296],
  ["scroll-only", brokenScrollOnly, [], 1296],
  ["heading-only", brokenHeadingOnly, [], 1280],
  ["axes-swapped", brokenAxesSwapped, [], 1296],
  ["no-carry", brokenNoCarry, everyHeading, 833],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: no session dispatches this entry, so the corpus is a diversion", { skip }, () => {
  const counts = [];
  for (const [label, opts] of TAPES) {
    let dispatches = 0;
    let sibling = 0;
    const registry = makeMachine().routines;
    const siblingFn = registry.get(BORROWED_FROM);
    const m = makeMachine(
      new Map([
        [TARGET, (mm) => (dispatches++, oracle(mm))],
        [BORROWED_FROM, (mm, ...args) => (sibling++, siblingFn(mm, ...args))],
      ]),
      opts,
    );
    const ran = m.runFrames(CORPUS_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} tape stopped early: ${m.stoppedBy}`);
    assert.equal(ran.length, CORPUS_FRAMES, `the ${label} tape ran short`);
    counts.push(`${label} ${dispatches} (sibling ${sibling})`);
    assert.equal(dispatches, 0, `the ${label} tape now reaches this entry, so it HAS a natural ` +
      "corpus and the diversion should be replaced by it");
    if (label === "attract") {
      assert.ok(sibling > 0, "the sibling entry is not dispatched either, so the diversion has " +
        "no host and every arm in this file is measuring an unreached routine");
    }
  }
  console.log(`  UNREACHED: ${counts.join(", ")}`);
});

test("EQUAL at the borrowed entry: loc_5860 == oracle on RAM", { skip }, () => {
  const d = unitDiff(loc_5860, entryState());
  assert.equal(d, null, `RAM diverged — ${show(d)}`);
  const e = entryState();
  console.log(
    `  EQUAL: borrowed entry heading ${headingOf(e)} bases ${hex4(e.regs.ix)}/${hex4(e.regs.iy)} ` +
      `holding ${hex4(e.regs.hl)}; RAM identical`,
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
    loc_5860(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
    for (const at of WRITTEN) assert.equal(a.mem8[at(a)], b.mem8[at(b)], `live-out ${hex4(at(a))}`);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} and pc`);
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k)), MOVED, "the excluded set changed shape");
  for (const k of HELD) assert.ok(!moved.has(k), `a register the callers rely on moved (${k})`);
});

test("EXHAUSTIVE: all 256 headings crafted off the borrowed entry are identical", { skip }, () => {
  for (const heading of everyHeading) {
    const d = unitDiff(loc_5860, selector(heading));
    assert.equal(d, null, `heading ${heading}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${HEADINGS} headings identical`);
});

test("CRAFTED: every displacement x position x heading combination is identical", { skip }, () => {
  for (const [heading, p] of cross()) {
    const d = unitDiff(loc_5860, craft(heading, p));
    assert.equal(d, null, `heading ${heading} ${JSON.stringify(p)}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${cross().length} entries identical`);
});

test("CARRY: a fraction swept 0..255 carries into the whole byte as the oracle does", { skip }, () => {
  const priors = carryPriors();
  for (const p of priors) {
    const d = unitDiff(loc_5860, craft(0, p));
    assert.equal(d, null, `fraction=${p.fA}: ${show(d)}`);
  }
  const caught = priors.filter((p) => unitDiff(brokenNoCarry, craft(0, p)) !== null).length;
  console.log(`  CARRY (measured): the lost-carry twin dies on ${caught} of ${priors.length}`);
  assert.ok(caught > 0, "the carry sweep stopped discriminating the lost-carry twin");
});

test("RUNG LADDER: no heading makes a neighbouring rung indistinguishable", { skip }, () => {
  const m = entryState();
  const peaks = LADDER.map((t) => Math.max(...everyHeading.map((h) => Math.abs(signedAt(m, t, h)))));
  console.log(`  RUNG LADDER (measured): peaks ${peaks.join("/")}`);
  assert.deepEqual(peaks, PEAKS, "the ladder of peak magnitudes moved");
  for (const neighbour of [RUNG_BELOW, RUNG_ABOVE]) {
    const oneAgrees = everyHeading.filter(
      (h) => sampleAt(m, VELOCITY_TABLE, h) === sampleAt(m, neighbour, h),
    );
    const bothAgree = oneAgrees.filter(
      (h) => sampleAt(m, VELOCITY_TABLE, h - QUARTER) === sampleAt(m, neighbour, h - QUARTER),
    );
    assert.deepEqual(bothAgree, [], `${hex4(neighbour)} matches on BOTH samples somewhere`);
  }
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, survives, crossCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on EXACTLY the declared headings`, { skip }, () => {
    const missed = everyHeading.filter((h) => unitDiff(twin, selector(h)) === null);
    const caught = cross().filter(([h, p]) => unitDiff(twin, craft(h, p)) !== null).length;
    console.log(
      `  TEETH/${label}: ${HEADINGS - missed.length} of ${HEADINGS} headings, ${caught} of ` +
        `${cross().length} crafted; survivors [${missed.join(",")}]`,
    );
    assert.deepEqual(missed, survives, `${label}: wrong survivor set over the heading sweep`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
  });

}
